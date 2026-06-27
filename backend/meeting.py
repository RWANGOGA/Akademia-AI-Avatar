import uuid
import random
import string
import hashlib
import os
import asyncio
from fastapi import WebSocket, WebSocketDisconnect

# ── Peer & Room models ────────────────────────────────────────────────────────

class MeetingPeer:
    def __init__(self, peer_id: str, websocket: WebSocket, name: str, speak_lang: str, hear_lang: str):
        self.peer_id    = peer_id
        self.websocket  = websocket
        self.name       = name
        self.speak_lang = speak_lang
        self.hear_lang  = hear_lang

    def meta(self) -> dict:
        return {
            "peer_id":    self.peer_id,
            "name":       self.name,
            "speak_lang": self.speak_lang,
            "hear_lang":  self.hear_lang,
        }


class MeetingRoom:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.peers: dict[str, MeetingPeer] = {}

    def peer_list(self, exclude: str = None) -> list:
        return [p.meta() for pid, p in self.peers.items() if pid != exclude]

    async def broadcast(self, message: dict, exclude: str = None):
        """Send a message to all peers except the excluded one."""
        for pid, peer in list(self.peers.items()):
            if exclude and pid == exclude:
                continue
            try:
                await peer.websocket.send_json(message)
            except Exception:
                self.peers.pop(pid, None)

    async def send_to(self, peer_id: str, message: dict):
        """Send a message to one specific peer."""
        peer = self.peers.get(peer_id)
        if peer:
            try:
                await peer.websocket.send_json(message)
            except Exception:
                self.peers.pop(peer_id, None)


# ── Room registry ─────────────────────────────────────────────────────────────

_meeting_rooms: dict[str, MeetingRoom] = {}


def _new_room_code() -> str:
    """Generate a unique 6-character uppercase alphanumeric room code."""
    chars = string.ascii_uppercase + string.digits
    for _ in range(32):
        code = "".join(random.choices(chars, k=6))
        if code not in _meeting_rooms:
            return code
    return str(uuid.uuid4())[:6].upper()


# ── Voice map ─────────────────────────────────────────────────────────────────

VOICE_MAP = {
    "en":      "en-US-JennyNeural",
    "en-US":   "en-US-JennyNeural",
    "en-UG":   "en-US-JennyNeural",
    "ja":      "ja-JP-NanamiNeural",
    "ja-JP":   "ja-JP-NanamiNeural",
    "zh":      "zh-CN-XiaoxiaoNeural",
    "zh-CN":   "zh-CN-XiaoxiaoNeural",
    "hi":      "hi-IN-SwaraNeural",
    "hi-IN":   "hi-IN-SwaraNeural",
    "luganda": "en-US-JennyNeural",
}

# ── Safe TTS wrapper (stays in meeting.py) ────────────────────────────────────

async def _safe_tts(text: str, voice: str, audio_path: str) -> list:
    """
    Call generate_tts_with_visemes with:
      1. Empty text guard  — returns [] instead of crashing Edge-TTS
      2. Retry on failure  — waits and retries up to 3 times
      3. Fallback          — returns [] on total failure, never raises 500
    """
    from ai import generate_tts_with_visemes

    # Guard: Edge-TTS crashes on empty or placeholder text
    clean = (text or "").strip()
    if not clean or clean in ("...", "…", ".", ""):
        print("⚠️  TTS skipped — empty or placeholder text")
        return []

    for attempt in range(3):
        try:
            visemes = await generate_tts_with_visemes(clean, voice, audio_path)
            return visemes
        except Exception as e:
            err = str(e)
            if "NoAudioReceived" in err or "no audio" in err.lower():
                # Edge-TTS got bad parameters — don't retry, just skip
                print(f"⚠️  TTS NoAudioReceived for voice={voice} — skipping")
                return []
            if "429" in err or "rate_limit" in err.lower():
                wait = (attempt + 1) * 4   # 4s, 8s, 12s
                print(f"⏳ TTS rate limit — waiting {wait}s (attempt {attempt+1}/3)")
                await asyncio.sleep(wait)
            else:
                # Unknown error — wait briefly and retry once
                print(f"⚠️  TTS error (attempt {attempt+1}/3): {e}")
                if attempt < 2:
                    await asyncio.sleep(2)

    print("⚠️  TTS failed after 3 attempts — returning empty visemes")
    return []


# ── /voice endpoint handler ───────────────────────────────────────────────────
# Imported by backend.py: from meeting import voice_tts_handler

async def voice_tts_handler(text: str, voice: str, culture: str) -> dict:
    """
    Fast TTS for the live meeting avatar interpreter.
    Returns { audio_url: str, visemes: list }.
    Uses _safe_tts so it never returns a 500 error.
    """
    # Resolve voice name
    resolved_voice = VOICE_MAP.get(voice) or VOICE_MAP.get(culture) or "en-US-JennyNeural"
    if voice and voice.endswith("Neural"):
        resolved_voice = voice

    # Unique filename — same text+voice reuses cached file
    text_hash  = hashlib.md5(f"{text}:{resolved_voice}".encode()).hexdigest()[:12]
    audio_name = f"live_{text_hash}.mp3"

    os.makedirs("static", exist_ok=True)
    audio_path = os.path.join("static", audio_name)

    # Use cached file if it already exists
    if os.path.exists(audio_path):
        from ai import generate_tts_with_visemes as _gtv
        # Rebuild visemes from cache is not possible without re-streaming,
        # so we re-generate only if file is missing. If cached, return empty
        # visemes (avatar still plays audio, just no lip sync from cache).
        return {
            "audio_url": f"/static/{audio_name}",
            "visemes":   [],
        }

    visemes = await _safe_tts(text, resolved_voice, audio_path)

    return {
        "audio_url": f"/static/{audio_name}",
        "visemes":   visemes,
    }


# ── Groq translate with retry (stays in meeting.py) ───────────────────────────

async def _meeting_translate(text: str, target_lang: str, backend_url: str = "http://localhost:8000") -> str:
    """
    Translate text via the /translate endpoint with retry on 429.
    Used only inside the WebSocket handler for server-side translation.
    """
    if not text or not text.strip():
        return text

    import httpx

    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{backend_url}/translate",
                    data={"text": text, "target": target_lang}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("text") or text
                if resp.status_code == 429:
                    wait = (attempt + 1) * 3
                    print(f"⏳ Translate 429 — waiting {wait}s")
                    await asyncio.sleep(wait)
                else:
                    return text
        except Exception as e:
            print(f"⚠️  Translate error (attempt {attempt+1}/3): {e}")
            if attempt < 2:
                await asyncio.sleep(2)

    return text  # fallback: return original if all retries fail


# ── WebSocket handler ─────────────────────────────────────────────────────────

async def handle_meeting_websocket(websocket: WebSocket, room_id: str):
    """
    Handle all WebSocket traffic for a meeting room.

    Message types accepted from clients:
      join        — register peer name + languages, get current peer list
      offer       — WebRTC offer SDP  (relay to target peer)
      answer      — WebRTC answer SDP (relay to target peer)
      ice         — ICE candidate     (relay to target peer)
      transcript  — spoken text chunk (broadcast to all other peers)
      chat        — typed message     (broadcast to all peers including sender)
      leave       — clean disconnect

    Message types sent to clients:
      joined       — confirmation with peer_id + current peer list
      peer-joined  — new participant metadata
      peer-left    — departed peer_id
      offer / answer / ice — relayed WebRTC payloads
      transcript   — relayed spoken chunk with speaker name + lang
      chat         — relayed typed message with per-peer translation
    """
    room_id = room_id.upper()

    if room_id not in _meeting_rooms:
        _meeting_rooms[room_id] = MeetingRoom(room_id)

    room    = _meeting_rooms[room_id]
    peer_id = str(uuid.uuid4())
    peer    = None

    await websocket.accept()

    try:
        while True:
            data     = await websocket.receive_json()
            msg_type = data.get("type")

            # ── Join ──────────────────────────────────────────────────────────
            if msg_type == "join":
                peer = MeetingPeer(
                    peer_id,
                    websocket,
                    (data.get("name") or "Guest")[:40],
                    data.get("speak_lang", "en"),
                    data.get("hear_lang",  "ja"),
                )
                room.peers[peer_id] = peer

                await websocket.send_json({
                    "type":    "joined",
                    "peer_id": peer_id,
                    "room_id": room_id,
                    "peers":   room.peer_list(exclude=peer_id),
                })

                await room.broadcast(
                    {"type": "peer-joined", "peer": peer.meta()},
                    exclude=peer_id,
                )

            # ── WebRTC signaling ──────────────────────────────────────────────
            elif msg_type in ("offer", "answer", "ice") and peer:
                target = data.get("to")
                if not target:
                    continue

                payload = {
                    "type": msg_type,
                    "from": peer_id,
                    "to":   target,
                }
                if msg_type == "ice":
                    payload["candidate"] = data.get("candidate")
                else:
                    payload["sdp"] = data.get("sdp")

                await room.send_to(target, payload)

            # ── Transcript chunk (spoken speech) ──────────────────────────────
            # Broadcast as-is — each client translates to their own hearLang
            # in LiveMeetingSystem.js using _callTranslate()
            elif msg_type == "transcript" and peer:
                await room.broadcast(
                    {
                        "type":  "transcript",
                        "from":  peer_id,
                        "name":  peer.name,
                        "text":  data.get("text", ""),
                        "lang":  data.get("lang", peer.speak_lang),
                        "final": bool(data.get("final", True)),
                    },
                    exclude=peer_id,
                )

            # ── Chat message ──────────────────────────────────────────────────
            # Each receiving peer gets the original text + their own translation.
            # Translation happens per-peer so everyone sees their hearLang.
            elif msg_type == "chat" and peer:
                original  = data.get("text", "")
                src_lang  = data.get("lang", peer.speak_lang)

                # Send to each peer individually with their own translation
                for pid, receiving_peer in list(room.peers.items()):
                    translated = original  # default: no translation

                    # Only translate if languages differ
                    if receiving_peer.hear_lang != src_lang and original.strip():
                        try:
                            translated = await _meeting_translate(
                                original, receiving_peer.hear_lang
                            )
                        except Exception:
                            translated = original  # safe fallback

                    try:
                        await receiving_peer.websocket.send_json({
                            "type":       "chat",
                            "from":       peer_id,
                            "name":       peer.name,
                            "text":       original,
                            "translated": translated,
                            "lang":       src_lang,
                            "hear_lang":  receiving_peer.hear_lang,
                        })
                    except Exception:
                        room.peers.pop(pid, None)

            # ── Leave ─────────────────────────────────────────────────────────
            elif msg_type == "leave":
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Meeting WebSocket error ({room_id}): {e}")
    finally:
        if peer and peer_id in room.peers:
            room.peers.pop(peer_id, None)
            await room.broadcast({"type": "peer-left", "peer_id": peer_id})

        if not room.peers:
            _meeting_rooms.pop(room_id, None)