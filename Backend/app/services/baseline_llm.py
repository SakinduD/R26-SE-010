"""
Baseline-specific LLM service.

Uses the legacy google-generativeai SDK (same as llm_service.py / MCA chat)
with a baseline assessor persona. Kept in a separate module so pedagogy.py
(which uses the new google-genai SDK via get_llm_client) never imports both
SDKs in the same file.
"""
import google.generativeai as genai

from app.config import get_settings

_settings = get_settings()

_SYSTEM_INSTRUCTION = (
    "You are a communication baseline assessor for EmpowerZ. "
    "Guide the user through a brief, natural conversation to understand their "
    "current communication style and professional presence.\n\n"
    "Your goal is to elicit authentic speech that reveals: vocal confidence and "
    "directness, fluency and clarity of thought, engagement and professional presence, "
    "and emotional awareness.\n\n"
    "Rules:\n"
    "- Keep your responses to 2–3 sentences maximum. Be warm and encouraging.\n"
    "- Ask ONE open-ended question at a time about professional experiences, goals, "
    "or communication challenges.\n"
    "- Do not mention scoring, assessment, or evaluation explicitly.\n"
    "- Treat this as a friendly professional conversation, not a test.\n"
    "- After the user's 4th or 5th message, conclude warmly and thank them."
)


class BaselineLLMService:
    def __init__(self) -> None:
        if _settings.gemini_api_key:
            genai.configure(api_key=_settings.gemini_api_key)
            self.model = genai.GenerativeModel(
                model_name="gemini-3.1-flash-lite-preview",
                system_instruction=_SYSTEM_INSTRUCTION,
            )
        else:
            self.model = None

    async def get_response(
        self,
        prompt: str,
        history: list | None = None,
        context: dict | None = None,
    ) -> str:
        if not self.model:
            return "LLM Service is not configured. Please add GEMINI_API_KEY."
        try:
            formatted_history: list[dict] = []
            if history:
                previous = (
                    history[:-1]
                    if history and history[-1].get("text") == prompt
                    else history
                )
                for msg in previous:
                    role = "user" if msg.get("type") == "user" else "model"
                    formatted_history.append({"role": role, "parts": [msg.get("text", "")]})

            chat = self.model.start_chat(history=formatted_history)
            response = chat.send_message(prompt)
            return response.text
        except Exception as exc:
            return f"Error generating response: {exc}"


baseline_llm_service = BaselineLLMService()
