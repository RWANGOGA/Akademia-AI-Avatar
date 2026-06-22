// ==========================================
// 🌐 LIVE TRANSLATION MODULE - Enhanced Captions
// ==========================================

let liveWs = null;
let liveMediaRecorder = null;
let liveAudioChunks = [];
let isLiveRecording = false;
let audioCtx = null;

// 🆔 IDENTITY TRACKING
let _myIdentity = { name: '', title: '', language: 'English' };
let _myParticipantId = null;

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
// CONNECT TO LIVE TRANSLATION ROOM
// ------------------------------------------
export function connectLiveTranslation(identity) {
    if (identity) {
        _myIdentity = { ..._myIdentity, ...identity };
    }

    if (liveWs && (liveWs.readyState === WebSocket.OPEN || liveWs.readyState === WebSocket.CONNECTING)) {
        return;
    }

    _myParticipantId = generateParticipantId();
    const roomId = 'room1';

    console.log(`🔌 Connecting to room "${roomId}" as "${_myIdentity.name}"`);

    liveWs = new WebSocket(`ws://localhost:8000/live_translation/${roomId}/${_myParticipantId}`);

    liveWs.onopen = () => {
        console.log(`✅ Connected. Sending join packet...`);
        liveWs.send(JSON.stringify({
            type: "join",
            name: _myIdentity.name,
            title: _myIdentity.title || "",
            language: _myIdentity.language
        }));

        const btn = document.getElementById('startTranslationBtn');
        if (btn) {
            btn.innerText = '🌐 Connected';
            btn.classList.add('active');
        }
    };

    liveWs.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);

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
            }
        } catch (e) {
            console.log("Non-JSON message:", event.data);
        }
    };

    liveWs.onclose = () => {
        console.log("❌ Live translation closed");
        const btn = document.getElementById('startTranslationBtn');
        if (btn) {
            btn.innerText = '🌐 Connect';
            btn.classList.remove('active');
        }
    };

    liveWs.onerror = (err) => console.error("WebSocket error:", err);
};

// ------------------------------------------
// IMPROVED CAPTION HANDLER (Google Meet Style)
// ------------------------------------------
function handleCaption(data) {
    const captionBox = document.getElementById('live-caption-box');
    if (!captionBox) return;

    const nameEl = captionBox.querySelector('.speaker-name');
    const origEl = captionBox.querySelector('.original-text');
    const transEl = captionBox.querySelector('.translated-text');

    if (nameEl) {
        const speakerLabel = data.from_title 
            ? `${data.from_name} (${data.from_title})` 
            : data.from_name;
        nameEl.textContent = speakerLabel;
    }

    if (origEl) origEl.textContent = data.original_text || '';
    if (transEl) transEl.textContent = data.translated_text || '';

    // Lively effect
    captionBox.classList.add('caption-active');
    setTimeout(() => {
        captionBox.classList.remove('caption-active');
    }, 8000);
}

// ------------------------------------------
// OWN CAPTION
// ------------------------------------------
function handleOwnCaption(data) {
    const myCaption = document.getElementById('my-caption-box');
    if (!myCaption) return;

    const textEl = myCaption.querySelector('.my-text');
    if (textEl) textEl.textContent = data.original_text || '';
}

// ------------------------------------------
// AUDIO PLAYBACK
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
        if (!response.ok) return;

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start(0);
    } catch (e) {
        console.error("Audio playback failed:", e);
    }
}

// ------------------------------------------
// ROSTER
// ------------------------------------------
function handleRoster(participants) {
    console.log("👥 Roster update:", participants);
    
    const theirLabel = document.getElementById('theirPanelLabel');
    const theirPlaceholder = document.querySelector('#theirPlaceholder .video-placeholder-text');
    
    const others = participants.filter(p => 
        !(p.name === _myIdentity.name && p.language === _myIdentity.language)
    );

    if (others.length === 0) {
        if (theirLabel) theirLabel.innerText = 'Other participant';
        if (theirPlaceholder) theirPlaceholder.innerText = 'Waiting for participant...';
    } else {
        const other = others[0];
        const label = other.title ? `${other.name} (${other.title})` : other.name;
        if (theirLabel) theirLabel.innerText = `${label} — ${other.language}`;
        if (theirPlaceholder) theirPlaceholder.innerText = `${other.name} joined`;
    }
}

// ------------------------------------------
// RECORDING
// ------------------------------------------
export async function startLiveRecording() {
    if (isLiveRecording) return false;
    if (!liveWs || liveWs.readyState !== WebSocket.OPEN) {
        alert("Please connect to the room first!");
        return false;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });

        liveAudioChunks = [];
        liveMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

        liveMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) liveAudioChunks.push(event.data);
        };

        liveMediaRecorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            isLiveRecording = false;

            if (liveAudioChunks.length > 0) {
                const blob = new Blob(liveAudioChunks, { type: 'audio/webm;codecs=opus' });
                if (liveWs && liveWs.readyState === WebSocket.OPEN) {
                    liveWs.send(blob);
                }
            }
        };

        liveMediaRecorder.start();
        isLiveRecording = true;
        console.log('🎙️ Recording started');
        return true;
    } catch (error) {
        console.error('Microphone error:', error);
        alert('Cannot access microphone');
        return false;
    }
}

export function stopLiveRecording() {
    if (liveMediaRecorder && isLiveRecording) {
        liveMediaRecorder.stop();
    }
}

export function disconnectLiveTranslation() {
    if (liveWs) {
        liveWs.close();
        liveWs = null;
    }
    if (liveMediaRecorder && isLiveRecording) {
        liveMediaRecorder.stop();
    }
}