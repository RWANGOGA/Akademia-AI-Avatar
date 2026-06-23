import os
import io
from openai import OpenAI
from dotenv import load_dotenv
from deepgram import DeepgramClient

load_dotenv()

# ==========================================
# 🔑 API KEY INITIALIZATION (3 APIs)
# ==========================================

# 🎙️ Deepgram (Primary STT for ALL audio)
deepgram_api_key = os.getenv("DEEPGRAM_API_KEY")
deepgram_client = DeepgramClient(api_key=deepgram_api_key) if deepgram_api_key else None

# 🚀 Groq (Primary LLM + STT fallback)
groq_api_key = os.getenv("GROQ_API_KEY")
groq_client = OpenAI(
    api_key=groq_api_key,
    base_url="https://api.groq.com/openai/v1"
) if groq_api_key else None

# 🧠 NVIDIA (Fallback LLM)
nvidia_api_key = os.getenv("NVIDIA_API_KEY")

# 🎵 Audio normalization
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    print("⚠️ pydub not installed. Run 'pip install pydub'.")

# ==========================================
# 🛡️ PRE-FLIGHT CHECKS
# ==========================================
if not deepgram_api_key:
    print("⚠️ DEEPGRAM_API_KEY missing.")
if not groq_api_key:
    print("⚠️ GROQ_API_KEY missing.")
if not nvidia_api_key:
    print("⚠️ NVIDIA_API_KEY missing.")

# ==========================================
# 🚀 PRIMARY LLM CLIENT (Groq - Ultra Fast)
# ==========================================
GROQ_MODEL = "llama-3.3-70b-versatile"  # ✅ Current, fast, multilingual
NVIDIA_MODEL = "meta/llama-3.1-70b-instruct"  # Fallback


def get_primary_llm():
    """Returns (client, model_name) for primary LLM (Groq)"""
    if groq_client:
        return groq_client, GROQ_MODEL
    # Fallback to NVIDIA if Groq unavailable
    if nvidia_api_key:
        client = OpenAI(
            api_key=nvidia_api_key,
            base_url="https://integrate.api.nvidia.com/v1"
        )
        return client, NVIDIA_MODEL
    raise RuntimeError("No LLM client available. Check GROQ_API_KEY or NVIDIA_API_KEY.")


def get_fallback_llm():
    """Returns (client, model_name) for fallback LLM (NVIDIA)"""
    if nvidia_api_key:
        client = OpenAI(
            api_key=nvidia_api_key,
            base_url="https://integrate.api.nvidia.com/v1"
        )
        return client, NVIDIA_MODEL
    return None, None


# ==========================================
# 🎙️ SMART TRANSCRIPTION (Deepgram → Groq Whisper)
# ==========================================
def smart_transcribe(audio_bytes: bytes, prompt: str = "") -> str:
    """
    Primary: Deepgram nova-2
    Fallback: Groq Whisper (when Deepgram credits exhausted)
    """
    # 🔹 Attempt 1: Deepgram (Primary)
    if deepgram_client:
        try:
            print("🎙️ Trying Deepgram nova-2...")
            
            # ✅ Correct Deepgram v7 API - pass raw bytes directly
            response = deepgram_client.listen.v1.media.transcribe_file(
                request=audio_bytes,
                model="nova-2",
                smart_format=True,
                punctuate=True,
                detect_language=True,
            )
            transcript = response.results.channels[0].alternatives[0].transcript.strip()
            print(f"✅ Deepgram: '{transcript}'")
            return transcript
        except Exception as e:
            print(f"⚠️ Deepgram failed: {e}. Falling back to Groq Whisper...")
    
    # 🔹 Attempt 2: Groq Whisper (Fallback)
    if groq_client:
        try:
            print("🎤 Trying Groq Whisper...")
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = "input.wav"
            transcript = groq_client.audio.transcriptions.create(
                model="whisper-large-v3",
                file=audio_file,
                prompt=prompt or "Live conversation context."
            )
            result = transcript.text.strip()
            print(f"✅ Groq Whisper: '{result}'")
            return result
        except Exception as e:
            print(f"❌ Groq Whisper also failed: {e}")
    
    return ""


# ==========================================
# 🧠 SMART LLM CALL (Groq → NVIDIA fallback)
# ==========================================
def smart_llm_call(messages: list, temperature: float = 0.7) -> str:
    """
    Primary: Groq Llama 3.3 70B (ultra-fast)
    Fallback: NVIDIA Llama 3.1 70B
    """
    # 🔹 Attempt 1: Groq (Primary - blazing fast!)
    if groq_client:
        try:
            print(f"🚀 Trying Groq {GROQ_MODEL}...")
            response = groq_client.chat.completions.create(
                model=GROQ_MODEL,
                messages=messages,
                temperature=temperature,
            )
            result = response.choices[0].message.content.strip()
            print(f"✅ Groq responded ({len(result)} chars)")
            return result
        except Exception as e:
            print(f"⚠️ Groq failed: {e}. Falling back to NVIDIA...")
    
    # 🔹 Attempt 2: NVIDIA (Fallback)
    if nvidia_api_key:
        try:
            print(f"🧠 Trying NVIDIA {NVIDIA_MODEL}...")
            client = OpenAI(
                api_key=nvidia_api_key,
                base_url="https://integrate.api.nvidia.com/v1"
            )
            response = client.chat.completions.create(
                model=NVIDIA_MODEL,
                messages=messages,
                temperature=temperature,
            )
            result = response.choices[0].message.content.strip()
            print(f"✅ NVIDIA responded ({len(result)} chars)")
            return result
        except Exception as e:
            print(f"❌ NVIDIA also failed: {e}")
    
    return ""