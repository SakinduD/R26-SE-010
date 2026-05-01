import google.generativeai as genai
from app.core.config import settings

## gemini-flash-latest or gemini-3.1-flash-lite-preview
class LLMService:
    def __init__(self):
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self.model = genai.GenerativeModel(
                model_name='gemini-3.1-flash-lite-preview',
                system_instruction=(
                    "You are a sophisticated AI conversational partner for EmpowerZ, designed to help users "
                    "naturally improve their soft skills through genuine dialogue. "
                    "Do not emphasize that this is a 'role-play' or that you are a 'coach'. Instead, be a "
                    "supportive, professional colleague or mentor. Engage in natural, flowing conversation. "
                    "Do not give bulleted feedback or lecture the user. Instead, respond thoughtfully to "
                    "what they say, and organically guide the conversation in a way that encourages them "
                    "to practice empathy, clarity, and professional confidence. Keep your tone "
                    "warm, authentic, and concise."
                )
            )
        else:
            self.model = None

    async def get_response(self, prompt: str, history: list = None) -> str:
        if not self.model:
            return "LLM Service is not configured. Please add GEMINI_API_KEY."

        try:
            formatted_history = []
            if history:
                # The frontend sends the entire history including the *new* prompt at the end.
                # We need to extract the previous history to initialize the chat state.
                previous_messages = history[:-1] if len(history) > 0 and history[-1].get("text") == prompt else history
                
                for msg in previous_messages:
                    # Gemini chat history roles strictly require 'user' and 'model'
                    role = "user" if msg.get("type") == "user" else "model"
                    formatted_history.append({"role": role, "parts": [msg.get("text")]})
                
            chat = self.model.start_chat(history=formatted_history)
            
            # Send the new prompt directly to the chat session
            response = chat.send_message(prompt)
            return response.text
        except Exception as e:
            return f"Error generating response: {str(e)}"

llm_service = LLMService()
