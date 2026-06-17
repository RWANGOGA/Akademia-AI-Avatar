import os
import asyncio
import edge_tts
from openai import OpenAI

# ==========================================
# 1. SETUP API KEYS
# ==========================================
# We only need OpenAI now! ElevenLabs is removed.
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = OpenAI(api_key=OPENAI_API_KEY)

# ==========================================
# 2. DEFINE THE AVATAR'S PERSONA
# ==========================================
SYSTEM_PROMPT = """
You are an advanced AI Avatar developed by the Akademia Internship team. 
Your mission is to bridge cultures (like Japan and Uganda) and assist users in education, business, and commerce. 
Be polite, clear, and encouraging. Keep your responses concise (under 3 sentences).
"""

# ==========================================
# 3. THE CORE FUNCTIONS
# ==========================================
def get_ai_response(user_input):
    print("🧠 AI is thinking...")
    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input}
        ]
    )
    ai_text = response.choices[0].message.content
    print(f"✅ AI Response: {ai_text}\n")
    return ai_text

async def speak_text_async(text_to_speak):
    print(" Generating voice via Edge-TTS (100% Free)...")
    
    # Auto-detect language to pick the right natural voice
    if any(char in text_to_speak for char in "こんにちは"):
        voice = "ja-JP-NanamiNeural"  # Beautiful Japanese female voice
    else:
        voice = "en-US-AriaNeural"    # Natural English female voice
        
    communicate = edge_tts.Communicate(text_to_speak, voice)
    await communicate.save("temp_avatar_audio.mp3")
    
    print(" Playing audio on your Mac... (Turn up your speakers!)")
    os.system("afplay temp_avatar_audio.mp3")
    print("✅ Audio finished playing!\n")

def speak_text(text):
    # Helper to run the async TTS function in our standard script
    asyncio.run(speak_text_async(text))

# ==========================================
# 4. LET'S TEST IT!
# ==========================================
if __name__ == "__main__":
    print("--- PHASE 1: BRAIN & VOICE TEST ---")
    
    # Test 1: English
    reply_1 = get_ai_response("Can you explain how AI avatars help in offshore development ,agriculture, education, research, commerce, health and other fields and how in those fields practically?")
    speak_text(reply_1)
    
    # Test 2: Japanese
    reply_2 = get_ai_response("こんにちは、日本のビジネス文化について教えてください。")
    speak_text(reply_2)
    
    print("--- 🎉 PHASE 1 COMPLETE! SUCCESS! 🎉 ---")