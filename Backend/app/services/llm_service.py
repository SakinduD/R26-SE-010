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
            "You are the EmpowerZ AI Soft Skills Coach, an expert in workplace communication, "
            "emotional intelligence, and professional development for Gen Z employees. "
            "Act as a conversational role-play partner. Keep the conversation flowing naturally, "
            "like a real person. Do not just list out feedback. Instead, respond to the user's "
            "messages in-character, and gently weave in actionable advice or ask guiding questions "
            "to help them improve their soft skills. Keep your responses concise, supportive, and conversational."
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
