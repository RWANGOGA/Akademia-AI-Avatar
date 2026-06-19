from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import google.generativeai as genai
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

# 🧠 INITIALIZE GEMINI (The Brain)
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-2.0-flash")

conversation_history = []

personas = {
    "Tutor": "You are a Friendly, Patient AI Tutor. Use simple words, be encouraging, and use emojis occasionally. CRITICAL RULE: You must ALWAYS answer in clear, simple English.",
    "Business": "You are a Professional, Polite AI Business Assistant. Use formal vocabulary, be concise, and focus on facts and efficiency. CRITICAL RULE: You must ALWAYS answer in clear, professional English.",
    "Casual": "You are a Casual, Friendly AI Companion. Speak like a friend, use slang occasionally, and be very relaxed. CRITICAL RULE: You must ALWAYS answer in clear, simple English."
}

class AskRequest(BaseModel):
    text: str
    persona: str = "Tutor"

@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text
    selected_persona = personas.get(request.persona, personas["Tutor"])
    print(f"🧠 User asked: {user_text}")
    print(f"🎭 Avatar is now acting as: {request.persona}")

    history_text = ""
    for turn in conversation_history[-10:]:
        history_text += f"{turn['role']}: {turn['content']}\n"

    full_prompt = f"{selected_persona}\n\nConversation so far:\n{history_text}\nuser: {user_text}\nassistant:"

    response_en = model.generate_content(full_prompt)
    text_en = response_en.text.strip()
    print(f"✅ English Answer: {text_en}")

    conversation_history.append({"role": "user", "content": user_text})
    conversation_history.append({"role": "assistant", "content": text_en})

    translate_prompt = f"Translate the following text to natural, polite Japanese. Only output the Japanese text, nothing else.\n\nText: {text_en}"
    response_ja = model.generate_content(translate_prompt)
    text_ja = response_ja.text.strip()
    print(f"✅ Japanese Translation: {text_ja}")

    for attempt in range(3):
        try:
            communicate_en = edge_tts.Communicate(text_en, "en-US-AriaNeural")
            await communicate_en.save("static/avatar_reply_en.mp3")
            print("🔊 English audio generated!")
            break
        except Exception:
            print(f"⚠️ English TTS failed (Attempt {attempt + 1}). Retrying...")
            if attempt == 2:
                return {"error": "Voice generation failed. Please try again."}

    for attempt in range(3):
        try:
            communicate_ja = edge_tts.Communicate(text_ja, "ja-JP-NanamiNeural")
            await communicate_ja.save("static/avatar_reply_ja.mp3")
            print("🔊 Japanese audio generated!")
            break
        except Exception:
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

@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    print(f"📁 Received audio file: {audio.filename}")
    file_path = f"static/{audio.filename}"
    with open(file_path, "wb") as f:
        f.write(await audio.read())

    uploaded_file = genai.upload_file(file_path)
    response = model.generate_content([
        "Transcribe this audio exactly as spoken. Only output the transcribed text, nothing else.",
        uploaded_file
    ])
    transcript_text = response.text.strip()
    print(f"✅ Transcribed: {transcript_text}")

    return {"text": transcript_text}