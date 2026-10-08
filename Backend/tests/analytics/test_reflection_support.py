"""The distress phrase list, and the offer it produces.

This is the one part of the component that speaks to a learner about something
other than presentation skill, so both directions of failure matter and both are
tested here:

  * A miss costs the only thing the feature exists for.
  * A false positive costs more than a wasted line of text - a learner who works
    out that certain words set something off writes a blander reflection next
    time, and the component loses the evidence it runs on.

The silent cases are therefore not filler. Several of them are real reflections
taken from this account's own data, and the rest are the phrasings that were
found to misfire while the list was being written.
"""
from app.services.reflection_support import distress_level, support_path_for


# Real reflections from this account, plus ordinary practice language. None of
# these may produce an offer.
SILENT = [
    # written by a real learner
    "I think I don't perform well because I was nervous.",
    "I was confuse in the session",
    "I think session is good. But I don't have any time to stay this session with.",
    "I perform well but I don't know it is ok to this session.",
    "I performed well in this session",
    "I was nervous and I rushed my opening",
    # ordinary nerves - the thing this must never answer
    "I was a bit anxious before presenting but it went fine",
    "This session was stressful but I got through it",
    "I still get anxious in the first minute",
    "I still felt nervous at the start",
    # "still" and "recently" in ordinary practice notes
    "I still need to work on my eye contact",
    "I recently started using the practice plan",
    "My pacing is still too fast",
    "Lately my delivery has improved a lot",
    # words that look like a theme and are not
    "I was sick of my own filler words lately",
    "My eye contact was sick honestly",
    "I recently improved my health and it shows",
    "My health is fine, I still rushed the ending",
    "I was alone in the room so it was easier",
    "I felt stressed during the Q and A but recovered",
]

# A theme that has lasted, or distress stated outright.
SUPPORT = [
    "I was stressed these days. I think I did my best.",
    "I have been stressed for weeks and it is affecting everything",
    "I have been anxious every day for months",
    "I have been anxious lately",
    "I am completely burnt out",
    "I can't sleep and I don't know what to do",
    "I feel overwhelmed with everything right now",
    "I think I am depressed",
    "I had a panic attack before this session",
    "I can't cope anymore",
    "I have a health problem that is affecting me every day",
    "I have been unwell for weeks",
    "family problems are constantly on my mind",
]

URGENT = [
    "sometimes I think I want to die",
    "I have been having suicidal thoughts",
    "I want to hurt myself",
]


class TestStaysSilent:
    """Ordinary practice language must never produce an offer."""

    def test_real_reflections_and_practice_language(self):
        offered = [text for text in SILENT if distress_level(text) is not None]
        assert offered == [], f"these should have stayed silent: {offered}"

    def test_nervous_alone_is_not_distress(self):
        # The commonest word in presentation practice. Answering it would treat a
        # normal feeling as a condition.
        assert distress_level("I was nervous") is None
        assert distress_level("I get nervous every time") is None

    def test_a_theme_without_duration_is_about_the_session(self):
        assert distress_level("I was stressed") is None
        assert distress_level("This session was stressful") is None

    def test_empty_and_missing_text(self):
        assert distress_level(None) is None
        assert distress_level("") is None
        assert distress_level("   ") is None


class TestOffersSupport:
    def test_a_lasting_theme_is_offered(self):
        missed = [text for text in SUPPORT if distress_level(text) != "support"]
        assert missed == [], f"these should have been offered support: {missed}"

    def test_a_theme_becomes_an_offer_once_it_has_lasted(self):
        # The pair that defines the rule.
        assert distress_level("I was stressed about this session") is None
        assert distress_level("I have been stressed for weeks") == "support"


class TestUrgent:
    def test_self_harm_language_is_urgent(self):
        for text in URGENT:
            assert distress_level(text) == "urgent", text

    def test_urgent_wins_over_support(self):
        assert distress_level("I am burnt out and I want to die") == "urgent"


class TestWordBoundaries:
    """Substring matches would fire on innocent words."""

    def test_alone_does_not_match_along(self):
        assert distress_level("I moved along too quickly all the time") is None

    def test_matching_ignores_case(self):
        assert distress_level("I am completely BURNT OUT") == "support"
        assert distress_level("I have been having SUICIDAL thoughts") == "urgent"


class TestSupportPath:
    def test_nothing_to_offer_returns_none(self):
        assert support_path_for(["I performed well", "I was nervous"]) is None
        assert support_path_for([]) is None
        assert support_path_for([None, ""]) is None

    def test_the_most_serious_level_wins_across_a_set(self):
        path = support_path_for(["I performed well", "I want to hurt myself", "I am burnt out"])
        assert path.level == "urgent"

    def test_the_offer_carries_every_contact(self):
        path = support_path_for(["I have been burnt out for weeks"])
        assert path.level == "support"
        assert [contact.number for contact in path.contacts] == [
            "1333", "1926", "011 269 6666",
        ]
        assert all(contact.name and contact.detail for contact in path.contacts)

    def test_the_message_never_names_a_condition(self):
        # It says what the page is and offers a number. Naming a state - "you
        # seem anxious", "this sounds like burnout" - is a diagnosis, which this
        # platform does not make and is not qualified to make.
        #
        # "If you are going through something harder than that" is a condition,
        # not a claim, which is why the check is on the vocabulary rather than on
        # the phrase "you are".
        conditions = (
            "depress", "anxiet", "anxious", "burnout", "burnt out",
            "stressed", "distress", "struggling", "unwell", "crisis",
        )
        for text in ("I am burnt out", "I want to die"):
            message = support_path_for([text]).message.lower()
            named = [word for word in conditions if word in message]
            assert named == [], f"the message names a condition: {named}"

    def test_the_message_gives_no_advice(self):
        # Signposting is not counselling. The only instruction it may carry is
        # to talk to one of the services listed beside it.
        advice = ("you should", "try to", "make sure", "remember to", "it helps to")
        for text in ("I am burnt out", "I want to die"):
            message = support_path_for([text]).message.lower()
            given = [phrase for phrase in advice if phrase in message]
            assert given == [], f"the message gives advice: {given}"

    def test_both_levels_offer_the_same_contacts(self):
        # The urgency changes the wording, never the list.
        support = support_path_for(["I am burnt out"])
        urgent = support_path_for(["I want to die"])
        assert [c.number for c in support.contacts] == [c.number for c in urgent.contacts]
        assert support.message != urgent.message
