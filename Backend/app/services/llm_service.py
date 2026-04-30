import google.generativeai as genai
from app.core.config import settings

class LLMService:
    def __init__(self):
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self.model = genai.GenerativeModel('gemini-flash-latest')
        else:
            self.model = None

    async def get_response(self, prompt: str, history: list = None) -> str:
        if not self.model:
            return "LLM Service is not configured. Please add GEMINI_API_KEY."

        # Soft skills coach persona instructions
        system_instruction = (
            "You are a sophisticated AI conversational partner for EmpowerZ, designed to help users "
            "naturally improve their soft skills through genuine dialogue. "
            "Do not emphasize that this is a 'role-play' or that you are a 'coach'. Instead, be a "
            "supportive, professional colleague or mentor. Engage in natural, flowing conversation. "
            "Do not give bulleted feedback or lecture the user. Instead, respond thoughtfully to "
            "what they say, and organically guide the conversation in a way that encourages them "
            "to practice empathy, clarity, and professional confidence. Keep your tone "
            "warm, authentic, and concise."
        )

        try:
            formatted_history = ""
            if history:
                for msg in history:
                    role = "User" if msg.get("type") == "user" else "Coach"
                    formatted_history += f"{role}: {msg.get('text')}\n"
                
                full_prompt = f"{system_instruction}\n\nConversation History:\n{formatted_history}Coach:"
            else:
                full_prompt = f"{system_instruction}\n\nUser: {prompt}\nCoach:"
                
            response = self.model.generate_content(full_prompt)
            return response.text
        except Exception as e:
            return f"Error generating response: {str(e)}"

llm_service = LLMService()
