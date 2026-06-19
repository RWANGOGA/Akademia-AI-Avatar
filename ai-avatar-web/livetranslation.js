// ==========================================
// 🌐 LIVE TRANSLATION MODULE
// Handles the Zoom-style two-device live interpreter feature.
// Completely separate from the Avatar Chat websocket/logic.
// ==========================================

let liveWs = null;
let liveMediaRecorder = null;
let liveAudioChunks = [];
let isLiveRecording = false;

// Read role + room from the URL, e.g.:
//   index.html?role=interviewer&room=room1   (HR's device)
//   index.html?role=candidate&room=room1     (Candidate's device)
const urlParams = new URLSearchParams(window.location.search);
const MY_ROLE = urlParams.get('role') || 'interviewer';
const ROOM_ID = urlParams.get('room') || 'room1';

export function getMyRole() {
    return MY_ROLE;
}

export function getRoomId() {
    return ROOM_ID;
}

// ------------------------------------------
// Connect to the backend live_translation websocket
// ------------------------------------------
export function connectLiveTranslation() {
    if (liveWs && (liveWs.readyState === WebSocket.OPEN || liveWs.readyState === WebSocket.CONNECTING)) {
        return; // already connected / connecting
    }

    liveWs = new WebSocket(`ws://localhost:8000/live_translation/${ROOM_ID}/${MY_ROLE}`);

    liveWs.onopen = () => {
        console.log(`✅ Live translation connected — room "${ROOM_ID}" as "${MY_ROLE}"`);
    };

    liveWs.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);

            if (data.type === "translation") {
                // Speech FROM the other participant, translated FOR me
                updateTranslationPanel(data.from_role, data.original_text, data.translated_text);
                await playTranslatedAudio(data.audio_url);
            }

            if (data.type === "own_transcript") {
                // My own speech, echoed back as a caption on my own panel
                updateOwnCaption(data.original_text);
            }
        } catch (e) {
            console.log("Live translation message (non-JSON):", event.data);
        }
    };

    liveWs.onclose = () => {
        console.log("❌ Live translation socket closed");
    };

    liveWs.onerror = (err) => {
        console.error("❌ Live translation socket error:", err);
    };
}

export function disconnectLiveTranslation() {
    if (liveWs) {
        liveWs.close();
        liveWs = null;
    }
}

// ------------------------------------------
// UI updates — uses the existing #hrTranslation / #candidateTranslation panels
// ------------------------------------------
function updateTranslationPanel(fromRole, originalText, translatedText) {
    // The panel showing the OTHER person's speech (translated for me)
    const panelId = fromRole === "interviewer" ? "hrTranslation" : "candidateTranslation";
    const panel = document.getElementById(panelId);
    if (!panel) return;

    const origEl = panel.querySelector('.original-text');
    const transEl = panel.querySelector('.translated-text');
    if (origEl) origEl.textContent = originalText;
    if (transEl) transEl.textContent = translatedText;
}

function updateOwnCaption(originalText) {
    const myPanelId = MY_ROLE === "interviewer" ? "hrTranslation" : "candidateTranslation";
    const panel = document.getElementById(myPanelId);
    if (!panel) return;

    const origEl = panel.querySelector('.original-text');
    if (origEl) origEl.textContent = originalText;
}

// ------------------------------------------
// Audio playback for translated speech
// ------------------------------------------
async function playTranslatedAudio(url) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
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
// Microphone recording — records until stopped, sends full blob (pause-based)
// ------------------------------------------
export async function startLiveRecording() {
    if (isLiveRecording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support microphone access.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });

        liveAudioChunks = [];
        liveMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

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

            if (liveWs && liveWs.readyState === WebSocket.OPEN) {
                liveWs.send(blob);
                console.log(`🚀 Sent live audio (${blob.size} bytes) as "${MY_ROLE}"`);
            } else {
                console.warn("⚠️ Live translation socket not open — audio not sent.");
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

export function isCurrentlyRecording() {
    return isLiveRecording;
}