import './style.css';

import {
    connectLiveTranslation,
    disconnectLiveTranslation,
    startListening,
    stopListening,
    isCurrentlyListening,
    hasJoinedRoom,
    getMyIdentity
} from './livetranslation.js';

import {
    initAvatarScene,
    updateCharacterVisuals,
    switchTo3DMode,
    switchTo2DMode
} from './avatarManager.js';

import {
    sendMessage,
    startRecording,
    stopRecording,
    isRecording,
} from './avatarChat.js';

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing AI Avatar...');
    initAvatarScene();
});

// ==========================================
// MODE SWITCHING
// ==========================================
const avatarModeBtn = document.getElementById('avatarModeBtn');
const liveModeBtn = document.getElementById('liveModeBtn');
const avatarMode = document.getElementById('avatarMode');
const liveMode = document.getElementById('liveMode');
const oldModeToggle = document.querySelector('.mode-toggle');

avatarModeBtn.addEventListener('click', () => {
    avatarModeBtn.classList.add('active');
    liveModeBtn.classList.remove('active');
    avatarMode.classList.add('active');
    liveMode.classList.remove('active');
    if (oldModeToggle) oldModeToggle.classList.remove('hidden');
    console.log('🤖 Switched to Avatar Chat Mode');
});

liveModeBtn.addEventListener('click', async () => {
    liveModeBtn.classList.add('active');
    avatarModeBtn.classList.remove('active');
    liveMode.classList.add('active');
    avatarMode.classList.remove('active');
    if (oldModeToggle) oldModeToggle.classList.add('hidden');
    console.log('📹 Switched to Live Communication Mode');

    // Initialize camera when entering Live mode
    if (!localStream) {
        await initializeLiveMode();
    }

    if (!hasJoinedRoom()) {
        showJoinScreen();
    }
});

// ==========================================
// JOIN SCREEN
// ==========================================
const joinScreenOverlay = document.getElementById('joinScreenOverlay');
const joinNameInput = document.getElementById('joinNameInput');
const joinTitleInput = document.getElementById('joinTitleInput');
const joinLanguageSelect = document.getElementById('joinLanguageSelect');
const joinRoomBtn = document.getElementById('joinRoomBtn');

function showJoinScreen() {
    if (joinScreenOverlay) joinScreenOverlay.classList.remove('hidden');
}

function hideJoinScreen() {
    if (joinScreenOverlay) joinScreenOverlay.classList.add('hidden');
}

if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', () => {
        const name = (joinNameInput?.value || '').trim();
        const title = (joinTitleInput?.value || '').trim();
        const language = joinLanguageSelect?.value || 'English';

        if (!name) {
            alert('Please enter your name to join.');
            return;
        }

        connectLiveTranslation({ name, title, language });
        hideJoinScreen();

        const myLabel = document.getElementById('myPanelLabel');
        if (myLabel) myLabel.innerText = title ? `${name} (${title})` : name;

        const myAvatar = document.getElementById('myAvatar');
        if (myAvatar) myAvatar.innerText = '🙂';

        const startTranslationBtn = document.getElementById('startTranslationBtn');
        if (startTranslationBtn) startTranslationBtn.disabled = false;
    });
}

window.addEventListener('live-translation-roster', (event) => {
    const participants = event.detail || [];
    const me = getMyIdentity();
    const others = participants.filter(p => p.name !== me.name || p.language !== me.language);

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
});

// ==========================================
// LIVE MODE — CAMERA INITIALIZATION
// ==========================================
let localStream = null;
let isMicMuted = false;
let isCamOff = false;

async function initializeLiveMode() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Camera not supported in this browser.');
        }

        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });

        const localVideo = document.getElementById('localVideo');
        const myPlaceholder = document.getElementById('myPlaceholder');

        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.onloadedmetadata = () => {
                localVideo.play();
                localVideo.style.display = 'block';
                if (myPlaceholder) myPlaceholder.style.display = 'none';
            };
        }
        console.log('✅ Camera initialized');
    } catch (error) {
        console.error('❌ Camera error:', error);
        alert('📹 Camera access denied or not available.');
    }
}

// ==========================================
// LIVE MODE CONTROLS
// ==========================================
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCamBtn = document.getElementById('toggleCamBtn');
const startTranslationBtn = document.getElementById('startTranslationBtn');
const endCallBtn = document.getElementById('endCallBtn');

toggleMicBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMicMuted = !isMicMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isMicMuted);
    toggleMicBtn.innerText = isMicMuted ? '🎤 Unmute' : '🎤 Mute';
});

toggleCamBtn.addEventListener('click', () => {
    if (!localStream) return;
    isCamOff = !isCamOff;
    localStream.getVideoTracks().forEach(track => track.enabled = !isCamOff);
    toggleCamBtn.innerText = isCamOff ? '📹 Turn On Camera' : '📹 Turn Off Camera';

    const localVideo = document.getElementById('localVideo');
    const myPlaceholder = document.getElementById('myPlaceholder');
    if (localVideo && myPlaceholder) {
        localVideo.style.display = isCamOff ? 'none' : 'block';
        myPlaceholder.style.display = isCamOff ? 'flex' : 'none';
    }
});

endCallBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    const localVideo = document.getElementById('localVideo');
    if (localVideo) localVideo.srcObject = null;

    const myPlaceholder = document.getElementById('myPlaceholder');
    if (myPlaceholder) myPlaceholder.style.display = 'flex';
    if (localVideo) localVideo.style.display = 'none';

    if (startTranslationBtn) {
        startTranslationBtn.innerText = '🌐 Not connected';
        startTranslationBtn.classList.remove('active');
        startTranslationBtn.disabled = true;
    }

    disconnectLiveTranslation();
    avatarModeBtn.click();
});

// ==========================================
// AVATAR CHAT CONTROLS
// ==========================================
const speakBtn = document.getElementById('speakBtn');
const userInput = document.getElementById('userInput');
const personaSelect = document.getElementById('personaSelect');
const recordBtn = document.getElementById('recordBtn');

speakBtn.addEventListener('click', async () => {
    const text = userInput.value.trim();
    if (!text) return;

    const selectedPersona = personaSelect.value;
    updateCharacterVisuals(selectedPersona);
    userInput.value = '';

    await sendMessage(text, selectedPersona);
});

personaSelect.addEventListener('change', (e) => {
    updateCharacterVisuals(e.target.value);
});

if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
        if (!avatarMode.classList.contains('active')) return;
        if (isRecording()) {
            stopRecording();
        } else {
            await startRecording();
        }
    });
}

// ==========================================
// 2D IMAGE UPLOAD & MODE TOGGLE
// ==========================================
const imageUploadBtn = document.getElementById('imageUploadBtn');
const imageFileInput = document.getElementById('imageFile');
const mode3dBtn = document.getElementById('mode3dBtn');
const mode2dBtn = document.getElementById('mode2dBtn');

imageUploadBtn.addEventListener('click', () => imageFileInput.click());

imageFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('❌ Please select a valid image file');
        imageFileInput.value = '';
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        alert('❌ Image too large (max 5MB)');
        imageFileInput.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('uploaded-face').src = e.target.result;
        mode2dBtn.click();
    };
    reader.readAsDataURL(file);
});

mode3dBtn.addEventListener('click', () => switchTo3DMode());
mode2dBtn.addEventListener('click', () => switchTo2DMode());

// ==========================================
// LIVE MODE — MIC BUTTON (continuous listening)
// ==========================================
const micBtn = document.getElementById('micBtn');

if (micBtn) {
    micBtn.addEventListener('click', async () => {
        if (!isCurrentlyListening()) {
            const success = await startListening();
            if (success) {
                micBtn.innerText = '🛑 Stop Listening';
                micBtn.classList.add('danger');
                micBtn.classList.remove('primary');
            }
        } else {
            stopListening();
            micBtn.innerText = '🎙️ Start Speaking';
            micBtn.classList.add('primary');
            micBtn.classList.remove('danger');
        }
    });
}