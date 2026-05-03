from __future__ import annotations

_KEYWORD_MAP: dict[str, list[str]] = {
    "frustrated": [
        "unfair", "ridiculous", "impossible", "why do you", "i can't believe",
        "this is wrong", "that's not right", "not acceptable", "keep doing this",
        "sick of", "fed up", "enough of this",
    ],
    "anxious": [
        "worried", "nervous", "afraid", "i don't know", "not sure", "scared",
        "what if", "i might", "i'm not confident", "unsure", "stressing",
        "overwhelmed", "panicking",
    ],
    "assertive": [
        "i need", "i want", "this must", "please ensure", "i expect", "i require",
        "let me be clear", "i insist", "my position is", "i am asking", "i am requesting",
        "i will", "we need to",
    ],
    "calm": [
        "understand", "appreciate", "thank you", "i see", "makes sense", "of course",
        "happy to", "no problem", "certainly", "i agree", "let's work", "sounds good",
        "that's fair", "i respect",
    ],
    "confused": [
        "what do you mean", "i don't understand", "could you explain", "unclear",
        "huh", "pardon", "can you clarify", "not following", "lost me", "say again",
        "what exactly", "i'm confused",
    ],
}


class EmotionalMemory:
    def detect_emotion(self, user_input: str) -> str:
        try:
            from app.api.v1.rpe.ml.predict import predict_emotion
            result = predict_emotion(user_input)
            if result:
                return result
        except Exception:
            pass

        lower = user_input.lower()
        for emotion, keywords in _KEYWORD_MAP.items():
            if any(kw in lower for kw in keywords):
                return emotion
        return "calm"
