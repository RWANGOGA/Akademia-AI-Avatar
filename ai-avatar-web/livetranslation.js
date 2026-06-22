// ==========================================
// 🌐 LIVE TRANSLATION MODULE
// Matches the new backend protocol in live_translation.py
// ==========================================

let liveWs = null;
let liveMediaRecorder = null;
let liveAudioChunks = [];
let isLiveRecording = false;
let audioCtx = null;

// 🆔 IDENTITY TRACKING
let _myIdentity = { name: '', title: '', language: 'English' };
let _myParticipantId = null;

// Generate a unique participant ID for this session
function generateParticipantId() {
    const existing = sessionStorage.getItem('live_participant_id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem('live_participant_id', fresh);
    return fresh;
}

export function getMyIdentity() {
    return _myIdentity;
}

export function hasJoinedRoom() {
    return liveWs !== null && liveWs.readyState === WebSocket.OPEN;
}

// Aliases for main.js compatibility
export const startListening = startLiveRecording;
export const stopListening = stopLiveRecording;
export const isCurrentlyListening = () => isLiveRecording;

// ------------------------------------------
// 🪪 CONNECT TO LIVE TRANSLATION ROOM
// ------------------------------------------
export function connectLiveTranslation(identity) {
    if (identity) {
        _myIdentity = { ..._myIdentity, ...identity };
    }

    if (liveWs && (liveWs.readyState === WebSocket.OPEN || liveWs.readyState === WebSocket.CONNECTING)) {
        return;
    }

    _myParticipantId = generateParticipantId();
    const roomId = 'room1'; // Can be made dynamic later
    
    console.log(`🔌 Connecting to room "${roomId}" as "${_myIdentity.name}" (ID: ${_myParticipantId})`);
    
    liveWs = new WebSocket(`ws://localhost:8000/live_translation/${roomId}/${_myParticipantId}`);

    liveWs.onopen = () => {
        console.log(`✅ WebSocket connected. Sending join packet...`);
        
        // 🆕 Send the required "join" packet as the FIRST message
        liveWs.send(JSON.stringify({
            type: "join",
            name: _myIdentity.name,
            title: _myIdentity.title || "",
            language: _myIdentity.language
        }));
        
        // Update the UI button
        const btn = document.getElementById('startTranslationBtn');
        if (btn) {
            btn.innerText = '🌐 Connected';
            btn.classList.add('active');
            btn.disabled = false;
        }
    };

    liveWs.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log("📩 Received:", data.type, data);

            switch (data.type) {
                case "roster":
                    handleRoster(data.participants);
                    break;
                    
                case "caption":
                    handleCaption(data);
                    break;
                    
                case "audio":
                    await handleAudio(data);
                    break;
                    
                case "own_caption":
                    handleOwnCaption(data);
                    break;
                    
                case "error":
                    console.warn("⚠️ Server error:", data.message);
                    break;
                    
                default:
                    console.log("Unknown message type:", data);
            }
        } catch (e) {
            console.log("Non-JSON message:", event.data);
        }
    };

    liveWs.onclose = () => {
        console.log("❌ Live translation socket closed");
        const btn = document.getElementById('startTranslationBtn');
        if (btn) {
            btn.innerText = '🌐 Not connected';
            btn.classList.remove('active');
            btn.disabled = true;
        }
    };

    liveWs.onerror = (err) => {
        console.error("❌ Live translation socket error:", err);
    };
}

// ------------------------------------------
// 📋 HANDLE ROSTER UPDATES
// ------------------------------------------
function handleRoster(participants) {
    console.log("👥 Roster update:", participants);
    
    const me = _myIdentity;
    const others = participants.filter(p => 
        !(p.name === me.name && p.language === me.language)
    );
    
    const theirLabel = document.getElementById('theirPanelLabel');
    const theirPlaceholderText = document.querySelector('#theirPlaceholder .video-placeholder-text');
    
    if (others.length === 0) {
        if (theirLabel) theirLabel.innerText = 'Other participant';
        if (theirPlaceholderText) theirPlaceholderText.innerText = 'Waiting for participant...';
    } else {
        const other = others[0];
        const label = other.title ? `${other.name} (${other.title})` : other.name;
        if (theirLabel) theirLabel.innerText = `${label} — ${other.language}`;
        if (theirPlaceholderText) theirPlaceholderText.innerText = `${other.name} joined`;
    }
    
    // Dispatch custom event for main.js
    window.dispatchEvent(new CustomEvent('live-translation-roster', { 
        detail: participants 
    }));
}

// ------------------------------------------
// 💬 HANDLE CAPTIONS (from other participants)
// ------------------------------------------
function handleCaption(data) {
    const theirPanel = document.getElementById('theirTranslation');
    if (!theirPanel) return;
    
    const origEl = theirPanel.querySelector('.original-text');
    const transEl = theirPanel.querySelector('.translated-text');
    const nameEl = theirPanel.querySelector('.participant-name');
    
    if (origEl) origEl.textContent = data.original_text;
    if (transEl) transEl.textContent = data.translated_text;
    if (nameEl) {
        const speakerLabel = data.from_title 
            ? `${data.from_name} (${data.from_title})` 
            : data.from_name;
        nameEl.textContent = speakerLabel;
    }
}

// ------------------------------------------
// 🔊 HANDLE AUDIO PLAYBACK
// ------------------------------------------
async function handleAudio(data) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        
        const response = await fetch(data.audio_url);
        if (!response.ok) {
            console.warn("⚠️ Audio fetch failed:", response.status);
            return;
        }
        
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength === 0) {
            console.warn("⚠️ Empty audio file");
            return;
        }
        
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start(0);
        
        return new Promise((resolve) => {
            source.onended = resolve;
        });
    } catch (e) {
        console.error("❌ Failed to play translated audio:", e);
    }
}

// ------------------------------------------
// 🎤 HANDLE OWN CAPTIONS (echoed back)
// ------------------------------------------
function handleOwnCaption(data) {
    const myPanel = document.getElementById('myTranslation');
    if (!myPanel) return;
    
    const origEl = myPanel.querySelector('.original-text');
    if (origEl) origEl.textContent = data.original_text;
}

// ------------------------------------------
// 🔌 DISCONNECT
// ------------------------------------------
export function disconnectLiveTranslation() {
    if (liveWs) {
        liveWs.close();
        liveWs = null;
    }
    if (liveMediaRecorder && isLiveRecording) {
        liveMediaRecorder.stop();
    }
}

// ------------------------------------------
// 🎙️ MICROPHONE RECORDING
// ------------------------------------------
export async function startLiveRecording() {
    if (isLiveRecording) return;
    
    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) {
        alert("⚠️ Please connect to the room first!");
        return false;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support microphone access.');
        return false;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { 
                echoCancellation: true, 
                noiseSuppression: true, 
                channelCount: 1,
                sampleRate: 48000
            }
        });

        liveAudioChunks = [];
        liveMediaRecorder = new MediaRecorder(stream, { 
            mimeType: 'audio/webm;codecs=opus' 
        });

        liveMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                liveAudioChunks.push(event.data);
            }
        };

        liveMediaRecorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            isLiveRecording = false;

            if (liveAudioChunks.length === 0) return;

            const blob = new Blob(liveAudioChunks, { type: 'audio/webm;codecs=opus' });
            console.log(`🚀 Sending audio (${blob.size} bytes)...`);

            if (liveWs && liveWs.readyState === WebSocket.OPEN) {
                // 🆕 Send RAW BYTES (not JSON) — matches backend's data["bytes"]
                liveWs.send(blob);
            } else {
                console.warn("⚠️ Socket not open — audio not sent.");
            }
        };

        liveMediaRecorder.start();
        isLiveRecording = true;
        console.log('🎙️ Live recording started');
        return true;
    } catch (error) {
        console.error('❌ Failed to start live recording:', error);
        alert('Unable to access microphone. Please allow microphone permission.');
        return false;
    }
}

export function stopLiveRecording() {
    if (liveMediaRecorder && isLiveRecording) {
        liveMediaRecorder.stop();
    }
}