import json
import os
import io
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI

from typing import Optional
import edge_tts
from dotenv import load_dotenv

from google.genai import types

# ==========================================
# 🔗 SHARED CLIENTS (now centralized in clients.py)
# ==========================================
from clients import (
    groq_stt_client,
    google_native_client,
    get_llm_client,
    PYDUB_AVAILABLE,
)

try:
    from pydub import AudioSegment
except ImportError:
    pass

# ==========================================
# 🌐 LIVE TRANSLATION ROUTER (new, separate feature)
# ==========================================
from live_translation import router as live_translation_router

load_dotenv()

app = FastAPI()

# 🧠 CONFIGURATION SWITCH: Set this to "groq" or "gemini" to alternate transcription providers!
TRANSCRIPTION_PROVIDER = "groq"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount the live translation websocket routes (/live_translation/{room_id}/{role})
app.include_router(live_translation_router)

# Ensure the static asset directory exists
os.makedirs("static", exist_ok=True)

# ==========================================
# 🧠 1. LOAD MODEL CONFIGURATION
# ==========================================
try:
    with open("models_config.json", "r") as f:
        MODELS_CONFIG = json.load(f)
except FileNotFoundError:
    print("⚠️ models_config.json not found. Using fallback defaults.")
    MODELS_CONFIG = {
        "available_models": [{"id": "nvidia/meta/llama-3.1-70b-instruct", "name": "Llama 3.1 (NVIDIA)", "provider": "nvidia"}],
        "default_model": "nvidia/meta/llama-3.1-70b-instruct"
    }

# ==========================================
# 🧠 2. ENDPOINT: Get list of models for the UI Dropdown
# ==========================================
@app.get("/models")
async def get_available_models():
    return {
        "models": MODELS_CONFIG["available_models"],
        "default": MODELS_CONFIG["default_model"]
    }

# ==========================================
# CONVERSATION MEMORY (PER-SESSION)
# ==========================================
# Each browser tab/user gets its own isolated conversation history,
# keyed by a session_id generated on the frontend (e.g. crypto.randomUUID()).
# This replaces the old single global list that mixed everyone's chats together.
DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful AI avatar. CRITICAL RULE: You must ALWAYS answer in "
    "clear, simple English, regardless of what language the user speaks to you."
)

session_histories: dict[str, list[dict]] = {}

# Simple cap so abandoned sessions don't grow forever in memory
MAX_SESSIONS = 500
MAX_HISTORY_MESSAGES = 30  # system + last N turns


def get_session_history(session_id: str) -> list[dict]:
    """Fetch (or create) the conversation history for a given session_id."""
    if session_id not in session_histories:
        # Basic eviction: if we're at capacity, drop the oldest session.
        if len(session_histories) >= MAX_SESSIONS:
            oldest_key = next(iter(session_histories))
            del session_histories[oldest_key]
            print(f"🧹 Evicted oldest session ({oldest_key}) to free memory.")

        session_histories[session_id] = [
            {"role": "system", "content": DEFAULT_SYSTEM_PROMPT}
        ]
        print(f"🆕 Created new conversation history for session {session_id}")

    return session_histories[session_id]


def trim_history(history: list[dict]) -> list[dict]:
    """Keep the system prompt + the most recent messages only, to bound token usage."""
    if len(history) <= MAX_HISTORY_MESSAGES:
        return history
    return [history[0]] + history[-(MAX_HISTORY_MESSAGES - 1):]


class AskRequest(BaseModel):
    text: str
    persona: str = "Tutor"
    model_id: str = None
    session_id: str = "default"  # frontend should always send a real UUID

# ==========================================
# 🧠 3. ENDPOINT: Text Chat Ask Route
# ==========================================
@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text
    session_id = request.session_id or "default"
    print(f"🧠 [{session_id}] User asked: {user_text}")

    personas = {
        "Tutor": "You are a Friendly, Patient AI Tutor. Use simple words, be encouraging, and use emojis occasionally. CRITICAL RULE: You must ALWAYS answer in clear, simple English.",
        "Business": "You are a Professional, Polite AI Business Assistant. Use formal vocabulary, be concise, and focus on facts and efficiency. CRITICAL RULE: You must ALWAYS answer in clear, professional English.",
        "Casual": "You are a Casual, Friendly AI Companion. Speak like a friend, use slang occasionally, and be very relaxed. CRITICAL RULE: You must ALWAYS answer in clear, simple English."
    }

    selected_persona = personas.get(request.persona, personas["Tutor"])

    history = get_session_history(session_id)
    history[0] = {"role": "system", "content": selected_persona}
    print(f"🎭 [{session_id}] Avatar is now acting as: {request.persona}")

    history.append({"role": "user", "content": user_text})
    history[:] = trim_history(history)

    selected_model = request.model_id or MODELS_CONFIG["default_model"]
    client, model_name = get_llm_client(selected_model)
    print(f"🤖 Using Model: {model_name}")

    try:
        response_en = client.chat.completions.create(
            model=model_name,
            messages=history
        )
        text_en = response_en.choices[0].message.content
        print(f"✅ English Answer: {text_en}")

        history.append({"role": "assistant", "content": text_en})
        history[:] = trim_history(history)

        response_ja = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": "You are a professional translator. Translate the following text to natural, polite Japanese. Only output the Japanese text, nothing else."},
                {"role": "user", "content": text_en}
            ]
        )
        text_ja = response_ja.choices[0].message.content
        print(f"✅ Japanese Translation: {text_ja}")

    except Exception as e:
        print(f"❌ LLM Error: {e}")
        return {"error": f"Failed to generate response with model {model_name}."}

    for attempt in range(3):
        try:
            communicate_en = edge_tts.Communicate(text_en, "en-US-AriaNeural")
            await communicate_en.save(f"static/avatar_reply_en_{session_id}.mp3")
            print("🔊 English audio generated!")
            break
        except Exception as e:
            print(f"⚠️ English TTS failed (Attempt {attempt + 1}). Retrying...")
            if attempt == 2:
                return {"error": "Voice generation failed. Please try again."}

    for attempt in range(3):
        try:
            communicate_ja = edge_tts.Communicate(text_ja, "ja-JP-NanamiNeural")
            await communicate_ja.save(f"static/avatar_reply_ja_{session_id}.mp3")
            print("🔊 Japanese audio generated!")
            break
        except Exception as e:
            print(f"⚠️ Japanese TTS failed (Attempt {attempt + 1}). Retrying...")
            if attempt == 2:
                return {"error": "Voice generation failed. Please try again."}

    return {
        "text_en": text_en,
        "text_ja": text_ja,
        "audio_url_en": f"http://localhost:8000/audio_en/{session_id}",
        "audio_url_ja": f"http://localhost:8000/audio_ja/{session_id}"
    }

@app.post("/ask_audio")
async def ask_avatar_audio(
    audio: UploadFile = File(...),
    persona: str = Form("Tutor"),
    model_id: Optional[str] = Form(None),
    session_id: str = Form("default")
):
    transcription_result = await transcribe_audio(audio)
    if transcription_result.get("error"):
        return transcription_result

    transcribed_text = transcription_result.get("text")
    if not transcribed_text:
        return {"error": "Audio transcription returned no text."}

    ask_request = AskRequest(text=transcribed_text, persona=persona, model_id=model_id, session_id=session_id)
    response = await ask_avatar(ask_request)
    response["transcribed_text"] = transcribed_text
    return response

# ==========================================
# 🧠 4. AUDIO STREAM SERVERS (STATIC READS)
# ==========================================
@app.get("/audio_en/{session_id}")
async def get_audio_en(session_id: str):
    return FileResponse(f"static/avatar_reply_en_{session_id}.mp3", media_type="audio/mpeg")

@app.get("/audio_ja/{session_id}")
async def get_audio_ja(session_id: str):
    return FileResponse(f"static/avatar_reply_ja_{session_id}.mp3", media_type="audio/mpeg")

# 🌐 NEW: serves the per-message audio files generated by live_translation.py
@app.get("/translation_audio/{filename}")
async def get_translation_audio(filename: str):
    return FileResponse(f"static/{filename}", media_type="audio/mpeg")

# ==========================================
# 🧠 5. UPLOAD AUDIO FOR TRANSCRIPTION (REST API)
# ==========================================
@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    print(f"📁 Received audio file: {audio.filename}")

    audio_content = await audio.read()
    # No longer written to disk under the raw uploaded filename — two
    # simultaneous uploads with the same name (e.g. both browsers sending
    # "avatar_voice.webm") used to silently overwrite each other on disk.
    # Everything below already works directly from the in-memory bytes,
    # so the disk write was unnecessary I/O as well as a collision risk.

    try:
        normalized_bytes = audio_content
        if PYDUB_AVAILABLE:
            try:
                audio_stream = io.BytesIO(audio_content)
                audio_segment = AudioSegment.from_file(audio_stream)
                wav_io = io.BytesIO()
                audio_segment.export(wav_io, format="wav", parameters=["-ac", "1", "-ar", "16000"])
                normalized_bytes = wav_io.getvalue()
                print("🎵 Post-transcribe: Normalization Completed.")
            except Exception as e:
                print(f"⚠️ Post-transcribe normalization bypassed: {e}")

        if TRANSCRIPTION_PROVIDER == "groq":
            audio_file = io.BytesIO(normalized_bytes)
            audio_file.name = "input.wav"
            transcript = groq_stt_client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file,
                prompt="Technical interview context, manufacturing, drugs, business terms."
            )
            transcribed_text = transcript.text.strip()
        else:
            response = google_native_client.models.generate_content(
                model="gemini-2.0-flash",
                contents=[
                    types.Part.from_bytes(data=normalized_bytes, mime_type="audio/wav"),
                    "Provide a direct, raw transcription of this audio. Output only the transcribed text, nothing else."
                ]
            )
            transcribed_text = response.text.strip()

        print(f"✅ Transcribed: {transcribed_text}")
        return {"text": transcribed_text}
    except Exception as e:
        print(f"❌ Transcription Error: {e}")
        return {"error": f"Transcription failed: {str(e)}"}

# ==========================================
# NOTE: The old /interview_room/{client_id} websocket and its
# ConnectionManager have been removed. That route was fully replaced by:
#   - /ask_audio (Avatar Chat voice messages, now session-isolated)
#   - /live_translation/{room_id}/{role} (the new live interpreter feature)
# It also still wrote to shared filenames (static/interview_reply_en.mp3 /
# interview_reply_ja.mp3), which reintroduced the same collision bug we
# just fixed for /ask and /ask_audio. Removing it instead of patching it,
# since nothing in the current frontend calls it anymore.
# ==========================================