import os
from openai import OpenAI
from dotenv import load_dotenv

# 🛠️ Official Google GenAI SDK
from google import genai

# 🎵 Library used for automatic audio recovery/normalization
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    print("⚠️ pydub is not installed. Run 'pip install pydub' to enable automatic WAV audio normalization.")

load_dotenv()

# Pre-flight Check for Env Keys
if not os.getenv("GEMINI_API_KEY"):
    print("⚠️ GEMINI_API_KEY is missing. Gemini models will fail.")
if not os.getenv("NVIDIA_API_KEY"):
    print("⚠️ NVIDIA_API_KEY is missing. LLM responses may fail.")
if not os.getenv("GROQ_API_KEY"):
    print("⚠️ GROQ_API_KEY is missing. Groq transcription will fail.")

# 🎤 Native Gemini Client (kept for optional STT / future use)
google_native_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# 🎤 Groq Client using OpenAI compatibility layer for Whisper V3
groq_stt_client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)


def get_llm_client(model_id: str):
    """
    Automatically routes to the correct API based on the model prefix.
    Shared by backend.py (avatar chat) and live_translation.py (live interpreter).
    """
    if model_id.startswith("google/"):
        client = OpenAI(
            api_key=os.getenv("GEMINI_API_KEY"),
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
        )
        clean_model = model_id.replace("google/", "")

    elif model_id.startswith("nvidia/"):
        client = OpenAI(
            api_key=os.getenv("NVIDIA_API_KEY"),
            base_url="https://integrate.api.nvidia.com/v1"
        )
        clean_model = model_id.replace("nvidia/", "")

    else:
        client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY", "sk-dummy-key-for-fallback")
        )
        clean_model = model_id.replace("openai/", "")

    return client, clean_model