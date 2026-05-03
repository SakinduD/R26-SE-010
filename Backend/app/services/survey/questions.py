"""BFI-44 question bank — Oliver P. John's validated item wording (John, Donahue & Kentle, 1991)."""

BFI44_QUESTIONS: list[dict] = [
    # Extraversion (E): 1, 6R, 11, 16, 21R, 26, 31R, 36
    {"id": 1,  "text": "I see myself as someone who is talkative.", "trait": "E", "reverse": False},
    {"id": 2,  "text": "I see myself as someone who tends to find fault with others.", "trait": "A", "reverse": True},
    {"id": 3,  "text": "I see myself as someone who does a thorough job.", "trait": "C", "reverse": False},
    {"id": 4,  "text": "I see myself as someone who is depressed, blue.", "trait": "N", "reverse": False},
    {"id": 5,  "text": "I see myself as someone who is original, comes up with new ideas.", "trait": "O", "reverse": False},
    {"id": 6,  "text": "I see myself as someone who is reserved.", "trait": "E", "reverse": True},
    {"id": 7,  "text": "I see myself as someone who is helpful and unselfish with others.", "trait": "A", "reverse": False},
    {"id": 8,  "text": "I see myself as someone who can be somewhat careless.", "trait": "C", "reverse": True},
    {"id": 9,  "text": "I see myself as someone who is relaxed, handles stress well.", "trait": "N", "reverse": True},
    {"id": 10, "text": "I see myself as someone who is curious about many different things.", "trait": "O", "reverse": False},
    {"id": 11, "text": "I see myself as someone who is full of energy.", "trait": "E", "reverse": False},
    {"id": 12, "text": "I see myself as someone who starts quarrels with others.", "trait": "A", "reverse": True},
    {"id": 13, "text": "I see myself as someone who is a reliable worker.", "trait": "C", "reverse": False},
    {"id": 14, "text": "I see myself as someone who can be tense.", "trait": "N", "reverse": False},
    {"id": 15, "text": "I see myself as someone who is ingenious, a deep thinker.", "trait": "O", "reverse": False},
    {"id": 16, "text": "I see myself as someone who generates a lot of enthusiasm.", "trait": "E", "reverse": False},
    {"id": 17, "text": "I see myself as someone who has a forgiving nature.", "trait": "A", "reverse": False},
    {"id": 18, "text": "I see myself as someone who tends to be disorganized.", "trait": "C", "reverse": True},
    {"id": 19, "text": "I see myself as someone who worries a lot.", "trait": "N", "reverse": False},
    {"id": 20, "text": "I see myself as someone who has an active imagination.", "trait": "O", "reverse": False},
    {"id": 21, "text": "I see myself as someone who tends to be quiet.", "trait": "E", "reverse": True},
    {"id": 22, "text": "I see myself as someone who is generally trusting.", "trait": "A", "reverse": False},
    {"id": 23, "text": "I see myself as someone who tends to be lazy.", "trait": "C", "reverse": True},
    {"id": 24, "text": "I see myself as someone who is emotionally stable, not easily upset.", "trait": "N", "reverse": True},
    {"id": 25, "text": "I see myself as someone who is inventive.", "trait": "O", "reverse": False},
    {"id": 26, "text": "I see myself as someone who has an assertive personality.", "trait": "E", "reverse": False},
    {"id": 27, "text": "I see myself as someone who can be cold and aloof.", "trait": "A", "reverse": True},
    {"id": 28, "text": "I see myself as someone who perseveres until the task is finished.", "trait": "C", "reverse": False},
    {"id": 29, "text": "I see myself as someone who can be moody.", "trait": "N", "reverse": False},
    {"id": 30, "text": "I see myself as someone who values artistic, aesthetic experiences.", "trait": "O", "reverse": False},
    {"id": 31, "text": "I see myself as someone who is sometimes shy, inhibited.", "trait": "E", "reverse": True},
    {"id": 32, "text": "I see myself as someone who is considerate and kind to almost everyone.", "trait": "A", "reverse": False},
    {"id": 33, "text": "I see myself as someone who does things efficiently.", "trait": "C", "reverse": False},
    {"id": 34, "text": "I see myself as someone who remains calm in tense situations.", "trait": "N", "reverse": True},
    {"id": 35, "text": "I see myself as someone who prefers work that is routine.", "trait": "O", "reverse": True},
    {"id": 36, "text": "I see myself as someone who is outgoing, sociable.", "trait": "E", "reverse": False},
    {"id": 37, "text": "I see myself as someone who is sometimes rude to others.", "trait": "A", "reverse": True},
    {"id": 38, "text": "I see myself as someone who makes plans and follows through with them.", "trait": "C", "reverse": False},
    {"id": 39, "text": "I see myself as someone who gets nervous easily.", "trait": "N", "reverse": False},
    {"id": 40, "text": "I see myself as someone who likes to reflect, play with ideas.", "trait": "O", "reverse": False},
    {"id": 41, "text": "I see myself as someone who has few artistic interests.", "trait": "O", "reverse": True},
    {"id": 42, "text": "I see myself as someone who likes to cooperate with others.", "trait": "A", "reverse": False},
    {"id": 43, "text": "I see myself as someone who is easily distracted.", "trait": "C", "reverse": True},
    {"id": 44, "text": "I see myself as someone who is sophisticated in art, music, or literature.", "trait": "O", "reverse": False},
]

_TRAIT_COUNTS = {"E": 0, "A": 0, "C": 0, "N": 0, "O": 0}
for _q in BFI44_QUESTIONS:
    _TRAIT_COUNTS[_q["trait"]] += 1

assert len(BFI44_QUESTIONS) == 44, f"Expected 44 questions, got {len(BFI44_QUESTIONS)}"
assert _TRAIT_COUNTS == {"E": 8, "A": 9, "C": 9, "N": 8, "O": 10}, (
    f"Trait counts mismatch: {_TRAIT_COUNTS}"
)
