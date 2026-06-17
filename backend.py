import json
from fastapi import WebSocket, WebSocketDisconnect
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from openai import OpenAI
import edge_tts
import os
import io

from dotenv import load_dotenv

load_dotenv()

if not os.getenv("GROQ_API_KEY"):
    print("⚠️ GROQ_API_KEY is missing. Audio transcription will fail.")
if not os.getenv("NVIDIA_API_KEY"):
    print("⚠️ NVIDIA_API_KEY is missing. LLM responses may fail.")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"], 
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)

# ==========================================
# 🧠 1. LOAD MODEL CONFIGURATION
# ==========================================
# This reads your JSON file so you can add/remove models without touching Python code.
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
# 🧠 2. DYNAMIC MODEL ROUTER (Automatic)
# ==========================================
def get_llm_client(model_id: str):
    """
    Automatically routes to the correct API based on the model prefix.
    No manual code changes needed to switch models!
    """
    if model_id.startswith("nvidia/"):
        client = OpenAI(
            api_key=os.getenv("NVIDIA_API_KEY"),
            base_url="https://integrate.api.nvidia.com/v1"
        )
        clean_model = model_id.replace("nvidia/", "")
    else:
        # Defaults to OpenAI for any other prefix (e.g., "openai/")
        client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY")
        )
        clean_model = model_id.replace("openai/", "")
    
    return client, clean_model

# 🎤 Dedicated client for Speech-to-Text (Using NVIDIA NIM!)
stt_client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://integrate.api.groq.com/v1"
)

# ==========================================
# 🧠 3. ENDPOINT: Get list of models for the UI Dropdown
# ==========================================
@app.get("/models")
async def get_available_models():
    """Returns the list of models for the frontend dropdown"""
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

@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text
    persona = request.persona
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
        
        # 2. Translate to Japanese
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
    
    # 3. Generate ENGLISH Audio
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
    
    # 4. Generate JAPANESE Audio
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
        
    try:
        with open(file_path, "rb") as f:
            transcript = stt_client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=f
            )
        print(f"✅ Transcribed: {transcript.text}")
        return {"text": transcript.text}
    except Exception as e:
        print(f"❌ Transcription Error: {e}")
        return {"error": "Transcription failed. Ensure your OpenAI API key is set in the .env file."}

# ==========================================
# CONNECTION MANAGER
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
# 🌉 LIVE INTERVIEW: WEBSOCKET
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
                audio_bytes = data["bytes"]
                
                try:
                    print(f"🎤 Processing audio chunk ({len(audio_bytes)} bytes)...")
                    
                    # Process in RAM using io.BytesIO!
                    audio_file = io.BytesIO(audio_bytes)
                    
                    # A. TRANSCRIBE (Using Groq's free Whisper)
                    transcript = stt_client.audio.transcriptions.create(
                        model="whisper-large-v3", 
                        file=audio_file
                    )
                    spoken_text = transcript.text.strip()
                    if not spoken_text:
                        continue # Skip empty chunks (silence)
                    
                    # B. TRANSLATE & RESPOND (Uses NVIDIA LLM)
                    client, model_name = get_llm_client("nvidia/meta/llama-3.1-70b-instruct")
                    response = client.chat.completions.create(
                        model=model_name,
                        messages=[
                            {"role": "system", "content": "You are a helpful translator. Translate the following text to natural English. Only output the English text."},
                            {"role": "user", "content": spoken_text}
                        ]
                    )
                    english_text = response.choices[0].message.content
                    print(f"🇬🇧 Translated: {english_text}")
                    
                    # C. GENERATE AUDIO (Edge-TTS)
                    tts_path = "static/interview_reply_en.mp3"
                    communicate = edge_tts.Communicate(english_text, "en-US-AriaNeural")
                    await communicate.save(tts_path)
                    
                    # D. SEND BACK THROUGH WEBSOCKET
                    response_payload = json.dumps({
                        "type": "ai_response",
                        "text": english_text,
                        "audio_url": "http://localhost:8000/interview_audio"
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
