"""
Akademia AI Avatar — Backend v5
Stack: FastAPI · Groq (LLM) · Edge-TTS · HuggingFace DistilBERT

The backend is the BRAIN. It receives text + persona, asks the LLM for a
single structured "behavior" describing what the avatar should say and do,
translates it, synthesizes voice with a viseme (lip-sync) timeline, and
returns ONE unified JSON the frontend maps directly onto the avatar.

Endpoints:
  GET  /health
  POST /ask          -> full behavior pipeline (reply + emotion + gesture + voice + visemes)
  POST /translate    -> EN<->JA translation only
  POST /voice        -> TTS only (text -> audio + visemes)
  POST /upload-face  -> store a reference face photo
  POST /reset        -> clear conversation memory
  GET  /voices       -> available voices
"""

import os
import re
import json
import base64
import asyncio

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import edge_tts
import random
import string
import uuid

from openai import OpenAI

# ── LLM config (Groq by default, OpenAI as optional fallback) ───────────────
# Groq exposes an OpenAI-compatible API, so we reuse the official `openai`
# client and simply point it at Groq's base URL with your GROQ_API_KEY.
#
# NEVER hardcode the key. Put it in the .env file:
#   GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
#   GROQ_MODEL=llama-3.3-70b-versatile          # optional
#
# If you ever want to switch back to OpenAI, set LLM_PROVIDER=openai and provide
# OPENAI_API_KEY instead.
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "groq").strip().lower()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

if LLM_PROVIDER == "openai":
    LLM_API_KEY = OPENAI_API_KEY
    LLM_MODEL = OPENAI_MODEL
    LLM_BASE_URL = None  # default OpenAI endpoint
else:  # "groq" (default)
    LLM_PROVIDER = "groq"
    LLM_API_KEY = GROQ_API_KEY
    LLM_MODEL = GROQ_MODEL
    LLM_BASE_URL = GROQ_BASE_URL

llm_client = (
    OpenAI(api_key=LLM_API_KEY, base_url=LLM_BASE_URL)
    if LLM_API_KEY
    else None
)


def ai_available() -> bool:
    return llm_client is not None


# ── Voice catalog ──────────────────────────────────────────────────────────
EN_VOICE = "en-US-JennyNeural"
JA_VOICE = "ja-JP-NanamiNeural"

# A small, curated set of real Microsoft Edge-TTS neural voices. If any name
# below turns out not to exist on your system's edge-tts version, run
# `edge-tts --list-voices` in your terminal to see the exact names available
# and swap them in here — this list is just data, not logic.
VOICE_CATALOG = {
    "en": [
        {"name": "en-US-JennyNeural", "label": "Jenny (US, female)"},
        {"name": "en-US-AriaNeural",  "label": "Aria (US, female)"},
        {"name": "en-US-GuyNeural",   "label": "Guy (US, male)"},
        {"name": "en-US-DavisNeural", "label": "Davis (US, male)"},
        {"name": "en-GB-SoniaNeural", "label": "Sonia (UK, female)"},
        {"name": "en-GB-RyanNeural",  "label": "Ryan (UK, male)"},
    ],
    "ja": [
        {"name": "ja-JP-NanamiNeural", "label": "Nanami — Japanese, female"},
        {"name": "ja-JP-KeitaNeural",  "label": "Keita — Japanese, male"},
    ],
}

VOICE_MAP = {
    "en":          EN_VOICE,
    "en-US":       EN_VOICE,
    "en-UG":       EN_VOICE,          # Edge-TTS has no en-UG; fall back to en-US
    "en-US-Jenny": "en-US-JennyNeural",
    "ja":          JA_VOICE,
    "ja-JP":       JA_VOICE,
    "ja-JP-Nanami": "ja-JP-NanamiNeural",
}


def resolve_voice(name: str, culture: str) -> str:
    if name and name in VOICE_MAP:
        return VOICE_MAP[name]
    if name and name.endswith("Neural"):
        return name
    return JA_VOICE if culture == "ja" else EN_VOICE


# ── Cultural knowledge (Uganda ↔ Japan) ────────────────────────────────────
CULTURE_DIR = os.path.join(os.path.dirname(__file__), "culture")

_culture_cache: dict = {}


def _load_json(name: str) -> dict:
    path = os.path.join(CULTURE_DIR, name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Culture file missing ({name}): {e}")
        return {}


def get_characters() -> dict:
    if "characters" not in _culture_cache:
        _culture_cache["characters"] = _load_json("characters.json")
    return _culture_cache["characters"]


def get_knowledge(country: str) -> dict:
    key = f"knowledge_{country}"
    if key not in _culture_cache:
        fname = f"knowledge_{country}.json"
        _culture_cache[key] = _load_json(fname)
    return _culture_cache[key]


def relevant_culture_facts(user_text: str, culture_mode: str, scenario_key: str) -> str:
    """Keyword-match verified facts from the knowledge base."""
    text = (user_text or "").lower()
    countries = []
    if culture_mode == "japan":
        countries = ["japan"]
    elif culture_mode == "compare":
        countries = ["uganda", "japan"]
    else:
        countries = ["uganda"]

    scenario_hints = {
        "FirstMeeting": ["greetings", "business_etiquette"],
        "Negotiation": ["negotiation", "business_etiquette"],
        "SocialMeal": ["food_social"],
        "MarketVisit": ["market"],
        "PreTrip": ["pretrip", "greetings"],
        "JapanPrep": ["greetings", "business_etiquette", "for_ugandan_partners"],
        "Tutor": ["greetings"],
        "Business": ["business_etiquette"],
        "Casual": ["food_social"],
    }
    priority_topics = scenario_hints.get(scenario_key, [])

    lines = []
    for country in countries:
        kb = get_knowledge(country)
        topics = kb.get("topics", {})
        scored = []
        for topic_id, topic in topics.items():
            score = 0
            if topic_id in priority_topics:
                score += 3
            for kw in topic.get("keywords", []):
                if kw.lower() in text:
                    score += 2
            if score > 0:
                scored.append((score, topic_id, topic))
        scored.sort(key=lambda x: -x[0])
        for _, _, topic in scored[:3]:
            for fact in topic.get("facts", [])[:4]:
                if fact not in lines:
                    lines.append(fact)
        if not scored and priority_topics:
            for tid in priority_topics[:2]:
                topic = topics.get(tid)
                if topic:
                    for fact in topic.get("facts", [])[:2]:
                        if fact not in lines:
                            lines.append(fact)

    disclaimer = get_knowledge("uganda").get("meta", {}).get("disclaimer", "")
    if not lines:
        return f"Use accurate, respectful cultural guidance. {disclaimer}"
    return "Verified cultural context (use when relevant):\n- " + "\n- ".join(lines[:10]) + f"\n\n{disclaimer}"


CHARACTER_DEFAULT = "Amara"

# Legacy scenario keys map to new cultural scenarios
SCENARIO_ALIASES = {
    "Tutor": "FirstMeeting",
    "Business": "Negotiation",
    "Casual": "SocialMeal",
}

# ── Scenarios (cultural simulations) ───────────────────────────────────────
PERSONAS = {
    "FirstMeeting": {
        "name": "Amara",
        "culture": "en",
        "background": "office",
        "voice": "en-US",
        "scenario_context": (
            "Scenario: First business meeting in Kampala. Teach greetings, "
            "elders-first protocol, warm handshakes, small talk before business, "
            "and common first-meeting mistakes Japanese investors make."
        ),
    },
    "Negotiation": {
        "name": "Kwame",
        "culture": "en",
        "background": "office",
        "voice": "en-US",
        "scenario_context": (
            "Scenario: Negotiation with Ugandan partners. Teach relationship-first "
            "deal-making, why silence may not mean yes, communal decision-making, "
            "and how to build trust before discussing numbers."
        ),
    },
    "SocialMeal": {
        "name": "Amara",
        "culture": "en",
        "background": "lounge",
        "voice": "en-US",
        "scenario_context": (
            "Scenario: Social meal or hospitality in Uganda. Teach food customs, "
            "matooke and local dishes, accepting tea or soda, washing hands, and "
            "why sharing food builds business relationships."
        ),
    },
    "MarketVisit": {
        "name": "Kwame",
        "culture": "en",
        "background": "market",
        "voice": "en-US",
        "scenario_context": (
            "Scenario: Visiting a Kampala market (e.g. Owino). Teach respectful "
            "bargaining, building rapport with sellers, and cultural norms in "
            "busy market environments."
        ),
    },
    "PreTrip": {
        "name": "Kenji",
        "culture": "en",
        "background": "classroom",
        "voice": "en-US",
        "scenario_context": (
            "Scenario: Pre-trip briefing for Japanese investors flying to Uganda. "
            "Cover visa checks, health prep, what to pack, currency, mobile money, "
            "phrases to learn, and day-one cultural mistakes to avoid."
        ),
    },
    "JapanPrep": {
        "name": "Yuki",
        "culture": "ja",
        "background": "tokyo",
        "voice": "ja-JP",
        "scenario_context": (
            "Scenario: Ugandan business person preparing to meet Japanese investors. "
            "Teach meishi ceremony, punctuality, structured meetings, indirect "
            "communication, and why decisions may take time."
        ),
    },
}

CULTURE_MODE_HINTS = {
    "uganda": "Focus on helping the user understand UGANDAN culture, customs, and business etiquette for Japanese investors.",
    "japan": "Focus on helping the user understand JAPANESE culture and what Japanese investors expect.",
    "compare": "Compare Uganda and Japan side by side when useful — highlight differences in greetings, business style, time, and negotiation.",
}


def resolve_scenario(key: str) -> str:
    return SCENARIO_ALIASES.get(key, key)


def build_character_system(character_name: str, scenario: dict, culture_mode: str, user_text: str, scenario_key: str) -> str:
    chars = get_characters()
    char = chars.get(character_name) or chars.get(CHARACTER_DEFAULT) or {}
    char_prompt = char.get("prompt", f"You are {character_name}, a cultural guide for Uganda and Japan.")

    mode_hint = CULTURE_MODE_HINTS.get(culture_mode, CULTURE_MODE_HINTS["uganda"])
    facts = relevant_culture_facts(user_text, culture_mode, scenario_key)
    scenario_ctx = scenario.get("scenario_context", "")

    return (
        f"{char_prompt}\n\n"
        f"Learning focus: {mode_hint}\n\n"
        f"{scenario_ctx}\n\n"
        f"{facts}\n\n"
        "You teach through conversation — practical, warm, and specific to Uganda–Japan business relations. "
        "When teaching Luganda, include the phrase, meaning, and when to use it."
    )


VALID_EXPRESSIONS = ["neutral", "happy", "sad", "surprised", "thinking", "relaxed"]
VALID_GESTURES = ["idle", "wave", "nod", "shake", "explain", "think", "shrug"]
VALID_ANIMATIONS = ["idle", "talk", "explain", "wave", "think", "nod"]


# ── Sentiment (fallback emotion when AI not available) ─────────────────────
_sentiment_pipeline = None


def get_sentiment_pipeline():
    global _sentiment_pipeline
    if _sentiment_pipeline is None:
        try:
            from transformers import pipeline
            _sentiment_pipeline = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
            )
            print("Sentiment model loaded.")
        except Exception as e:
            print(f"Sentiment model unavailable: {e}")
            _sentiment_pipeline = "unavailable"
    return _sentiment_pipeline


def sentiment_behavior(text: str) -> dict:
    """Heuristic expression+gesture from text, used when AI doesn't supply one."""
    pipe = get_sentiment_pipeline()
    expression, gesture = "neutral", "explain"
    if pipe not in (None, "unavailable"):
        try:
            r = pipe(text[:512])[0]
            if r["label"] == "POSITIVE":
                expression, gesture = "happy", "nod"
            elif r["label"] == "NEGATIVE":
                expression, gesture = "sad", "shake"
        except Exception as e:
            print(f"Sentiment error: {e}")

    low = text.lower()
    if "?" in text or any(w in low for w in ("why", "how", "what", "explain")):
        expression, gesture = "thinking", "explain"
    if any(w in low for w in ("wow", "amazing", "incredible", "great", "fantastic")):
        expression, gesture = "surprised", "nod"
    if any(w in low for w in ("hello", "hi ", "welcome", "konnichiwa", "こんにちは")):
        gesture = "wave"
    return {"expression": expression, "gesture": gesture}


# ── Language helpers ───────────────────────────────────────────────────────
def is_japanese(text: str) -> bool:
    return bool(re.search(r"[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]", text))


def _strip_fences(raw: str) -> str:
    clean = raw.strip()
    for fence in ("```json", "```"):
        clean = clean.replace(fence, "")
    return clean.strip()


async def openai_chat(messages: list, json_mode: bool = False) -> str:
    """Async wrapper around the (sync) OpenAI-compatible client (Groq/OpenAI)."""
    if not ai_available():
        raise RuntimeError(
            f"No API key set for provider '{LLM_PROVIDER}'. "
            "Set GROQ_API_KEY (or OPENAI_API_KEY) in your .env."
        )
    loop = asyncio.get_event_loop()
    kwargs = {"model": LLM_MODEL, "messages": messages}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = await loop.run_in_executor(
        None, lambda: llm_client.chat.completions.create(**kwargs)
    )
    return response.choices[0].message.content


# ── Translation ────────────────────────────────────────────────────────────
async def translate_to_japanese(text: str) -> dict:
    """Returns { 'japanese': '...', 'romanization': '...' }"""
    if not ai_available():
        return {"japanese": text, "romanization": ""}
    system = (
        "You are an expert English-to-Japanese translator. Preserve meaning and "
        "nuance, use natural polite Japanese (です・ます). Output ONLY JSON with keys "
        '"japanese" and "romanization" (Hepburn romaji).'
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f'English: "{text}"'},
    ]
    try:
        raw = await openai_chat(messages, json_mode=True)
        data = json.loads(_strip_fences(raw))
        return {
            "japanese": data.get("japanese", text),
            "romanization": data.get("romanization", ""),
        }
    except Exception as e:
        print(f"EN->JA error: {e}")
        return {"japanese": text, "romanization": ""}


async def translate_to_english(text: str) -> str:
    if not ai_available():
        return text
    system = (
        "You are an expert Japanese-to-English translator. Output ONLY the English "
        "translation — no quotes, no markdown, no explanation."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f'Japanese: "{text}"'},
    ]
    try:
        return (await openai_chat(messages)).strip().strip('"')
    except Exception as e:
        print(f"JA->EN error: {e}")
        return text


# ── Lip-sync / viseme timeline ─────────────────────────────────────────────
VOWEL_VISEMES = {"a": "aa", "e": "ee", "i": "ih", "o": "oh", "u": "ou"}
# First-letter consonant hints for slightly richer mouth shapes
CONSONANT_VISEMES = {
    "m": "ou", "p": "ou", "b": "ou", "w": "ou",
    "f": "ih", "v": "ih",
    "s": "ih", "z": "ih", "c": "ih",
    "h": "aa", "k": "aa", "g": "aa",
    "r": "oh", "l": "oh",
    "t": "ee", "d": "ee", "n": "ee",
}


def word_to_viseme(word: str) -> str:
    if not word:
        return "sil"
    w = word.lower().strip(".,!?;:\"'")
    for ch in w:
        if ch in VOWEL_VISEMES:
            return VOWEL_VISEMES[ch]
    if w:
        first = w[0]
        if first in CONSONANT_VISEMES:
            return CONSONANT_VISEMES[first]
    return "aa"


async def generate_tts_with_visemes(text: str, voice: str, output_path: str) -> list:
    """Synthesize speech and build a viseme timeline aligned to word boundaries."""
    timeline = []
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            t_ms = chunk["offset"] // 10_000
            timeline.append({"t": t_ms, "v": word_to_viseme(chunk.get("text", ""))})
    with open(output_path, "wb") as f:
        for c in chunks:
            f.write(c)
    if timeline:
        timeline.append({"t": timeline[-1]["t"] + 300, "v": "sil"})
    return timeline


# ── The brain: ask ChatGPT for a structured behavior ───────────────────────
async def think(user_text: str, persona: dict, history: list) -> dict:
    """
    Returns {reply, expression, gesture, animation}. The reply is always English.
    """
    if not ai_available():
        beh = sentiment_behavior(user_text)
        return {
            "reply": f'(offline echo) "{user_text}". Set GROQ_API_KEY to enable the AI.',
            **beh,
            "animation": beh.get("gesture", "explain"),
        }

    system = (
        f"{persona['system']}\n\n"
        "You also direct a 3D avatar's body and face. Reply to the user, then choose:\n"
        f"- expression from {VALID_EXPRESSIONS}\n"
        f"- gesture from {VALID_GESTURES}\n"
        f"- animation from {VALID_ANIMATIONS} (full-body clip; prefer 'explain' when teaching, "
        "'wave' when greeting, 'think' when pondering, 'talk' when speaking at length)\n"
        'Output ONLY JSON: {"reply": "<english>", "expression": "<expr>", '
        '"gesture": "<gesture>", "animation": "<animation>"}'
    )

    messages = [{"role": "system", "content": system}]
    messages.extend(history[-8:])
    messages.append({"role": "user", "content": user_text})

    try:
        raw = await openai_chat(messages, json_mode=True)
        data = json.loads(_strip_fences(raw))
        reply = data.get("reply", "").strip() or "..."
        expression = data.get("expression", "neutral")
        gesture = data.get("gesture", "explain")
        animation = data.get("animation", gesture)
        if expression not in VALID_EXPRESSIONS:
            expression = "neutral"
        if gesture not in VALID_GESTURES:
            gesture = "explain"
        if animation not in VALID_ANIMATIONS:
            animation = gesture if gesture in VALID_ANIMATIONS else "explain"
        return {
            "reply": reply,
            "expression": expression,
            "gesture": gesture,
            "animation": animation,
        }
    except Exception as e:
        print(f"think() error: {e}")
        return {
            "reply": "Sorry, I had trouble thinking just now.",
            **sentiment_behavior(user_text),
            "animation": "explain",
        }


# ── Live meeting rooms (WebRTC signaling) ─────────────────────────────────
class MeetingPeer:
    def __init__(self, peer_id: str, websocket: WebSocket, name: str, speak_lang: str, hear_lang: str):
        self.peer_id = peer_id
        self.websocket = websocket
        self.name = name
        self.speak_lang = speak_lang
        self.hear_lang = hear_lang

    def meta(self) -> dict:
        return {
            "peer_id": self.peer_id,
            "name": self.name,
            "speak_lang": self.speak_lang,
            "hear_lang": self.hear_lang,
        }


class MeetingRoom:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.peers: dict[str, MeetingPeer] = {}

    def peer_list(self, exclude: str | None = None) -> list:
        return [p.meta() for pid, p in self.peers.items() if pid != exclude]

    async def broadcast(self, message: dict, exclude: str | None = None):
        dead = []
        for pid, peer in self.peers.items():
            if exclude and pid == exclude:
                continue
            try:
                await peer.websocket.send_json(message)
            except Exception:
                dead.append(pid)
        for pid in dead:
            self.peers.pop(pid, None)

    async def send_to(self, peer_id: str, message: dict):
        peer = self.peers.get(peer_id)
        if not peer:
            return
        try:
            await peer.websocket.send_json(message)
        except Exception:
            self.peers.pop(peer_id, None)


_meeting_rooms: dict[str, MeetingRoom] = {}


def _new_room_code() -> str:
    chars = string.ascii_uppercase + string.digits
    for _ in range(32):
        code = "".join(random.choices(chars, k=6))
        if code not in _meeting_rooms:
            return code
    return str(uuid.uuid4())[:6].upper()


# ── App setup ──────────────────────────────────────────────────────────────
app = FastAPI(title="Akademia AI Avatar v5")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

conversation_history: list = []

_audio_counter = 0


def next_audio_name(prefix: str) -> str:
    """Unique filenames so the browser never plays a stale cached file."""
    global _audio_counter
    _audio_counter += 1
    return f"{prefix}_{_audio_counter}.mp3"


# ── Request models ─────────────────────────────────────────────────────────
class AskRequest(BaseModel):
    text: str
    persona: str = "FirstMeeting"
    character_name: str = None
    voice_en: str = None
    voice_ja: str = None
    culture_mode: str = "uganda"  # uganda | japan | compare


class TranslateRequest(BaseModel):
    text: str
    target: str = "ja"  # "ja" or "en"


class VoiceRequest(BaseModel):
    text: str
    voice: str = "en-US"
    culture: str = "en"


async def extract_upload_text(upload: UploadFile) -> str:
    """Extract plain text from txt, md, csv, pdf, or docx uploads."""
    raw = await upload.read()
    fn = (upload.filename or "").lower()

    if fn.endswith((".txt", ".md", ".csv")):
        return raw.decode("utf-8", errors="ignore")

    if fn.endswith(".pdf"):
        try:
            from io import BytesIO
            from pypdf import PdfReader
            reader = PdfReader(BytesIO(raw))
            parts = []
            for page in reader.pages[:40]:
                parts.append(page.extract_text() or "")
            return "\n".join(parts)
        except Exception as e:
            raise ValueError(f"Could not read PDF: {e}") from e

    if fn.endswith(".docx"):
        try:
            from io import BytesIO
            from docx import Document
            doc = Document(BytesIO(raw))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except Exception as e:
            raise ValueError(f"Could not read DOCX: {e}") from e

    raise ValueError(
        f"Unsupported file type for '{upload.filename}'. "
        "Use .txt, .md, .csv, .pdf, or .docx"
    )


# ── Endpoints ──────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "provider": LLM_PROVIDER,
        "model": LLM_MODEL,
        "ai_enabled": ai_available(),
    }


@app.post("/ask")
async def ask_avatar(request: AskRequest):
    user_text = request.text.strip()
    if not user_text:
        return JSONResponse({"error": "Empty input"}, status_code=400)

    scenario_key = resolve_scenario(request.persona)
    persona = PERSONAS.get(scenario_key, PERSONAS["FirstMeeting"])
    character_name = (request.character_name or persona["name"]).strip() or persona["name"]
    culture_mode = (request.culture_mode or "uganda").strip().lower()
    if culture_mode not in CULTURE_MODE_HINTS:
        culture_mode = "uganda"

    resolved_persona = {
        **persona,
        "system": build_character_system(
            character_name, persona, culture_mode, user_text, scenario_key
        ),
    }

    # Normalize input to English for the brain.
    user_for_ai = user_text
    if is_japanese(user_text):
        user_for_ai = await translate_to_english(user_text)

    behavior = await think(user_for_ai, resolved_persona, conversation_history)
    reply_en = behavior["reply"]

    conversation_history.append({"role": "user", "content": user_for_ai})
    conversation_history.append({"role": "assistant", "content": reply_en})

    translation = await translate_to_japanese(reply_en)
    reply_ja = translation["japanese"]
    romanization = translation["romanization"]

    # Voice + visemes for both tracks. A per-request voice (chosen by the
    # user for this character) overrides the global default; resolve_voice()
    # already falls back to the default when None is passed.
    en_voice_name = resolve_voice(request.voice_en, "en")
    ja_voice_name = resolve_voice(request.voice_ja, "ja")

    en_name = next_audio_name("en")
    ja_name = next_audio_name("ja")
    visemes_en, visemes_ja = [], []
    try:
        visemes_en = await generate_tts_with_visemes(
            reply_en, en_voice_name, os.path.join("static", en_name))
    except Exception as e:
        print(f"EN TTS error: {e}")
    try:
        visemes_ja = await generate_tts_with_visemes(
            reply_ja, ja_voice_name, os.path.join("static", ja_name))
    except Exception as e:
        print(f"JA TTS error: {e}")

    # Primary track follows the persona's culture.
    primary = "ja" if persona["culture"] == "ja" else "en"

    return {
        "reply": reply_en,
        "translated_reply": reply_ja,
        "romanization": romanization,

        "expression": behavior["expression"],
        "gesture": behavior["gesture"],
        "animation": behavior.get("animation", behavior["gesture"]),
        "emotion": behavior["expression"],

        "voice": ja_voice_name if primary == "ja" else en_voice_name,
        "background": persona["background"],
        "primary": primary,
        "culture_mode": culture_mode,
        "scenario": scenario_key,

        "audio_url_en": f"/static/{en_name}",
        "audio_url_ja": f"/static/{ja_name}",
        "audio_url": f"/static/{ja_name if primary == 'ja' else en_name}",

        "visemes_en": visemes_en,
        "visemes_ja": visemes_ja,
        "visemes": visemes_ja if primary == "ja" else visemes_en,

        "behavior": {
            "expression": behavior["expression"],
            "gesture": behavior["gesture"],
            "animation": behavior.get("animation", behavior["gesture"]),
            "background": persona["background"],
        },
    }


@app.post("/analyze-file")
async def analyze_file(
    file: UploadFile = File(...),
    persona: str = Form("FirstMeeting"),
    character_name: str = Form(None),
    voice_en: str = Form(None),
    voice_ja: str = Form(None),
    culture_mode: str = Form("uganda"),
):
    """Upload a document; avatar analyzes and responds with voice + motion."""
    try:
        doc_text = (await extract_upload_text(file)).strip()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    if not doc_text:
        return JSONResponse({"error": "No readable text found in file."}, status_code=400)

    prompt = (
        f'I uploaded a file named "{file.filename}". Summarize the important points '
        f"and explain anything relevant for Uganda–Japan business or cultural learning. "
        f"If the document is not about culture, still give a clear helpful summary.\n\n"
        f"--- DOCUMENT START ---\n{doc_text[:12000]}\n--- DOCUMENT END ---"
    )

    return await ask_avatar(AskRequest(
        text=prompt,
        persona=persona,
        character_name=character_name,
        voice_en=voice_en,
        voice_ja=voice_ja,
        culture_mode=culture_mode,
    ))


@app.post("/translate")
async def translate(request: TranslateRequest):
    text = request.text.strip()
    if not text:
        return JSONResponse({"error": "Empty input"}, status_code=400)
    if request.target == "en":
        return {"text": await translate_to_english(text), "romanization": ""}
    result = await translate_to_japanese(text)
    return {"text": result["japanese"], "romanization": result["romanization"]}


@app.post("/voice")
async def voice(request: VoiceRequest):
    text = request.text.strip()
    if not text:
        return JSONResponse({"error": "Empty input"}, status_code=400)
    voice_name = resolve_voice(request.voice, request.culture)
    name = next_audio_name("voice")
    visemes = []
    try:
        visemes = await generate_tts_with_visemes(
            text, voice_name, os.path.join("static", name))
    except Exception as e:
        return JSONResponse({"error": f"TTS failed: {e}"}, status_code=500)
    return {"audio_url": f"/static/{name}", "visemes": visemes, "voice": voice_name}


@app.post("/upload-face")
async def upload_face(photo: UploadFile = File(...)):
    try:
        contents = await photo.read()
        if not photo.content_type or not photo.content_type.startswith("image/"):
            return JSONResponse({"error": "File must be an image"}, status_code=400)
        ext = photo.filename.rsplit(".", 1)[-1] if "." in photo.filename else "jpg"
        out_path = f"static/face_upload.{ext}"
        with open(out_path, "wb") as f:
            f.write(contents)
        b64 = base64.b64encode(contents).decode("utf-8")
        return {"face_data_url": f"data:{photo.content_type};base64,{b64}", "path": out_path}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/culture/summary")
def culture_summary():
    """Lightweight culture metadata for the frontend."""
    return {
        "modes": list(CULTURE_MODE_HINTS.keys()),
        "scenarios": list(PERSONAS.keys()),
        "characters": list(get_characters().keys()),
    }


@app.post("/reset")
async def reset_conversation():
    conversation_history.clear()
    return {"status": "cleared"}


@app.get("/voices")
async def list_voices():
    return {"catalog": VOICE_CATALOG, "default_en": EN_VOICE, "default_ja": JA_VOICE}


@app.get("/meeting/create")
def create_meeting_room():
    """Create a short room code for live meetings."""
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
    room_id = room_id.upper()
    room = _meeting_rooms.get(room_id)
    if not room:
        room = MeetingRoom(room_id)
        _meeting_rooms[room_id] = room

    await websocket.accept()
    peer_id = str(uuid.uuid4())
    peer: MeetingPeer | None = None

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "join":
                name = (data.get("name") or "Guest").strip()[:40] or "Guest"
                speak_lang = (data.get("speak_lang") or "en").strip().lower()
                hear_lang = (data.get("hear_lang") or "ja").strip().lower()
                peer = MeetingPeer(peer_id, websocket, name, speak_lang, hear_lang)
                room.peers[peer_id] = peer

                await websocket.send_json({
                    "type": "joined",
                    "peer_id": peer_id,
                    "room_id": room_id,
                    "peers": room.peer_list(exclude=peer_id),
                })
                await room.broadcast({
                    "type": "peer-joined",
                    "peer": peer.meta(),
                }, exclude=peer_id)
                continue

            if not peer:
                await websocket.send_json({"type": "error", "message": "Send join first"})
                continue

            if msg_type in ("offer", "answer", "ice"):
                target = data.get("to")
                if not target:
                    continue
                payload = {
                    "type": msg_type,
                    "from": peer_id,
                    "to": target,
                }
                if msg_type == "ice":
                    payload["candidate"] = data.get("candidate")
                else:
                    payload["sdp"] = data.get("sdp")
                await room.send_to(target, payload)
                continue

            if msg_type == "transcript":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                await room.broadcast({
                    "type": "transcript",
                    "from": peer_id,
                    "name": peer.name,
                    "text": text,
                    "lang": data.get("lang") or peer.speak_lang,
                    "final": bool(data.get("final", True)),
                }, exclude=peer_id)
                continue

            if msg_type == "chat":
                text = (data.get("text") or "").strip()
                if not text:
                    continue
                await room.broadcast({
                    "type": "chat",
                    "from": peer_id,
                    "name": peer.name,
                    "text": text,
                    "lang": data.get("lang") or peer.speak_lang,
                })
                continue

            if msg_type == "leave":
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Meeting WS error ({room_id}): {e}")
    finally:
        if peer and peer_id in room.peers:
            room.peers.pop(peer_id, None)
            await room.broadcast({"type": "peer-left", "peer_id": peer_id})
        if not room.peers:
            _meeting_rooms.pop(room_id, None)