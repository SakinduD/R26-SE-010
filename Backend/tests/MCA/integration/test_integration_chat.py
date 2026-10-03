"""Integration tests for the AI-mode chatbot endpoint and its link to MCA sessions.

The LLM service is mocked; the router, auth, rate limiter and DB updates are real.
"""
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from app.models.session_result import SessionResult

pytestmark = pytest.mark.integration

_LLM = "app.api.v1.mca.chat.llm_service.get_response"


def _chat_turns(db_session, sid) -> int | None:
    db_session.expire_all()
    return db_session.get(SessionResult, uuid.UUID(sid)).chat_turns


class TestChatPositive:
    @patch(_LLM, new_callable=AsyncMock, return_value="Try opening with a question.")
    def test_chat_forwards_history_and_context(self, mock_llm, api, make_user):
        history = [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello!"}]
        context = {"emotion": "neutral", "nudge": None}
        resp = api(make_user(), "post", "/mca/chat/", json={
            "message": "How do I start my talk?", "history": history, "context": context,
        })
        assert resp.status_code == 200
        assert resp.json() == {
            "isSuccessful": True, "message": "Chat generated successfully",
            "data": "Try opening with a question.",
        }
        args, kwargs = mock_llm.call_args
        assert args[0] == "How do I start my talk?"
        assert kwargs["history"] == history
        assert kwargs["context"] == context

    @patch(_LLM, new_callable=AsyncMock, return_value="ok")
    def test_chat_increments_turns_on_active_session(self, _llm, api, make_user, start_session, db_session):
        user = make_user()
        sid = start_session(user, "ai")["id"]
        for _ in range(3):
            api(user, "post", "/mca/chat/", json={"message": "hello", "session_id": sid})
        assert _chat_turns(db_session, sid) == 3

    @patch(_LLM, new_callable=AsyncMock, return_value="ok")
    def test_full_ai_flow_start_chat_end(self, _llm, api, make_user, start_session):
        user = make_user()
        sid = start_session(user, "ai")["id"]
        api(user, "post", "/mca/chat/", json={"message": "one", "session_id": sid})
        api(user, "post", "/mca/chat/", json={"message": "two", "session_id": sid})

        ended = api(user, "post", f"/mca/sessions/{sid}/end", json={}).json()
        assert ended["status"] == "completed"
        assert ended["chat_turns"] == 2  # counted server-side, not sent by the client


class TestChatNegative:
    def test_chat_without_auth_is_401(self, api):
        # NEGATIVE: anonymous users could run up LLM cost, so auth is required.
        assert api(None, "post", "/mca/chat/", json={"message": "hi"}).status_code == 401

    def test_chat_missing_message_is_422(self, api, make_user):
        # NEGATIVE: "message" is a required field of ChatRequest.
        assert api(make_user(), "post", "/mca/chat/", json={"history": []}).status_code == 422

    @patch(_LLM, new_callable=AsyncMock)
    def test_whitespace_message_never_reaches_llm(self, mock_llm, api, make_user):
        # NEGATIVE: a blank message is rejected up front so no LLM call is spent on it.
        resp = api(make_user(), "post", "/mca/chat/", json={"message": "\n\t  "})
        assert resp.json()["isSuccessful"] is False
        mock_llm.assert_not_called()

    @patch(_LLM, new_callable=AsyncMock, side_effect=RuntimeError("model overloaded"))
    def test_llm_failure_returns_unsuccessful_response(self, _llm, api, make_user):
        # NEGATIVE: the AI engine raised. The endpoint reports the failure in
        # the body (isSuccessful=False) instead of a 500 that would break the chat UI.
        resp = api(make_user(), "post", "/mca/chat/", json={"message": "hi"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["isSuccessful"] is False
        assert "model overloaded" in body["message"]

    @patch(_LLM, new_callable=AsyncMock, return_value="ok")
    def test_invalid_session_id_does_not_break_chat(self, _llm, api, make_user):
        # NEGATIVE: a malformed session_id is ignored. Linking turns is
        # non-critical, so the chat reply must still succeed.
        resp = api(make_user(), "post", "/mca/chat/", json={"message": "hi", "session_id": "garbage"})
        assert resp.json()["isSuccessful"] is True

    @patch(_LLM, new_callable=AsyncMock, return_value="ok")
    def test_turns_not_counted_on_someone_elses_session(self, _llm, api, make_user, start_session, db_session):
        # NEGATIVE: user B passing user A's session_id must not inflate A's
        # chat_turns (cross-user tampering).
        owner, other = make_user("owner"), make_user("other")
        sid = start_session(owner, "ai")["id"]
        api(other, "post", "/mca/chat/", json={"message": "hi", "session_id": sid})
        assert _chat_turns(db_session, sid) is None

    @patch(_LLM, new_callable=AsyncMock, return_value="ok")
    def test_turns_not_counted_after_session_completed(self, _llm, api, make_user, start_session, db_session):
        # NEGATIVE: a completed session's result is frozen. Later chat
        # messages must not change its stored chat_turns.
        user = make_user()
        sid = start_session(user, "ai")["id"]
        api(user, "post", f"/mca/sessions/{sid}/end", json={"chat_turns": 4})
        api(user, "post", "/mca/chat/", json={"message": "late message", "session_id": sid})
        assert _chat_turns(db_session, sid) == 4

    @patch(_LLM, new_callable=AsyncMock, return_value="ok")
    def test_rate_limit_is_per_user(self, _llm, api, make_user):
        # NEGATIVE: once user A hits the 15/min cap they get 429, but this
        # must not block user B (limit is keyed by user id, not global).
        a, b = make_user("a"), make_user("b")
        for _ in range(15):
            api(a, "post", "/mca/chat/", json={"message": "hi"})
        blocked = api(a, "post", "/mca/chat/", json={"message": "hi"})
        assert blocked.status_code == 429
        assert int(blocked.headers["Retry-After"]) >= 1
        assert api(b, "post", "/mca/chat/", json={"message": "hi"}).status_code == 200
