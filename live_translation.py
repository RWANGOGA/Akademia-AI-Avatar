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
# ROOM MANAGEMENT
# Each participant joins with their OWN chosen name, title, and language
# (like entering your name on a Zoom join screen) — nothing is hardcoded
# to a fixed "interviewer" or "candidate" role anymore. The backend
# translates whatever a speaker says into every OTHER participant's own
# chosen language, dynamically.
# ==========================================

# Maps a spoken/target language name to an Edge-TTS voice.
# Add more entries here to support additional languages.
LANGUAGE_VOICES = {
    "English": "en-US-AriaNeural",
    "Japanese": "ja-JP-NanamiNeural",
    "French": "fr-FR-DeniseNeural",
    "Spanish": "es-ES-ElviraNeural",
    "German": "de-DE-KatjaNeural",
    "Chinese": "zh-CN-XiaoxiaoNeural",
    "Korean": "ko-KR-SunHiNeural",
    "Arabic": "ar-SA-ZariyahNeural",
    "Swahili": "sw-KE-ZuriNeural",
    "Luganda": "en-US-AriaNeural",  # fallback — Edge-TTS has no native Luganda voice
}

DEFAULT_VOICE = "en-US-AriaNeural"


def voice_for_language(language: str) -> str:
    return LANGUAGE_VOICES.get(language, DEFAULT_VOICE)


class Participant:
    def __init__(self, websocket: WebSocket, name: str, title: str, language: str):
        self.websocket = websocket
        self.name = name
        self.title = title
        self.language = language
        self.last_sentence = ""  # used as translation context for this speaker


class TranslationRoom:
    def __init__(self):
        self.participants: dict[str, Participant] = {}  # participant_id -> Participant

    async def join(self, participant_id: str, websocket: WebSocket, name: str, title: str, language: str):
        await websocket.accept()
        self.participants[participant_id] = Participant(websocket, name, title, language)
        print(f"🟢 \"{name}\" ({title}, speaks {language}) joined the room")
        await self.broadcast_roster()

    def leave(self, participant_id: str):
        participant = self.participants.pop(participant_id, None)
        if participant:
            print(f"🔴 \"{participant.name}\" left the room")

    def get(self, participant_id: str) -> Participant | None:
        return self.participants.get(participant_id)

    def others(self, participant_id: str):
        return {pid: p for pid, p in self.participants.items() if pid != participant_id}

    async def send_to(self, participant_id: str, payload: dict):
        participant = self.participants.get(participant_id)
        if participant:
            await participant.websocket.send_text(json.dumps(payload))

    async def broadcast_roster(self):
        """Let everyone know who's currently in the room and what language they speak."""
        roster = [
            {"name": p.name, "title": p.title, "language": p.language}
            for p in self.participants.values()
        ]
        for participant in self.participants.values():
            try:
                await participant.websocket.send_text(json.dumps({
                    "type": "roster",
                    "participants": roster,
                }))
            except Exception:
                pass


rooms: dict[str, TranslationRoom] = {}


def get_room(room_id: str) -> TranslationRoom:
    if room_id not in rooms:
        rooms[room_id] = TranslationRoom()
    return rooms[room_id]


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
        prompt="Live conversation between people speaking different languages."
    )
    return transcript.text.strip()


def translate(text: str, target_lang: str, previous_sentence: str = "") -> str:
    client, model_name = get_llm_client("nvidia/meta/llama-3.1-70b-instruct")

    context_line = (
        f"For context only, the speaker's previous sentence was: \"{previous_sentence}\". "
        f"Use it only to resolve pronouns or references in the new sentence — do not translate it again.\n"
        if previous_sentence else ""
    )

    system_instruction = (
        f"You are a professional simultaneous interpreter. "
        f"Translate the following spoken text EXACTLY and FAITHFULLY into {target_lang}. "
        f"{context_line}"
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


@router.websocket("/live_translation/{room_id}/{participant_id}")
async def live_translation_endpoint(websocket: WebSocket, room_id: str, participant_id: str):
    # The first message after connecting must be a JSON "join" packet
    # carrying the participant's own chosen name, title, and language —
    # equivalent to a Zoom join screen. Nothing is pre-decided server-side.
    room = get_room(room_id)

    await websocket.accept()
    try:
        first_message = await websocket.receive_json()
    except Exception:
        await websocket.close(code=1008)
        return

    if first_message.get("type") != "join":
        await websocket.close(code=1008)
        return

    name = (first_message.get("name") or "Guest").strip()[:60]
    title = (first_message.get("title") or "").strip()[:60]
    language = (first_message.get("language") or "English").strip()

    room.participants[participant_id] = Participant(websocket, name, title, language)
    print(f"🟢 \"{name}\" ({title or 'no title'}, speaks {language}) joined room \"{room_id}\"")
    await room.broadcast_roster()

    try:
        while True:
            data = await websocket.receive()

            if data.get("type") == "websocket.disconnect":
                break

            if "bytes" in data:
                raw_audio = data["bytes"]
                speaker = room.get(participant_id)
                if not speaker:
                    continue

                try:
                    print(f"🎤 [{speaker.name}] Received audio chunk ({len(raw_audio)} bytes)...")
                    normalized = normalize_audio(raw_audio)

                    spoken_text = transcribe(normalized)
                    if not spoken_text or len(spoken_text) < 2:
                        print("🤫 Empty/too short, skipping.")
                        continue

                    print(f"📝 [{speaker.name}] said: {spoken_text}")

                    # Translate into EVERY other participant's own chosen
                    # language — not a single fixed counterpart language.
                    other_participants = room.others(participant_id)

                    if not other_participants:
                        # No one else in the room yet to translate for
                        speaker.last_sentence = spoken_text
                        continue

                    for other_id, other in other_participants.items():
                        translated_text = translate(
                            spoken_text,
                            other.language,
                            speaker.last_sentence,
                        )
                        print(f"🌐 For {other.name} ({other.language}): {translated_text}")

                        # STEP 1 — caption arrives instantly
                        await room.send_to(other_id, {
                            "type": "caption",
                            "original_text": spoken_text,
                            "translated_text": translated_text,
                            "from_name": speaker.name,
                            "from_title": speaker.title,
                        })

                        # STEP 2 — audio generated and sent after, so the
                        # listener already has text on screen while this
                        # ~0.5-1s step runs.
                        audio_filename = f"{uuid.uuid4().hex}.mp3"
                        audio_path = f"static/{audio_filename}"
                        await generate_tts(translated_text, voice_for_language(other.language), audio_path)

                        await room.send_to(other_id, {
                            "type": "audio",
                            "audio_url": f"http://localhost:8000/translation_audio/{audio_filename}",
                            "from_name": speaker.name,
                        })

                    # Echo the original caption back to the speaker themselves
                    await room.send_to(participant_id, {
                        "type": "own_caption",
                        "original_text": spoken_text,
                    })

                    speaker.last_sentence = spoken_text

                except Exception as e:
                    print(f"❌ Live translation pipeline error: {e}")
                    for other_id in room.others(participant_id):
                        await room.send_to(other_id, {
                            "type": "error",
                            "message": "Translation failed for the last message. Please try speaking again.",
                        })
                    continue

    except WebSocketDisconnect:
        print(f"🔴 Participant disconnected from room {room_id}")
    finally:
        room.leave(participant_id)
        await room.broadcast_roster()