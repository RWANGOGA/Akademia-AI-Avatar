import os
from fastapi import FastAPI, UploadFile, File, Form, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Import our modular components
from ai import ai_available, GROQ_MODEL, resolve_voice, generate_tts_with_visemes, think
from translation import translate_to_japanese, translate_to_english, is_japanese
from culture import PERSONAS, resolve_scenario, build_character_system, get_characters
from meeting import handle_meeting_websocket, _meeting_rooms, _new_room_code, MeetingRoom
# ==========================================
# APP SETUP
# ==========================================
app = FastAPI(title="Akademia AI Avatar Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

conversation_history = []

# ==========================================
# REQUEST MODELS
# ==========================================
class AskRequest(BaseModel):
    text: str
    persona: str = "FirstMeeting"
    character_name: str = None
    voice_en: str = None
    voice_ja: str = None
    culture_mode: str = "uganda"

# ==========================================
# ENDPOINTS
# ==========================================
@app.get("/health")
def health():
    return {
        "status": "ok",
        "ai_enabled": ai_available(),
        "model": GROQ_MODEL,
        "provider": "groq"
    }

@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text.strip()
    if not user_text:
        return JSONResponse({"error": "Empty input"}, status_code=400)

    # 1. Translate Japanese to English if needed
    user_for_ai = await translate_to_english(user_text) if is_japanese(user_text) else user_text

    # 2. Build culture prompt and Think
    system_prompt = build_character_system(
        request.persona, 
        request.culture_mode, 
        user_for_ai
    )
    behavior = await think(user_for_ai, system_prompt, conversation_history)
    reply_en = behavior.get("reply", "...")

    # Save to history
    conversation_history.append({"role": "user", "content": user_for_ai})
    conversation_history.append({"role": "assistant", "content": reply_en})

    # 3. Translate to Japanese
    translation = await translate_to_japanese(reply_en)
    reply_ja = translation.get("japanese", "")
    romanization = translation.get("romanization", "")

    # 4. Generate Audio (TTS) with Visemes
    scenario = PERSONAS.get(resolve_scenario(request.persona), PERSONAS["FirstMeeting"])
    en_voice = resolve_voice(request.voice_en or scenario.get("voice"), "en")
    ja_voice = resolve_voice(request.voice_ja, "ja")

    en_name = f"en_{len(conversation_history)}.mp3"
    ja_name = f"ja_{len(conversation_history)}.mp3"
    
    visemes_en = await generate_tts_with_visemes(reply_en, en_voice, os.path.join("static", en_name))
    visemes_ja = await generate_tts_with_visemes(reply_ja, ja_voice, os.path.join("static", ja_name))

    # 5. Return unified JSON
    return {
        "reply": reply_en,
        "translated_reply": reply_ja,
        "romanization": romanization,
        "expression": behavior.get("expression", "neutral"),
        "gesture": behavior.get("gesture", "explain"),
        "animation": behavior.get("animation", behavior.get("gesture", "explain")),
        "audio_url_en": f"/static/{en_name}",
        "audio_url_ja": f"/static/{ja_name}",
        "visemes_en": visemes_en,
        "visemes_ja": visemes_ja,
        "background": scenario.get("background", "office"),
        "scenario": resolve_scenario(request.persona),
        "culture_mode": request.culture_mode
    }

@app.post("/analyze-file")
async def analyze_file(
    file: UploadFile = File(...),
    persona: str = Form("FirstMeeting"),
    culture_mode: str = Form("uganda")
):
    """Upload a document; avatar analyzes and responds."""
    raw = await file.read()
    fn = (file.filename or "").lower()
    doc_text = ""
    
    if fn.endswith((".txt", ".md", ".csv")):
        doc_text = raw.decode("utf-8", errors="ignore")
    elif fn.endswith(".pdf"):
        try:
            from pypdf import PdfReader
            from io import BytesIO
            reader = PdfReader(BytesIO(raw))
            doc_text = "\n".join(p.extract_text() or "" for p in reader.pages[:20])
        except Exception as e:
            return JSONResponse({"error": f"Could not read PDF: {e}"}, status_code=400)
    elif fn.endswith(".docx"):
        try:
            from docx import Document
            from io import BytesIO
            doc = Document(BytesIO(raw))
            doc_text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as e:
            return JSONResponse({"error": f"Could not read DOCX: {e}"}, status_code=400)
    
    if not doc_text:
        return JSONResponse({"error": "No readable text found in file."}, status_code=400)
    
    prompt = f'I uploaded a file named "{file.filename}". Summarize the important points and explain anything relevant for cultural learning.\n\n--- DOCUMENT START ---\n{doc_text[:8000]}\n--- DOCUMENT END ---'
    return await ask_avatar(AskRequest(text=prompt, persona=persona, culture_mode=culture_mode))

@app.post("/translate")
async def translate_text(text: str = Form(...), target: str = Form("ja")):
    """Translate text between EN and JA."""
    if target == "en":
        return {"text": await translate_to_english(text), "romanization": ""}
    result = await translate_to_japanese(text)
    return {"text": result["japanese"], "romanization": result["romanization"]}

@app.post("/reset")
def reset_conversation():
    """Clear conversation history."""
    conversation_history.clear()
    return {"status": "cleared"}
@app.get("/voices")
async def list_voices():
    """Return available voices."""
    from ai import VOICE_CATALOG, EN_VOICE, JA_VOICE
    return {
        "catalog": VOICE_CATALOG,
        "default_en": EN_VOICE,
        "default_ja": JA_VOICE
    }

@app.get("/culture/summary")
def culture_summary():
    """Return available scenarios and characters."""
    from backend.culture import CULTURE_MODE_HINTS
    return {
        "modes": list(CULTURE_MODE_HINTS.keys()),
        "scenarios": list(PERSONAS.keys()),
        "characters": list(get_characters().keys())
    }

@app.get("/meeting/create")
def create_meeting_room():
    """Create a new meeting room."""
    code = _new_room_code()
    _meeting_rooms[code] = MeetingRoom(code)
    return {"room_id": code}

@app.get("/meeting/{room_id}/status")
def meeting_room_status(room_id: str):
    """Check if a room exists and how many peers are in it."""
    room = _meeting_rooms.get(room_id.upper())
    if not room:
        return {"exists": False, "participants": 0}
    return {"exists": True, "participants": len(room.peers)}

@app.websocket("/ws/meeting/{room_id}")
async def meeting_websocket(websocket: WebSocket, room_id: str):
    """WebSocket endpoint for live meetings."""
    await handle_meeting_websocket(websocket, room_id)