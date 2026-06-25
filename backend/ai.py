import os
import json
import asyncio
import edge_tts
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# ==========================================
# 1. LLM CONFIG & CLIENT
# ==========================================
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

llm_client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
) if GROQ_API_KEY else None

def ai_available() -> bool:
    return llm_client is not None

async def call_llm(messages: list, json_mode: bool = False) -> str:
    """Call the LLM (Groq) and return the response."""
    if not ai_available():
        raise RuntimeError("No Groq API Key set in .env file")
    
    loop = asyncio.get_event_loop()
    kwargs = {"model": GROQ_MODEL, "messages": messages}
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    
    response = await loop.run_in_executor(
        None, 
        lambda: llm_client.chat.completions.create(**kwargs)
    )
    return response.choices[0].message.content.strip().replace("```json", "").replace("```", "").strip()

# ==========================================
# 2. AI BRAIN (THINK)
# ==========================================
async def think(user_text: str, system_prompt: str, history: list) -> dict:
    """Ask the LLM to generate a response with emotion and gesture."""
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(history[-8:])  # Last 8 turns for context
    messages.append({"role": "user", "content": user_text})
    
    try:
        raw = await call_llm(messages, json_mode=True)
        return json.loads(raw)
    except Exception as e:
        print(f"AI Think Error: {e}")
        return {
            "reply": "Sorry, my AI brain is offline. Please check the API key.",
            "expression": "sad",
            "gesture": "shake",
            "animation": "shake"
        }

# ==========================================
# 3. VOICE & TTS (LIP SYNC)
# ==========================================
EN_VOICE = "en-US-JennyNeural"
JA_VOICE = "ja-JP-NanamiNeural"

VOICE_CATALOG = {
    "en": [
        {"name": "en-US-JennyNeural", "label": "Jenny (US, female)"},
        {"name": "en-US-AriaNeural", "label": "Aria (US, female)"},
        {"name": "en-US-GuyNeural", "label": "Guy (US, male)"},
        {"name": "en-GB-SoniaNeural", "label": "Sonia (UK, female)"},
    ],
    "ja": [
        {"name": "ja-JP-NanamiNeural", "label": "Nanami (Japanese, female)"},
        {"name": "ja-JP-KeitaNeural", "label": "Keita (Japanese, male)"},
    ],
}

VOICE_MAP = {
    "en": EN_VOICE,
    "en-US": EN_VOICE,
    "en-UG": EN_VOICE,
    "ja": JA_VOICE,
    "ja-JP": JA_VOICE,
}

def resolve_voice(name: str, culture: str) -> str:
    """Resolve a voice name to the actual Edge-TTS voice ID."""
    if name and name in VOICE_MAP:
        return VOICE_MAP[name]
    if name and name.endswith("Neural"):
        return name
    return JA_VOICE if culture == "ja" else EN_VOICE

# Viseme mapping for lip sync
VOWEL_VISEMES = {"a": "aa", "e": "ee", "i": "ih", "o": "oh", "u": "ou"}
CONSONANT_VISEMES = {
    "m": "ou", "p": "ou", "b": "ou", "w": "ou",
    "f": "ih", "v": "ih", "s": "ih", "z": "ih",
    "h": "aa", "k": "aa", "g": "aa",
    "r": "oh", "l": "oh",
    "t": "ee", "d": "ee", "n": "ee",
}

def word_to_viseme(word: str) -> str:
    """Convert a word to a viseme shape for lip sync."""
    if not word:
        return "sil"
    w = word.lower().strip(".,!?;:\"'")
    for ch in w:
        if ch in VOWEL_VISEMES:
            return VOWEL_VISEMES[ch]
    if w and w[0] in CONSONANT_VISEMES:
        return CONSONANT_VISEMES[w[0]]
    return "aa"

async def generate_tts_with_visemes(text: str, voice: str, output_path: str) -> list:
    """Generate TTS audio and return a viseme timeline for lip sync."""
    timeline = []
    communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    chunks = []
    
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            chunks.append(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            t_ms = chunk["offset"] // 10_000  # Convert to milliseconds
            timeline.append({
                "t": t_ms,
                "v": word_to_viseme(chunk.get("text", ""))
            })
    
    # Write audio file
    with open(output_path, "wb") as f:
        for c in chunks:
            f.write(c)
    
    # Add final silence to close mouth
    if timeline:
        timeline.append({"t": timeline[-1]["t"] + 300, "v": "sil"})
    
    return timeline