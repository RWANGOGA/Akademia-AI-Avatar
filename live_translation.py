import io
import json
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

import edge_tts

from clients import groq_stt_client, get_llm_client, PYDUB_AVAILABLE

try:
    from pydub import AudioSegment
except ImportError:
    pass

router = APIRouter()

# ==========================================
# ROOM MANAGEMENT — pairs Interviewer + Candidate per room_id
# ==========================================
class TranslationRoom:
    def __init__(self):
        self.connections: dict[str, WebSocket] = {}  # role -> websocket

    async def connect(self, role: str, websocket: WebSocket):
        await websocket.accept()
        self.connections[role] = websocket
        print(f"🟢 [{role}] joined the live translation room")

    def disconnect(self, role: str):
        self.connections.pop(role, None)
        print(f"🔴 [{role}] left the live translation room")

    async def send_to(self, role: str, payload: dict):
        ws = self.connections.get(role)
        if ws:
            await ws.send_text(json.dumps(payload))


rooms: dict[str, TranslationRoom] = {}


def get_room(room_id: str) -> TranslationRoom:
    if room_id not in rooms:
        rooms[room_id] = TranslationRoom()
    return rooms[room_id]


# Speaker role -> spoken language / target party / target language / TTS voice
ROLE_LANGUAGE = {
    "interviewer": {
        "target_role": "candidate",
        "target_lang": "Japanese",
        "voice": "ja-JP-NanamiNeural",
    },
    "candidate": {
        "target_role": "interviewer",
        "target_lang": "English",
        "voice": "en-US-AriaNeural",
    },
}


def normalize_audio(raw_bytes: bytes) -> bytes:
    if not PYDUB_AVAILABLE:
        return raw_bytes
    try:
        audio_stream = io.BytesIO(raw_bytes)
        audio_segment = AudioSegment.from_file(audio_stream)
        wav_io = io.BytesIO()
        audio_segment.export(wav_io, format="wav", parameters=["-ac", "1", "-ar", "16000"])
        return wav_io.getvalue()
    except Exception as e:
        print(f"⚠️ Normalization bypassed: {e}")
        return raw_bytes


def transcribe(audio_bytes: bytes) -> str:
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = "input.wav"
    transcript = groq_stt_client.audio.transcriptions.create(
        model="whisper-large-v3",
        file=audio_file,
        prompt="Live interview conversation."
    )
    return transcript.text.strip()


def translate(text: str, target_lang: str) -> str:
    client, model_name = get_llm_client("nvidia/meta/llama-3.1-70b-instruct")
    system_instruction = (
        f"You are a professional simultaneous interpreter. "
        f"Translate the following spoken text EXACTLY and FAITHFULLY into {target_lang}. "
        f"Do not answer it, comment on it, explain it, or add anything. "
        f"Output ONLY the translated text, nothing else."
    )
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": text}
        ]
    )
    return response.choices[0].message.content.strip()


async def generate_tts(text: str, voice: str, path: str):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(path)


@router.websocket("/live_translation/{room_id}/{role}")
async def live_translation_endpoint(websocket: WebSocket, room_id: str, role: str):
    if role not in ROLE_LANGUAGE:
        await websocket.close(code=1008)
        return

    room = get_room(room_id)
    await room.connect(role, websocket)

    try:
        while True:
            data = await websocket.receive()

            if data.get("type") == "websocket.disconnect":
                break

            if "bytes" in data:
                raw_audio = data["bytes"]
                config = ROLE_LANGUAGE[role]
                target_role = config["target_role"]

                try:
                    print(f"🎤 [{role}] Received audio chunk ({len(raw_audio)} bytes)...")
                    normalized = normalize_audio(raw_audio)

                    spoken_text = transcribe(normalized)
                    if not spoken_text or len(spoken_text) < 2:
                        print("🤫 Empty/too short, skipping.")
                        continue

                    print(f"📝 [{role}] said: {spoken_text}")

                    translated_text = translate(spoken_text, config["target_lang"])
                    print(f"🌐 Translated for {target_role}: {translated_text}")

                    # Unique filename avoids collisions between simultaneous speakers
                    audio_filename = f"{uuid.uuid4().hex}.mp3"
                    audio_path = f"static/{audio_filename}"
                    await generate_tts(translated_text, config["voice"], audio_path)

                    payload = {
                        "type": "translation",
                        "original_text": spoken_text,
                        "translated_text": translated_text,
                        "audio_url": f"http://localhost:8000/translation_audio/{audio_filename}",
                        "from_role": role,
                    }

                    # Send translated speech to the OTHER participant
                    await room.send_to(target_role, payload)
                    # Echo the original caption back to the speaker themselves
                    await room.send_to(role, {**payload, "type": "own_transcript"})

                except Exception as e:
                    print(f"❌ Live translation pipeline error: {e}")
                    continue

    except WebSocketDisconnect:
        print(f"🔴 [{role}] disconnected from room {room_id}")
    finally:
        room.disconnect(role)