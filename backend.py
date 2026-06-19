import asyncio
import base64
import json
import os
import io
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, Form
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
# CONVERSATION MEMORY
# ==========================================
conversation_history = [
    {
        "role": "system",
        "content": "You are a helpful AI avatar. CRITICAL RULE: You must ALWAYS answer in clear, simple English, regardless of what language the user speaks to you."
    }
]

class AskRequest(BaseModel):
    text: str
    persona: str = "Tutor"
    model_id: str = None

# ==========================================
# 🧠 3. ENDPOINT: Text Chat Ask Route
# ==========================================
@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text
    print(f"🧠 User asked: {user_text}")

    personas = {
        "Tutor": "You are a Friendly, Patient AI Tutor. Use simple words, be encouraging, and use emojis occasionally. CRITICAL RULE: You must ALWAYS answer in clear, simple English.",
        "Business": "You are a Professional, Polite AI Business Assistant. Use formal vocabulary, be concise, and focus on facts and efficiency. CRITICAL RULE: You must ALWAYS answer in clear, professional English.",
        "Casual": "You are a Casual, Friendly AI Companion. Speak like a friend, use slang occasionally, and be very relaxed. CRITICAL RULE: You must ALWAYS answer in clear, simple English."
    }

    selected_persona = personas.get(request.persona, personas["Tutor"])
    conversation_history[0] = {"role": "system", "content": selected_persona}
    print(f"🎭 Avatar is now acting as: {request.persona}")

    conversation_history.append({"role": "user", "content": user_text})

    selected_model = request.model_id or MODELS_CONFIG["default_model"]
    client, model_name = get_llm_client(selected_model)
    print(f"🤖 Using Model: {model_name}")

    try:
        response_en = client.chat.completions.create(
            model=model_name,
            messages=conversation_history
        )
        text_en = response_en.choices[0].message.content
        print(f"✅ English Answer: {text_en}")

        conversation_history.append({"role": "assistant", "content": text_en})

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
            await communicate_en.save("static/avatar_reply_en.mp3")
            print("🔊 English audio generated!")
            break
        except Exception as e:
            print(f"⚠️ English TTS failed (Attempt {attempt + 1}). Retrying...")
            if attempt == 2:
                return {"error": "Voice generation failed. Please try again."}

    for attempt in range(3):
        try:
            communicate_ja = edge_tts.Communicate(text_ja, "ja-JP-NanamiNeural")
            await communicate_ja.save("static/avatar_reply_ja.mp3")
            print("🔊 Japanese audio generated!")
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

@app.post("/ask_audio")
async def ask_avatar_audio(
    audio: UploadFile = File(...),
    persona: str = Form("Tutor"),
    model_id: Optional[str] = Form(None)
):
    transcription_result = await transcribe_audio(audio)
    if transcription_result.get("error"):
        return transcription_result

    transcribed_text = transcription_result.get("text")
    if not transcribed_text:
        return {"error": "Audio transcription returned no text."}

    ask_request = AskRequest(text=transcribed_text, persona=persona, model_id=model_id)
    response = await ask_avatar(ask_request)
    response["transcribed_text"] = transcribed_text
    return response

# ==========================================
# 🧠 4. AUDIO STREAM SERVERS (STATIC READS)
# ==========================================
@app.get("/audio_en")
async def get_audio_en():
    return FileResponse("static/avatar_reply_en.mp3", media_type="audio/mpeg")

@app.get("/audio_ja")
async def get_audio_ja():
    return FileResponse("static/avatar_reply_ja.mp3", media_type="audio/mpeg")

@app.get("/interview_audio_en")
async def get_interview_audio_en():
    return FileResponse("static/interview_reply_en.mp3", media_type="audio/mpeg")

@app.get("/interview_audio_ja")
async def get_interview_audio_ja():
    return FileResponse("static/interview_reply_ja.mp3", media_type="audio/mpeg")

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
    file_path = f"static/{audio.filename}"

    audio_content = await audio.read()
    with open(file_path, "wb") as f:
        f.write(audio_content)

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
# 🧠 6. CONNECTION MANAGER FOR AVATAR-CHAT WEBSOCKET
# ==========================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("🟢 A user joined the interview room!")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print("🔴 A user left the interview room.")

    async def broadcast(self, message: str):
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(message)
            except Exception:
                print("⚠️ Found a dead connection. Removing it automatically.")
                self.disconnect(connection)

manager = ConnectionManager()

# ==========================================
# 🌉 7. AVATAR CHAT WEBSOCKET (UNCHANGED — kept for backward compatibility)
# ==========================================
@app.websocket("/interview_room/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: int):
    await manager.connect(websocket)

    try:
        while True:
            data = await websocket.receive()
            message_type = data.get("type")

            if message_type == "websocket.disconnect":
                print(f"🔴 Client #{client_id} sent disconnect event.")
                break

            if "text" in data:
                print(f"📩 Received Text from Client {client_id}: {data['text']}")
                await manager.broadcast(f"Client #{client_id} says: {data['text']}")
                continue

            if "bytes" in data:
                complete_audio_bytes = data["bytes"]

                try:
                    print(f"🎤 Processing complete audio file ({len(complete_audio_bytes)} bytes)...")

                    normalized_audio_bytes = complete_audio_bytes
                    if PYDUB_AVAILABLE:
                        try:
                            audio_stream = io.BytesIO(complete_audio_bytes)
                            audio_segment = AudioSegment.from_file(audio_stream)
                            wav_io = io.BytesIO()
                            audio_segment.export(wav_io, format="wav", parameters=["-ac", "1", "-ar", "16000"])
                            normalized_audio_bytes = wav_io.getvalue()
                            print("🎵 Normalization: Converted raw container stream to robust WAV format.")
                        except Exception as conversion_error:
                            print(f"⚠️ Automatic WAV conversion bypassed ({conversion_error}). Using baseline data.")

                    spoken_text = ""

                    if TRANSCRIPTION_PROVIDER == "groq":
                        audio_file = io.BytesIO(normalized_audio_bytes)
                        audio_file.name = "input.wav"
                        transcript = groq_stt_client.audio.transcriptions.create(
                            model="whisper-large-v3",
                            file=audio_file,
                            prompt="Technical interview conversation."
                        )
                        spoken_text = transcript.text.strip()
                    else:
                        for attempt in range(3):
                            try:
                                response_stt = google_native_client.models.generate_content(
                                    model="gemini-2.0-flash",
                                    contents=[
                                        types.Part.from_bytes(data=normalized_audio_bytes, mime_type="audio/wav"),
                                        "Accurately transcribe this audio."
                                    ]
                                )
                                spoken_text = response_stt.text.strip() if response_stt.text else ""
                                break
                            except Exception as e:
                                if "503" in str(e) and attempt < 2:
                                    await asyncio.sleep(1)
                                    continue
                                raise e

                    if not spoken_text or len(spoken_text) < 2:
                        print("🤫 Stream evaluated as empty. Dropping.")
                        continue

                    print(f"📝 Full Sentence Transcribed: {spoken_text}")

                    client, model_name = get_llm_client("nvidia/meta/llama-3.1-70b-instruct")

                    system_instruction = (
                        "You are an expert AI Interpreter and Interviewer. "
                        "The user is speaking (possibly in Luganda, English, or another language). "
                        "YOUR TASKS:\n"
                        "1. Understand the user's intent and translate it into natural English.\n"
                        "2. Formulate a helpful, professional response in English.\n"
                        "3. Translate your English response into natural, polite, professional Japanese.\n"
                        "CRITICAL: You MUST respond ONLY with a raw JSON object. Do not include markdown.\n"
                        "Format: {'user_translation': 'English translation of user input', 'response_en': 'Your response in English', 'response_ja': 'Your response in Japanese'}"
                    )

                    combined_response = client.chat.completions.create(
                        model=model_name,
                        response_format={"type": "json_object"},
                        messages=[
                            {"role": "system", "content": system_instruction},
                            {"role": "user", "content": spoken_text}
                        ]
                    )

                    raw_content = combined_response.choices[0].message.content.strip()
                    parsed_payload = json.loads(raw_content)

                    user_english_text = parsed_payload.get("user_translation", spoken_text)
                    response_en = parsed_payload.get("response_en", "I understand.")
                    response_ja = parsed_payload.get("response_ja", "わかりました。")

                    print(f"🇬🇧 User Translation: {user_english_text}")
                    print(f"🇬🇧 AI Response (EN): {response_en}")
                    print(f"🇯🇵 AI Response (JA): {response_ja}")

                    tts_path_en = "static/interview_reply_en.mp3"
                    tts_path_ja = "static/interview_reply_ja.mp3"

                    communicate_en = edge_tts.Communicate(response_en, "en-US-AriaNeural")
                    await communicate_en.save(tts_path_en)

                    communicate_ja = edge_tts.Communicate(response_ja, "ja-JP-NanamiNeural")
                    await communicate_ja.save(tts_path_ja)

                    response_payload = json.dumps({
                        "type": "ai_response",
                        "user_translation": user_english_text,
                        "text_en": response_en,
                        "text_ja": response_ja,
                        "audio_url_en": "http://localhost:8000/interview_audio_en",
                        "audio_url_ja": "http://localhost:8000/interview_audio_ja"
                    })
                    await websocket.send_text(response_payload)

                except WebSocketDisconnect:
                    print(f"🔴 Client #{client_id} disconnected during send.")
                    break
                except Exception as e:
                    print(f"❌ AI Pipeline Error (Caught safely): {e}")
                    continue

    except WebSocketDisconnect:
        print(f"🔴 Client #{client_id} disconnected normally.")

    finally:
        manager.disconnect(websocket)