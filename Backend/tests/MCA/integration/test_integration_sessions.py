"""Integration tests for the MCA session lifecycle: HTTP -> router -> scoring -> DB.

Only the Gemini live scorer is mocked (where a test needs a specific LLM result);
everything else, including rule-based scoring and persistence, runs for real.
"""
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.models.session_result import SessionResult

pytestmark = pytest.mark.integration

_QUIET = {"message": "A bit quiet. Projecting helps engagement.", "category": "volume", "severity": "warning"}

_LLM_RESULT = {
    "overall": 78,
    "breakdown": {"vocal_command": 70, "speech_fluency": 80, "presence_engagement": 75, "emotional_regulation": 87},
    "rationale": "Composed delivery with occasional low volume.",
}


def _observations(n=20, flag_every=2):
    return [
        {"elapsed_seconds": 3 * i, "speaking": True, "face_visible": True,
         "emotion": "happy" if i % 3 == 0 else "neutral", "confidence": 0.9,
         "detections": [_QUIET] if i % flag_every == 0 else []}
        for i in range(n)
    ]


# Start

class TestStartSessionPositive:
    def test_start_defaults_to_live_mode(self, api, make_user):
        user = make_user()
        resp = api(user, "post", "/mca/sessions/start", json={})
        assert resp.status_code == 201
        data = resp.json()
        assert data["mode"] == "live"
        assert data["friendly_id"].startswith("MCA-LIVE-")
        assert data["ended_at"] is None and data["overall_score"] is None

    def test_start_persists_active_row(self, api, make_user, db_session):
        user = make_user()
        data = api(user, "post", "/mca/sessions/start", json={"mode": "ai"}).json()
        row = db_session.get(SessionResult, uuid.UUID(data["id"]))
        assert row.user_id == user.id
        assert row.status == "active"
        assert row.session_type == "ai"


class TestStartSessionNegative:
    def test_start_without_auth_is_401(self, api):
        # NEGATIVE: no bearer token. Sessions belong to a user, so anonymous
        # callers must be rejected before anything is written.
        resp = api(None, "post", "/mca/sessions/start", json={"mode": "ai"})
        assert resp.status_code == 401

    def test_start_with_invalid_mode_is_422(self, api, make_user):
        # NEGATIVE: "video" isn't a supported mode. Validation must reject it
        # instead of storing a session no scorer can handle.
        resp = api(make_user(), "post", "/mca/sessions/start", json={"mode": "video"})
        assert resp.status_code == 422

    def test_start_with_malformed_body_is_422(self, api, make_user):
        # NEGATIVE: the body is not JSON at all.
        resp = api(make_user(), "post", "/mca/sessions/start", content=b"mode=ai",
                   headers={"content-type": "application/json"})
        assert resp.status_code == 422


# End

class TestEndSessionPositive:
    def test_ai_session_end_uses_rule_based_scoring(self, api, make_user, start_session):
        user = make_user()
        sid = start_session(user, "ai")["id"]
        resp = api(user, "post", f"/mca/sessions/{sid}/end", json={
            "nudge_log": [_QUIET],
            "emotion_distribution": {"neutral": 0.6, "happy": 0.4},
            "mechanical_averages": {"volume": 0.04},
            "observation_log": _observations(),
            "chat_turns": 6,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert data["chat_turns"] == 6
        assert data["dominant_emotion"] == "neutral"
        assert data["mechanical_averages"] == {"volume": 0.04}
        assert data["score_diagnostics"]["scoring_method"] == "rule_based"
        assert data["skill_scores"]["vocal_command"] == 50       # half the chunks flagged quiet
        assert 0 <= data["overall_score"] <= 100

    @patch("app.api.v1.mca.sessions.mca_live_scorer.score", return_value=_LLM_RESULT)
    def test_live_session_end_uses_llm_scores(self, mock_score, api, make_user, start_session):
        user = make_user()
        sid = start_session(user, "live")["id"]
        resp = api(user, "post", f"/mca/sessions/{sid}/end", json={
            "user_transcript": [{"text": "Good morning team.", "elapsed_seconds": 1}],
            "meeting_transcript": [{"text": "Morning!", "elapsed_seconds": 3}],
            "emotion_timeline": [{"emotion": "happy", "confidence": 0.7, "elapsed_seconds": 1}],
            "behavior_log": [{**_QUIET, "elapsed_seconds": 6}],
            "observation_log": _observations(),
        })
        data = resp.json()
        assert resp.status_code == 200
        assert data["overall_score"] == 78
        assert data["skill_scores"] == _LLM_RESULT["breakdown"]
        assert data["score_diagnostics"]["scoring_method"] == "llm"
        assert data["score_diagnostics"]["llm_rationale"] == _LLM_RESULT["rationale"]
        # Rule-based diagnostics are still recorded next to the LLM score.
        assert data["score_diagnostics"]["evidence_source"] == "observation_log"

        kwargs = mock_score.call_args.kwargs
        assert kwargs["user_transcript"][0]["text"] == "Good morning team."
        assert kwargs["behavior_log"][0]["elapsed_seconds"] == 6

    def test_nudge_summary_normalises_severity_case(self, api, make_user, start_session):
        user = make_user()
        sid = start_session(user)["id"]
        resp = api(user, "post", f"/mca/sessions/{sid}/end", json={"nudge_log": [
            {**_QUIET, "severity": "CRITICAL"},
            {**_QUIET, "severity": "warning"},
            {**_QUIET, "severity": "Warning"},
        ]})
        assert resp.json()["nudge_summary"] == {"Critical": 1, "Warning": 2, "Info": 0}

    def test_end_result_is_readable_afterwards(self, api, make_user, start_session):
        user = make_user()
        sid = start_session(user)["id"]
        ended = api(user, "post", f"/mca/sessions/{sid}/end", json={"observation_log": _observations()}).json()
        fetched = api(user, "get", f"/mca/sessions/{sid}").json()
        assert fetched["status"] == "completed"
        assert fetched["overall_score"] == ended["overall_score"]
        assert fetched["skill_scores"] == ended["skill_scores"]


class TestEndSessionNegative:
    def test_end_unknown_session_is_404(self, api, make_user):
        # NEGATIVE: the session id doesn't exist, so there is nothing to close.
        resp = api(make_user(), "post", f"/mca/sessions/{uuid.uuid4()}/end", json={})
        assert resp.status_code == 404

    def test_end_someone_elses_session_is_403(self, api, make_user, start_session):
        # NEGATIVE: user B must not be able to close or overwrite user A's
        # session results (authorization check).
        owner, intruder = make_user("owner"), make_user("intruder")
        sid = start_session(owner)["id"]
        resp = api(intruder, "post", f"/mca/sessions/{sid}/end", json={})
        assert resp.status_code == 403

    def test_end_twice_is_400(self, api, make_user, start_session, db_session):
        # NEGATIVE: a completed session is final. Ending it again would
        # overwrite the stored score and duration.
        user = make_user()
        sid = start_session(user)["id"]
        first = api(user, "post", f"/mca/sessions/{sid}/end", json={"observation_log": _observations()}).json()
        resp = api(user, "post", f"/mca/sessions/{sid}/end", json={})
        assert resp.status_code == 400
        assert "completed" in resp.json()["detail"]
        db_session.expire_all()
        assert db_session.get(SessionResult, uuid.UUID(sid)).overall_score == first["overall_score"]

    def test_end_with_non_uuid_id_is_422(self, api, make_user):
        # NEGATIVE: path parameter isn't a UUID, so it must fail validation
        # rather than reaching the DB.
        resp = api(make_user(), "post", "/mca/sessions/not-a-uuid/end", json={})
        assert resp.status_code == 422

    def test_end_without_auth_is_401(self, api, make_user, start_session):
        # NEGATIVE: anonymous callers can't close sessions.
        sid = start_session(make_user())["id"]
        assert api(None, "post", f"/mca/sessions/{sid}/end", json={}).status_code == 401

    def test_end_with_invalid_payload_is_422_and_session_stays_active(self, api, make_user, start_session, db_session):
        # NEGATIVE: a nudge entry missing its severity is invalid. The
        # request must be rejected without half-closing the session.
        user = make_user()
        sid = start_session(user)["id"]
        resp = api(user, "post", f"/mca/sessions/{sid}/end",
                   json={"nudge_log": [{"message": "x", "category": "volume"}]})
        assert resp.status_code == 422
        db_session.expire_all()
        assert db_session.get(SessionResult, uuid.UUID(sid)).status == "active"

    def test_live_end_without_speech_falls_back_to_rule_based(self, api, make_user, start_session):
        # NEGATIVE: a live session with no transcript gives the LLM nothing to
        # judge. The real scorer returns None and rule-based scoring takes over.
        user = make_user()
        sid = start_session(user, "live")["id"]
        data = api(user, "post", f"/mca/sessions/{sid}/end", json={"observation_log": _observations()}).json()
        assert data["score_diagnostics"]["scoring_method"] == "rule_based_fallback"
        assert "llm_rationale" not in data["score_diagnostics"]

    @patch("app.api.v1.mca.sessions.mca_live_scorer.score", return_value=None)
    def test_live_end_when_llm_fails_falls_back(self, _score, api, make_user, start_session):
        # NEGATIVE: the LLM call failed (scorer returned None). The session
        # must still complete with a rule-based score, not a 500.
        user = make_user()
        sid = start_session(user, "live")["id"]
        resp = api(user, "post", f"/mca/sessions/{sid}/end", json={
            "user_transcript": [{"text": "Hello", "elapsed_seconds": 1}],
            "observation_log": _observations(),
        })
        assert resp.status_code == 200
        assert resp.json()["score_diagnostics"]["scoring_method"] == "rule_based_fallback"

    def test_empty_session_end_scores_neutral(self, api, make_user, start_session):
        # NEGATIVE: nothing was observed, so there is no evidence either way.
        # Every skill must be the neutral 50, and no emotion is dominant.
        user = make_user()
        sid = start_session(user)["id"]
        data = api(user, "post", f"/mca/sessions/{sid}/end", json={}).json()
        assert data["overall_score"] == 50
        assert data["dominant_emotion"] is None
        assert data["nudge_summary"] == {"Critical": 0, "Warning": 0, "Info": 0}


# Discard

class TestDiscardSessionPositive:
    def test_discard_active_session_removes_row(self, api, make_user, start_session, db_session):
        user = make_user()
        sid = start_session(user)["id"]
        assert api(user, "delete", f"/mca/sessions/{sid}").status_code == 204
        db_session.expire_all()
        assert db_session.get(SessionResult, uuid.UUID(sid)) is None
        assert api(user, "get", f"/mca/sessions/{sid}").status_code == 404


class TestDiscardSessionNegative:
    def test_discard_completed_session_is_400(self, api, make_user, start_session):
        # NEGATIVE: completed sessions hold real results used by analytics.
        # Only an in-progress session may be thrown away.
        user = make_user()
        sid = start_session(user)["id"]
        api(user, "post", f"/mca/sessions/{sid}/end", json={})
        resp = api(user, "delete", f"/mca/sessions/{sid}")
        assert resp.status_code == 400

    def test_discard_someone_elses_session_is_403(self, api, make_user, start_session, db_session):
        # NEGATIVE: users must not be able to delete each other's sessions.
        owner, intruder = make_user("owner"), make_user("intruder")
        sid = start_session(owner)["id"]
        assert api(intruder, "delete", f"/mca/sessions/{sid}").status_code == 403
        db_session.expire_all()
        assert db_session.get(SessionResult, uuid.UUID(sid)) is not None

    def test_discard_unknown_session_is_404(self, api, make_user):
        # NEGATIVE: there is nothing to delete.
        assert api(make_user(), "delete", f"/mca/sessions/{uuid.uuid4()}").status_code == 404


# Read / list

class TestReadSessionsPositive:
    def test_get_own_session(self, api, make_user, start_session):
        user = make_user()
        started = start_session(user, "live")
        data = api(user, "get", f"/mca/sessions/{started['id']}").json()
        assert data["id"] == started["id"]
        assert data["friendly_id"] == started["friendly_id"]

    def test_list_newest_first_with_pagination(self, api, make_user, start_session, db_session):
        user = make_user()
        ids = [start_session(user)["id"] for _ in range(3)]
        # Back-to-back requests can share a timestamp (coarse clock on Windows),
        # so give each session a distinct start time to make the order deterministic.
        base = datetime.now(timezone.utc)
        for i, sid in enumerate(ids):
            db_session.get(SessionResult, uuid.UUID(sid)).started_at = base + timedelta(seconds=i)
        db_session.commit()
        newest_first = list(reversed(ids))

        assert [s["id"] for s in api(user, "get", "/mca/sessions/").json()] == newest_first
        assert [s["id"] for s in api(user, "get", "/mca/sessions/?limit=2").json()] == newest_first[:2]
        assert [s["id"] for s in api(user, "get", "/mca/sessions/?limit=2&offset=2").json()] == newest_first[2:]

    def test_me_returns_all_sessions(self, api, make_user, start_session):
        user = make_user()
        for mode in ("ai", "live", "ai"):
            start_session(user, mode)
        assert len(api(user, "get", "/mca/sessions/me").json()) == 3


class TestReadSessionsNegative:
    def test_list_is_isolated_per_user(self, api, make_user, start_session):
        # NEGATIVE: user B's list must never include user A's sessions.
        a, b = make_user("a"), make_user("b")
        start_session(a)
        start_session(a)
        assert api(b, "get", "/mca/sessions/").json() == []
        assert api(b, "get", "/mca/sessions/me").json() == []

    def test_get_someone_elses_session_is_403(self, api, make_user, start_session):
        # NEGATIVE: session results are private to their owner.
        sid = start_session(make_user("owner"))["id"]
        assert api(make_user("other"), "get", f"/mca/sessions/{sid}").status_code == 403

    def test_get_unknown_session_is_404(self, api, make_user):
        # NEGATIVE: the session doesn't exist.
        assert api(make_user(), "get", f"/mca/sessions/{uuid.uuid4()}").status_code == 404

    def test_get_with_non_uuid_is_422(self, api, make_user):
        # NEGATIVE: an invalid id format must fail validation.
        assert api(make_user(), "get", "/mca/sessions/12345").status_code == 422

    def test_list_with_non_integer_limit_is_422(self, api, make_user):
        # NEGATIVE: pagination params must be integers.
        assert api(make_user(), "get", "/mca/sessions/?limit=ten").status_code == 422

    def test_offset_beyond_end_returns_empty(self, api, make_user, start_session):
        # NEGATIVE: paging past the last session returns an empty page, not an error.
        user = make_user()
        start_session(user)
        assert api(user, "get", "/mca/sessions/?offset=50").json() == []

    @pytest.mark.parametrize("path", ["/mca/sessions/", "/mca/sessions/me"])
    def test_list_without_auth_is_401(self, api, path):
        # NEGATIVE: listing sessions requires an authenticated user.
        assert api(None, "get", path).status_code == 401
