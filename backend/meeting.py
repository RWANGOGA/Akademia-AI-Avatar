import uuid
import random
import string
from fastapi import WebSocket, WebSocketDisconnect

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
            "hear_lang": self.hear_lang
        }

class MeetingRoom:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.peers: dict[str, MeetingPeer] = {}

    def peer_list(self, exclude: str = None) -> list:
        return [p.meta() for pid, p in self.peers.items() if pid != exclude]

    async def broadcast(self, message: dict, exclude: str = None):
        """Send message to all peers except the excluded one."""
        for pid, peer in list(self.peers.items()):
            if exclude and pid == exclude:
                continue
            try:
                await peer.websocket.send_json(message)
            except:
                self.peers.pop(pid, None)

    async def send_to(self, peer_id: str, message: dict):
        """Send message to a specific peer."""
        peer = self.peers.get(peer_id)
        if peer:
            try:
                await peer.websocket.send_json(message)
            except:
                self.peers.pop(peer_id, None)

_meeting_rooms: dict[str, MeetingRoom] = {}

def _new_room_code() -> str:
    """Generate a unique 6-character room code."""
    chars = string.ascii_uppercase + string.digits
    for _ in range(32):
        code = "".join(random.choices(chars, k=6))
        if code not in _meeting_rooms:
            return code
    return str(uuid.uuid4())[:6].upper()

async def handle_meeting_websocket(websocket: WebSocket, room_id: str):
    """Handle WebSocket connections for live meetings."""
    room_id = room_id.upper()
    
    # Create room if it doesn't exist
    if room_id not in _meeting_rooms:
        _meeting_rooms[room_id] = MeetingRoom(room_id)
    
    room = _meeting_rooms[room_id]
    await websocket.accept()
    
    peer_id = str(uuid.uuid4())
    peer = None

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # Join room
            if msg_type == "join":
                peer = MeetingPeer(
                    peer_id,
                    websocket,
                    (data.get("name") or "Guest")[:40],
                    data.get("speak_lang", "en"),
                    data.get("hear_lang", "ja")
                )
                room.peers[peer_id] = peer
                
                # Send confirmation to this peer
                await websocket.send_json({
                    "type": "joined",
                    "peer_id": peer_id,
                    "room_id": room_id,
                    "peers": room.peer_list(exclude=peer_id)
                })
                
                # Notify others
                await room.broadcast({
                    "type": "peer-joined",
                    "peer": peer.meta()
                }, exclude=peer_id)
            
            # WebRTC signaling
            elif msg_type in ("offer", "answer", "ice") and peer:
                target = data.get("to")
                if not target:
                    continue
                
                payload = {
                    "type": msg_type,
                    "from": peer_id,
                    "to": target
                }
                
                if msg_type == "ice":
                    payload["candidate"] = data.get("candidate")
                else:
                    payload["sdp"] = data.get("sdp")
                
                await room.send_to(target, payload)
            
            # Transcript broadcast
            elif msg_type == "transcript" and peer:
                await room.broadcast({
                    "type": "transcript",
                    "from": peer_id,
                    "name": peer.name,
                    "text": data.get("text", ""),
                    "lang": data.get("lang", peer.speak_lang),
                    "final": bool(data.get("final", True))
                }, exclude=peer_id)
            
            # Chat message
            elif msg_type == "chat" and peer:
                await room.broadcast({
                    "type": "chat",
                    "from": peer_id,
                    "name": peer.name,
                    "text": data.get("text", ""),
                    "lang": data.get("lang", peer.speak_lang)
                })
            
            # Leave room
            elif msg_type == "leave":
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Meeting WebSocket error ({room_id}): {e}")
    finally:
        # Clean up peer
        if peer and peer_id in room.peers:
            room.peers.pop(peer_id, None)
            await room.broadcast({
                "type": "peer-left",
                "peer_id": peer_id
            })
        
        # Delete room if empty
        if not room.peers:
            _meeting_rooms.pop(room_id, None)