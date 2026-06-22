import os
from openai import OpenAI
from dotenv import load_dotenv

# 🛠️ Official Google GenAI SDK
from google import genai

# 🎙️ Deepgram SDK
from deepgram import DeepgramClient

load_dotenv()

# ==========================================
# 🔑 API KEY INITIALIZATION
# ==========================================

# 🎙️ Deepgram Client (for live transcription)
deepgram_api_key = os.getenv("DEEPGRAM_API_KEY")
deepgram_client = DeepgramClient(api_key=deepgram_api_key) if deepgram_api_key else None  # ✅ FIXED

# 🎤 Groq Client (for avatar chat transcription - Whisper V3)
groq_api_key = os.getenv("GROQ_API_KEY")
groq_stt_client = OpenAI(
    api_key=groq_api_key,
    base_url="https://api.groq.com/openai/v1"
) if groq_api_key else None

# 🧠 Google Native GenAI Client (for optional future use)
google_api_key = os.getenv("GOOGLE_API_KEY")
google_native_client = genai.Client(api_key=google_api_key) if google_api_key else None

# 🎵 Library used for automatic audio recovery/normalization
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    print("⚠️ pydub is not installed. Run 'pip install pydub' to enable automatic WAV audio normalization.")

# ==========================================
# 🛡️ PRE-FLIGHT CHECKS
# ==========================================
if not deepgram_api_key:
    print("⚠️ DEEPGRAM_API_KEY is missing. Deepgram services will fail.")
if not os.getenv("NVIDIA_API_KEY"):
    print("⚠️ NVIDIA_API_KEY is missing. LLM responses may fail.")
if not groq_api_key:
    print("⚠️ GROQ_API_KEY is missing. Groq transcription will fail.")
if not google_api_key:
    print("⚠️ GOOGLE_API_KEY is missing. Google Gemini services will fail.")


# ==========================================
# 🧠 LLM CLIENT ROUTER
# ==========================================
def get_llm_client(model_id: str):
    """
    Automatically routes to the correct API based on the model prefix.
    Shared by backend.py (avatar chat) and live_translation.py (live interpreter).
    """
    if model_id.startswith("google/"):
        client = OpenAI(
            api_key=google_api_key,
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