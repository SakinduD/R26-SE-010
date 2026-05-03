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

    async def get_response(self, prompt: str, history: list = None, context: dict = None) -> str:
        if not self.model:
            return "LLM Service is not configured. Please add GEMINI_API_KEY."

        try:
            # Convert raw metrics into a readable "Behavioral Insight" for the LLM
            behavioral_insight = ""
            if context:
                metrics = context.get("metrics", {})
                emotion = metrics.get("emotion", "Neutral")
                confidence = metrics.get("confidence", 0)
                pose = metrics.get("pose", {})
                
                behavioral_insight = (
                    f"\n[BEHAVIORAL INSIGHT: The user currently sounds {emotion} ({confidence*100:.0f}% confidence). "
                )
                
                # Add visual context if available
                if "ear" in metrics:
                    eye_state = "closed/squinting" if metrics["ear"] < 0.2 else "open"
                    behavioral_insight += f"Their eyes are {eye_state}. "
                
                if "yaw" in pose:
                    head_state = "looking away" if abs(pose["yaw"]) > 0.2 else "facing forward"
                    behavioral_insight += f"They are {head_state}. "
                
                behavioral_insight += "Adjust your tone to be supportive based on this state.]\n"

            # Prepend insight to the prompt (the user doesn't see this)
            full_prompt = behavioral_insight + prompt

            formatted_history = []
            if history:
                previous_messages = history[:-1] if len(history) > 0 and history[-1].get("text") == prompt else history
                for msg in previous_messages:
                    role = "user" if msg.get("type") == "user" else "model"
                    formatted_history.append({"role": role, "parts": [msg.get("text")]})
                
            chat = self.model.start_chat(history=formatted_history)
            response = chat.send_message(full_prompt)
            return response.text
        except Exception as e:
            return f"Error generating response: {str(e)}"

llm_service = LLMService()
