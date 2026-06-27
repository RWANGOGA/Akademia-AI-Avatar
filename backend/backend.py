import os
from fastapi import FastAPI, UploadFile, File, Form, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text

# ==========================================
# 1. DATABASE IMPORTS & FALLBACK SETUP
# ==========================================
try:
    from db.session import SessionLocal, engine
    from db import crud, models
    DB_AVAILABLE = False
    
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    DB_AVAILABLE = True
    print("✅ DATABASE CONNECTED: Smart AI mode (PostgreSQL) is ENABLED.")
except Exception as e:
    print(f"⚠️ DATABASE UNAVAILABLE: Falling back to temporary memory. (Error: {e})")
    DB_AVAILABLE = False

fallback_conversation_history = []

# ==========================================
# 2. EXISTING MODULE IMPORTS
# ==========================================
from ai import ai_available, GROQ_MODEL, resolve_voice, generate_tts_with_visemes, think
from translation import translate_to_japanese, translate_to_english, is_japanese
from culture import PERSONAS, resolve_scenario, build_character_system, get_characters, CULTURE_MODE_HINTS
from meeting import handle_meeting_websocket, _meeting_rooms, _new_room_code, MeetingRoom, voice_tts_handler

# ==========================================
# 3. APP SETUP
# ==========================================
app = FastAPI(title="Akademia AI Avatar Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
os.makedirs("uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# ==========================================
# 4. HELPER FUNCTIONS
# ==========================================
def get_or_create_guest_user(db):
    guest = db.query(models.User).filter_by(id=1).first()
    if not guest:
        guest = models.User(
            id=1,
            email="guest@akademia.local",
            name="Guest",
            hashed_password="none",
            is_active=True
        )
        db.add(guest)
        db.commit()
        db.refresh(guest)
    return guest

async def safe_tts(text, voice, path):
    """Wrap generate_tts_with_visemes — never raises, returns [] on any failure."""
    clean = (text or "").strip()
    if not clean or clean in ("...", "…", "."):
        return []
    try:
        return await generate_tts_with_visemes(clean, voice, path)
    except Exception as e:
        print(f"⚠️ TTS failed ({voice}): {e}")
        return []

# ==========================================
# 5. REQUEST MODELS
# ==========================================
class AskRequest(BaseModel):
    text: str
    persona: str = "FirstMeeting"
    character_name: str = None
    voice_en: str = None
    voice_ja: str = None
    culture_mode: str = "uganda"

# ==========================================
# 6. ENDPOINTS
# ==========================================
@app.get("/health")
def health():
    return {
        "status": "ok",
        "ai_enabled": ai_available(),
        "model": GROQ_MODEL,
        "provider": "groq",
        "database_mode": "postgresql" if DB_AVAILABLE else "temporary_memory"
    }

@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text.strip()
    if not user_text:
        return JSONResponse({"error": "Empty input"}, status_code=400)

    user_for_ai = await translate_to_english(user_text) if is_japanese(user_text) else user_text

    system_prompt = build_character_system(
        request.persona,
        request.culture_mode,
        user_for_ai
    )

    # ==========================================
    # SCENARIO A: DATABASE IS ON (Smart Mode)
    # ==========================================
    if DB_AVAILABLE:
        db = SessionLocal()
        try:
            guest = get_or_create_guest_user(db)
            chat_session = crud.create_session(db, user_id=guest.id, persona=request.persona, culture_mode=request.culture_mode)
            crud.save_message(db, chat_session.id, "user", user_for_ai)
            history = crud.get_session_history(db, chat_session.id, limit=8)

            behavior = await think(user_for_ai, system_prompt, history)
            reply_en = behavior.get("reply", "...")

            translation = await translate_to_japanese(reply_en)
            reply_ja = translation.get("japanese", "")
            romanization = translation.get("romanization", "")

            scenario = PERSONAS.get(resolve_scenario(request.persona), PERSONAS["FirstMeeting"])
            en_voice = resolve_voice(request.voice_en or scenario.get("voice"), "en")
            ja_voice = resolve_voice(request.voice_ja, "ja")

            en_name = f"db_en_{chat_session.id}.mp3"
            ja_name = f"db_ja_{chat_session.id}.mp3"

            # ── TTS with safe wrapper — never raises 500 ──────────────────
            visemes_en = await safe_tts(reply_en, en_voice, os.path.join("static", en_name))
            visemes_ja = await safe_tts(reply_ja, ja_voice, os.path.join("static", ja_name))

            crud.save_message(
                db, chat_session.id, "assistant", reply_en,
                expression=behavior.get("expression", "neutral"),
                gesture=behavior.get("gesture", "explain"),
                animation=behavior.get("animation", behavior.get("gesture", "explain")),
                audio_url_en=f"/static/{en_name}",
                audio_url_ja=f"/static/{ja_name}"
            )

            return {
                "reply": reply_en, "translated_reply": reply_ja, "romanization": romanization,
                "expression": behavior.get("expression", "neutral"),
                "gesture": behavior.get("gesture", "explain"),
                "animation": behavior.get("animation", behavior.get("gesture", "explain")),
                "audio_url_en": f"/static/{en_name}", "audio_url_ja": f"/static/{ja_name}",
                "visemes_en": visemes_en, "visemes_ja": visemes_ja,
                "background": scenario.get("background", "office"),
                "scenario": resolve_scenario(request.persona),
                "culture_mode": request.culture_mode,
                "mode": "database"
            }
        finally:
            db.close()

    # ==========================================
    # SCENARIO B: DATABASE IS OFF (Fallback Mode)
    # ==========================================
    else:
        history = fallback_conversation_history[-8:]

        behavior = await think(user_for_ai, system_prompt, history)
        reply_en = behavior.get("reply", "...")

        translation = await translate_to_japanese(reply_en)
        reply_ja = translation.get("japanese", "")
        romanization = translation.get("romanization", "")

        scenario = PERSONAS.get(resolve_scenario(request.persona), PERSONAS["FirstMeeting"])
        en_voice = resolve_voice(request.voice_en or scenario.get("voice"), "en")
        ja_voice = resolve_voice(request.voice_ja, "ja")

        en_name = f"temp_en_{len(fallback_conversation_history)}.mp3"
        ja_name = f"temp_ja_{len(fallback_conversation_history)}.mp3"

        # ── TTS with safe wrapper — never raises 500 ──────────────────────
        visemes_en = await safe_tts(reply_en, en_voice, os.path.join("static", en_name))
        visemes_ja = await safe_tts(reply_ja, ja_voice, os.path.join("static", ja_name))

        fallback_conversation_history.append({"role": "user", "content": user_for_ai})
        fallback_conversation_history.append({"role": "assistant", "content": reply_en})

        return {
            "reply": reply_en, "translated_reply": reply_ja, "romanization": romanization,
            "expression": behavior.get("expression", "neutral"),
            "gesture": behavior.get("gesture", "explain"),
            "animation": behavior.get("animation", behavior.get("gesture", "explain")),
            "audio_url_en": f"/static/{en_name}", "audio_url_ja": f"/static/{ja_name}",
            "visemes_en": visemes_en, "visemes_ja": visemes_ja,
            "background": scenario.get("background", "office"),
            "scenario": resolve_scenario(request.persona),
            "culture_mode": request.culture_mode,
            "mode": "temporary"
        }

@app.post("/analyze-file")
async def analyze_file(
    file: UploadFile = File(...),
    persona: str = Form("FirstMeeting"),
    culture_mode: str = Form("uganda")
):
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

    file_location = f"uploads/{file.filename}"
    with open(file_location, "wb") as f:
        f.write(raw)

    if DB_AVAILABLE:
        db = SessionLocal()
        try:
            guest = get_or_create_guest_user(db)
            crud.save_document(
                db=db,
                user_id=guest.id,
                filename=file.filename or "uploaded_file",
                file_path=file_location,
                extracted_text=doc_text[:50000],
                file_type=fn.split('.')[-1] if '.' in fn else "txt"
            )
            print(f"✅ Document saved to database and disk: {file.filename}")
        finally:
            db.close()

    prompt = f'I uploaded a file named "{file.filename}". Summarize the important points and explain anything relevant for cultural learning.\n\n--- DOCUMENT START ---\n{doc_text[:8000]}\n--- DOCUMENT END ---'
    return await ask_avatar(AskRequest(text=prompt, persona=persona, culture_mode=culture_mode))

@app.post("/translate")
async def translate_text(text: str = Form(...), target: str = Form("ja")):
    if target == "en":
        return {"text": await translate_to_english(text), "romanization": ""}
    result = await translate_to_japanese(text)
    return {"text": result["japanese"], "romanization": result["romanization"]}

@app.post("/reset")
def reset_conversation():
    if DB_AVAILABLE:
        return {"status": "cleared", "mode": "database"}
    else:
        fallback_conversation_history.clear()
        return {"status": "cleared", "mode": "temporary"}

@app.get("/voices")
async def list_voices():
    from ai import VOICE_CATALOG, EN_VOICE, JA_VOICE
    return {
        "catalog": VOICE_CATALOG,
        "default_en": EN_VOICE,
        "default_ja": JA_VOICE
    }

@app.get("/culture/summary")
def culture_summary():
    return {
        "modes": list(CULTURE_MODE_HINTS.keys()),
        "scenarios": list(PERSONAS.keys()),
        "characters": list(get_characters().keys())
    }

# ==========================================
# LIVE MEETING ENDPOINTS
# ==========================================
@app.post("/voice")
async def live_voice(
    text: str = Form(...),
    voice: str = Form("en-US"),
    culture: str = Form("en")
):
    """Fast TTS for live meeting avatar interpreter. Returns { audio_url, visemes }."""
    return await voice_tts_handler(text, voice, culture)

@app.get("/meeting/create")
def create_meeting_room():
    code = _new_room_code()
    _meeting_rooms[code] = MeetingRoom(code)
    return {"room_id": code}

@app.get("/meeting/{room_id}/status")
def meeting_room_status(room_id: str):
    room = _meeting_rooms.get(room_id.upper())
    if not room:
        return {"exists": False, "participants": 0}
    return {"exists": True, "participants": len(room.peers)}

@app.websocket("/ws/meeting/{room_id}")
async def meeting_websocket(websocket: WebSocket, room_id: str):
    await handle_meeting_websocket(websocket, room_id)