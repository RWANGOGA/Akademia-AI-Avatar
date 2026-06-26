import uuid
import random
import string
import hashlib
import os
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


# ── /voice endpoint helper ────────────────────────────────────────────────────
# Called by backend.py as:  from meeting import voice_tts_handler
# Kept here so all live-meeting code stays in meeting.py.

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


async def voice_tts_handler(text: str, voice: str, culture: str) -> dict:
    """
    Generate TTS audio + viseme timeline for the avatar interpreter.
    Returns { audio_url: str, visemes: list }.
    Imported and used by backend.py for the POST /voice endpoint.
    Keeps all meeting-related logic inside meeting.py.
    """
    # Import here to avoid circular imports — ai.py is a peer module
    from ai import generate_tts_with_visemes

    # Resolve voice name
    resolved_voice = VOICE_MAP.get(voice) or VOICE_MAP.get(culture) or "en-US-JennyNeural"
    if voice and voice.endswith("Neural"):
        resolved_voice = voice  # full neural name passed directly

    # Build a unique filename from text + voice so identical requests reuse cache
    text_hash  = hashlib.md5(f"{text}:{resolved_voice}".encode()).hexdigest()[:12]
    audio_name = f"live_{text_hash}.mp3"

    os.makedirs("static", exist_ok=True)
    audio_path = os.path.join("static", audio_name)

    visemes = await generate_tts_with_visemes(text, resolved_voice, audio_path)

    return {
        "audio_url": f"/static/{audio_name}",
        "visemes":   visemes,
    }


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
      joined      — confirmation with peer_id + current peer list
      peer-joined — new participant metadata
      peer-left   — departed peer_id
      offer / answer / ice — relayed WebRTC payloads
      transcript  — relayed spoken chunk with speaker name + lang
      chat        — relayed typed message
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

                # Tell this peer their ID and who is already in the room
                await websocket.send_json({
                    "type":    "joined",
                    "peer_id": peer_id,
                    "room_id": room_id,
                    "peers":   room.peer_list(exclude=peer_id),
                })

                # Tell everyone else a new peer arrived
                await room.broadcast(
                    {"type": "peer-joined", "peer": peer.meta()},
                    exclude=peer_id,
                )

            # ── WebRTC signaling: relay offer / answer / ICE ──────────────────
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

            # ── Chat message (typed text) ──────────────────────────────────────
            elif msg_type == "chat" and peer:
                # Broadcast to ALL peers including sender so sender sees their
                # own message in the chat strip styled correctly
                await room.broadcast(
                    {
                        "type": "chat",
                        "from": peer_id,
                        "name": peer.name,
                        "text": data.get("text", ""),
                        "lang": data.get("lang", peer.speak_lang),
                    }
                )

            # ── Leave ─────────────────────────────────────────────────────────
            elif msg_type == "leave":
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Meeting WebSocket error ({room_id}): {e}")
    finally:
        # Clean up peer on any exit path
        if peer and peer_id in room.peers:
            room.peers.pop(peer_id, None)
            await room.broadcast({"type": "peer-left", "peer_id": peer_id})

        # Delete the room when it is empty
        if not room.peers:
            _meeting_rooms.pop(room_id, None)