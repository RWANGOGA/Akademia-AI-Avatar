import { setAudioAnalyzer, setSpeakingState, animate2DFace } from './avatarManager.js';

// ==========================================
// AVATAR CHAT MODULE
// Handles text/voice chat, audio recording, and playback
// ==========================================

const SESSION_ID = (() => {
    const existing = sessionStorage.getItem('avatar_session_id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem('avatar_session_id', fresh);
    return fresh;
})();

let audioContext = null;
let analyser = null;
let isAudioSetup = false;

let avatarMediaRecorder = null;
let avatarAudioChunks = [];
let isAvatarRecording = false;

// ==========================================
// INITIALIZE AUDIO CONTEXT
// ==========================================
function initAudioContext() {
    if (isAudioSetup) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32;
    isAudioSetup = true;
    setAudioAnalyzer(analyser);
}

// ==========================================
// SEND TEXT MESSAGE
// ==========================================
export async function sendMessage(text, persona) {
    const chatContainer = document.getElementById('chat-container');
    const speakBtn = document.getElementById('speakBtn');

    initAudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const userMsg = document.createElement('div');
    userMsg.className = 'msg-user';
    userMsg.innerText = text;
    chatContainer.appendChild(userMsg);
    scrollToBottom();

    speakBtn.innerText = "Thinking...";
    speakBtn.disabled = true;

    try {
        const response = await fetch('http://localhost:8000/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, persona, session_id: SESSION_ID })
        });

        const data = await response.json();

        const avatarMsg = document.createElement('div');
        avatarMsg.className = 'msg-avatar';
        avatarMsg.innerHTML = `<div class="text-en">🇬🇧 ${data.text_en}</div><div class="text-ja">🇯 ${data.text_ja}</div>`;
        chatContainer.appendChild(avatarMsg);
        scrollToBottom();

        speakBtn.innerText = "🔊 Speaking...";
        await playAudioSequentially(data.audio_url_en);
        await playAudioSequentially(data.audio_url_ja);

        speakBtn.innerText = "Send";
        speakBtn.disabled = false;

    } catch (error) {
        console.error("❌ Error:", error);
        speakBtn.innerText = "Error!";
        speakBtn.disabled = false;
    }
}

// ==========================================
// RECORD VOICE MESSAGE
// ==========================================
export async function startRecording() {
    if (isAvatarRecording) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support microphone access.');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });

        avatarAudioChunks = [];
        avatarMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

        avatarMediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                avatarAudioChunks.push(event.data);
            }
        };

        avatarMediaRecorder.onstop = async () => {
            stream.getTracks().forEach((track) => track.stop());
            isAvatarRecording = false;
            if (avatarAudioChunks.length === 0) return;
            const blob = new Blob(avatarAudioChunks, { type: 'audio/webm;codecs=opus' });
            await submitAvatarAudio(blob);
        };

        avatarMediaRecorder.start();
        isAvatarRecording = true;

        const recordBtn = document.getElementById('recordBtn');
        recordBtn.classList.add('recording');
        recordBtn.innerText = '⏹️ Stop';

    } catch (error) {
        console.error('❌ Failed to start recording:', error);
        alert('Unable to access microphone. Please allow microphone permission.');
    }
}

export function stopRecording() {
    if (avatarMediaRecorder && isAvatarRecording) {
        avatarMediaRecorder.stop();
        const recordBtn = document.getElementById('recordBtn');
        recordBtn.classList.remove('recording');
        recordBtn.innerText = '🎙️';
    }
}

export function isRecording() {
    return isAvatarRecording;
}

// ==========================================
// SUBMIT VOICE TO BACKEND
// ==========================================
async function submitAvatarAudio(blob) {
    const chatContainer = document.getElementById('chat-container');
    const recordBtn = document.getElementById('recordBtn');
    const personaSelect = document.getElementById('personaSelect');

    const userVoiceMsg = document.createElement('div');
    userVoiceMsg.className = 'msg-user';
    userVoiceMsg.innerText = '🎙️ Voice message recorded. Processing...';
    chatContainer.appendChild(userVoiceMsg);
    scrollToBottom();

    const formData = new FormData();
    formData.append('audio', blob, 'avatar_voice.webm');
    formData.append('persona', personaSelect?.value || 'Tutor');
    formData.append('session_id', SESSION_ID);
    // model_id removed — model is fixed in backend config

    try {
        const response = await fetch('http://localhost:8000/ask_audio', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        if (data.transcribed_text) {
            const voiceTextMsg = document.createElement('div');
            voiceTextMsg.className = 'msg-user';
            voiceTextMsg.innerText = `🎤 ${data.transcribed_text}`;
            chatContainer.appendChild(voiceTextMsg);
            scrollToBottom();
        }

        const avatarMsg = document.createElement('div');
        avatarMsg.className = 'msg-avatar';
        avatarMsg.innerHTML = `<div class="text-en">🇬🇧 ${data.text_en}</div><div class="text-ja">🇯 ${data.text_ja}</div>`;
        chatContainer.appendChild(avatarMsg);
        scrollToBottom();

        initAudioContext();
        if (audioContext.state === 'suspended') await audioContext.resume();
        await playAudioSequentially(data.audio_url_en);
        await playAudioSequentially(data.audio_url_ja);

    } catch (error) {
        console.error('❌ Audio submit failed:', error);
        alert('Failed to process voice input.');
    } finally {
        recordBtn.innerText = '🎙️';
        recordBtn.classList.remove('recording');
    }
}

// ==========================================
// AUDIO PLAYBACK
// ==========================================
async function playAudioSequentially(url) {
    const audioResponse = await fetch(url + "?t=" + new Date().getTime());
    const arrayBuffer = await audioResponse.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return new Promise((resolve) => {
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        setSpeakingState(true);
        source.start(0);
        animate2DFace(analyser);

        source.onended = () => {
            setSpeakingState(false);
            resolve();
        };
    });
}

function scrollToBottom() {
    const chatContainer = document.getElementById('chat-container');
    chatContainer.scrollTop = chatContainer.scrollHeight;
}