from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI
import edge_tts
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"], 
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)

# 🧠 INITIALIZE OPENAI (The Brain)
# PASTE YOUR OPENAI API KEY HERE!
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))



# ==========================================
# NEW: CONVERSATION MEMORY
# ==========================================
# This list holds the entire chat history. It resets when the server restarts.
conversation_history = [
    {
        "role": "system", 
        "content": "You are a helpful AI avatar. CRITICAL RULE: You must ALWAYS answer in clear, simple English, regardless of what language the user speaks to you. keep telling people to accept Christ as their savior. ."
    }
]

class AskRequest(BaseModel):
    text: str
    persona: str = "Tutor" # Default to Tutor if none is sent

@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text
    persona = request.persona
    print(f"🧠 User asked: {user_text}")
    
        # --- DYNAMIC PERSONA LOGIC ---
    # Define the personalities
    personas = {
        "Tutor": "You are a Friendly, Patient AI Tutor. Use simple words, be encouraging, and use emojis occasionally. CRITICAL RULE: You must ALWAYS answer in clear, simple English.",
        "Business": "You are a Professional, Polite AI Business Assistant. Use formal vocabulary, be concise, and focus on facts and efficiency. CRITICAL RULE: You must ALWAYS answer in clear, professional English.",
        "Casual": "You are a Casual, Friendly AI Companion. Speak like a friend, use slang occasionally, and be very relaxed. CRITICAL RULE: You must ALWAYS answer in clear, simple English."
    }
    
    # Get the selected persona (default to Tutor if it's something else)
    selected_persona = personas.get(request.persona, personas["Tutor"])
    
    # Update the very first message in the memory (the system prompt) to the new persona!
    conversation_history[0] = {"role": "system", "content": selected_persona}
    print(f"🎭 Avatar is now acting as: {request.persona}")

    # 2. Add the user's new message to the memory
    conversation_history.append({"role": "user", "content": user_text})
    
    # 2. Send the ENTIRE history to OpenAI so it remembers context
    response_en = openai_client.chat.completions.create(
        model="gpt-4o", 
        messages=conversation_history
    )
    text_en = response_en.choices[0].message.content
    print(f"✅ English Answer: {text_en}")
    
    # 3. Add the AI's English answer back to the memory
    conversation_history.append({"role": "assistant", "content": text_en})
    
    # 4. Translate to Japanese using OpenAI
    response_ja = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a professional translator. Translate the following text to natural, polite Japanese. Only output the Japanese text, nothing else."},
            {"role": "user", "content": text_en}
        ]
    )
    text_ja = response_ja.choices[0].message.content
    print(f"✅ Japanese Translation: {text_ja}")
    
    # 5. Generate ENGLISH Audio
    for attempt in range(3):
        try:
            communicate_en = edge_tts.Communicate(text_en, "en-US-AriaNeural")
            await communicate_en.save("static/avatar_reply_en.mp3")
            print("🔊 English audio generated!")
            break
        except Exception as e:
            print(f"⚠️ English TTS failed (Attempt {attempt + 1}). Retrying...")
            if attempt == 2:
                return {"error": "Voice generation failed. Please try again."}
    
    # 6. Generate JAPANESE Audio
    for attempt in range(3):
        try:
            communicate_ja = edge_tts.Communicate(text_ja, "ja-JP-NanamiNeural")
            await communicate_ja.save("static/avatar_reply_ja.mp3")
            print(" Japanese audio generated!")
            break
        except Exception as e:
            print(f"⚠️ Japanese TTS failed (Attempt {attempt + 1}). Retrying...")
            if attempt == 2:
                return {"error": "Voice generation failed. Please try again."}
    
    return {
        "text_en": text_en,
        "text_ja": text_ja,
        "audio_url_en": "http://localhost:8000/audio_en",
        "audio_url_ja": "http://localhost:8000/audio_ja"
    }

@app.get("/audio_en")
async def get_audio_en():
    return FileResponse("static/avatar_reply_en.mp3", media_type="audio/mpeg")

@app.get("/audio_ja")
async def get_audio_ja():
    return FileResponse("static/avatar_reply_ja.mp3", media_type="audio/mpeg")

# ==========================================
# UPLOAD AUDIO FOR TRANSCRIPTION (WHISPER)
# ==========================================
@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    print(f"📁 Received audio file: {audio.filename}")
    file_path = f"static/{audio.filename}"
    with open(file_path, "wb") as f:
        f.write(await audio.read())
        
    with open(file_path, "rb") as f:
        transcript = openai_client.audio.transcriptions.create(
            model="whisper-1",
            file=f
        )
    print(f"✅ Transcribed: {transcript.text}")
    return {"text": transcript.text}