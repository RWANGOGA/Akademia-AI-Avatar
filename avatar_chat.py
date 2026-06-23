import io
import json
import os
from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import edge_tts

from clients import (
    smart_transcribe,
    smart_llm_call,
    PYDUB_AVAILABLE,
)

try:
    from pydub import AudioSegment
except ImportError:
    pass

router = APIRouter()

# ==========================================
# 🧠 1. LOAD MODEL CONFIGURATION
# ==========================================
try:
    with open("models_config.json", "r") as f:
        MODELS_CONFIG = json.load(f)
except FileNotFoundError:
    print("⚠️ models_config.json not found. Using fallback defaults.")
    MODELS_CONFIG = {
        "available_models": [
            {"id": "groq/llama-3.3-70b-versatile", "name": "Llama 3.3 70B (Groq - Ultra Fast)", "provider": "groq"},
            {"id": "nvidia/meta/llama-3.1-70b-instruct", "name": "Llama 3.1 70B (NVIDIA - Fallback)", "provider": "nvidia"}
        ],
        "default_model": "groq/llama-3.3-70b-versatile"
    }

# ==========================================
# CONVERSATION MEMORY (PER-SESSION)
# ==========================================
DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful AI avatar. CRITICAL RULE: You must ALWAYS answer in "
    "clear, simple English, regardless of what language the user speaks to you."
)

session_histories: dict[str, list[dict]] = {}

MAX_SESSIONS = 500
MAX_HISTORY_MESSAGES = 30


def get_session_history(session_id: str) -> list[dict]:
    """Fetch (or create) the conversation history for a given session_id."""
    if session_id not in session_histories:
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
    """Keep the system prompt + the most recent messages only."""
    if len(history) <= MAX_HISTORY_MESSAGES:
        return history
    return [history[0]] + history[-(MAX_HISTORY_MESSAGES - 1):]


class AskRequest(BaseModel):
    text: str
    persona: str = "Tutor"
    model_id: Optional[str] = None  # ✅ Made optional with None default
    session_id: str = "default"

# ==========================================
# 🧠 3. ENDPOINT: Text Chat Ask Route
# ==========================================
@router.post("/ask")
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

    try:
        # ✅ Primary LLM response (Groq → NVIDIA fallback)
        text_en = smart_llm_call(history, temperature=0.7)
        if not text_en:
            return {"error": "All LLM providers failed to generate response."}
        
        print(f"✅ English Answer: {text_en}")

        history.append({"role": "assistant", "content": text_en})
        history[:] = trim_history(history)

        # ✅ Translation to Japanese (also uses smart_llm_call)
        text_ja = smart_llm_call([
            {"role": "system", "content": "You are a professional translator. Translate the following text to natural, polite Japanese. Only output the Japanese text, nothing else."},
            {"role": "user", "content": text_en}
        ], temperature=0.3)
        
        if not text_ja:
            text_ja = "翻訳に失敗しました。"
        
        print(f"✅ Japanese Translation: {text_ja}")

    except Exception as e:
        print(f"❌ LLM Error: {e}")
        return {"error": "Failed to generate response."}

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

@router.post("/ask_audio")
async def ask_avatar_audio(
    audio: UploadFile = File(...),
    persona: str = Form("Tutor"),
    model_id: Optional[str] = Form(None),  # ✅ Made optional
    session_id: str = Form("default")
):
    transcription_result = await transcribe_audio(audio)
    if transcription_result.get("error"):
        return transcription_result

    transcribed_text = transcription_result.get("text")
    if not transcribed_text:
        return {"error": "Audio transcription returned no text."}

    ask_request = AskRequest(
        text=transcribed_text, 
        persona=persona, 
        model_id=model_id or "",  # ✅ Convert None to empty string
        session_id=session_id
    )
    response = await ask_avatar(ask_request)
    response["transcribed_text"] = transcribed_text
    return response

# ==========================================
# 🧠 4. AUDIO STREAM SERVERS (STATIC READS)
# ==========================================
@router.get("/audio_en/{session_id}")
async def get_audio_en(session_id: str):
    return FileResponse(f"static/avatar_reply_en_{session_id}.mp3", media_type="audio/mpeg")

@router.get("/audio_ja/{session_id}")
async def get_audio_ja(session_id: str):
    return FileResponse(f"static/avatar_reply_ja_{session_id}.mp3", media_type="audio/mpeg")

# ==========================================
# 🧠 5. UPLOAD AUDIO FOR TRANSCRIPTION (REST API)
# ==========================================
@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    print(f"📁 Received audio file: {audio.filename}")

    audio_content = await audio.read()

    try:
        # Normalize audio if pydub is available
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

        # ✅ Smart transcription (Deepgram → Groq Whisper fallback)
        transcribed_text = smart_transcribe(
            normalized_bytes,
            prompt="Technical interview context, manufacturing, drugs, business terms."
        )
        
        if not transcribed_text:
            return {"error": "All transcription providers failed."}

        print(f"✅ Transcribed: {transcribed_text}")
        return {"text": transcribed_text}
    except Exception as e:
        print(f"❌ Transcription Error: {e}")
        return {"error": f"Transcription failed: {str(e)}"}