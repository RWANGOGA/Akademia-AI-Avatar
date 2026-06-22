import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import './style.css'; 
import {
    connectlivetranslation,
    disconnectlivetranslation,
    startListening,
    stopListening,
    isCurrentlyListening,
    hasJoinedRoom,
    getMyIdentity
} from './livetranslation.js';

// ==========================================
// 🆔 SESSION ID — isolates this browser tab's avatar chat history
// from every other user's, fixing the old shared-global-history bug.
// ==========================================
const SESSION_ID = (() => {
    const existing = sessionStorage.getItem('avatar_session_id');
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem('avatar_session_id', fresh);
    return fresh;
})();

// ==========================================
// 🔄 MODE SWITCHING LOGIC
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

    if (!localStream) {
        await initializeLiveMode();
    }

    if (!hasJoinedRoom()) {
        showJoinScreen();
    }
});

// ==========================================
// 🪪 JOIN SCREEN — each participant freely picks their own name, title,
// and language before entering the room, like a Zoom join screen.
// Nothing is pre-decided by a fixed "interviewer" or "candidate" role.
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

        connectlivetranslation({ name, title, language });
        hideJoinScreen();

        const myLabel = document.getElementById('myPanelLabel');
        if (myLabel) myLabel.innerText = title ? `${name} (${title})` : name;

        const myAvatar = document.getElementById('myAvatar');
        if (myAvatar) myAvatar.innerText = '🙂';
    });
}

// Update "their" panel label live as people join/leave the room
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
// 📹 LIVE MODE INITIALIZATION
// ==========================================
let localStream = null;
let isMicMuted = false;
let isCamOff = false;

async function initializeLiveMode() {
    try {
        console.log('📹 Requesting camera and microphone access...');
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support camera access.');
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
        alert('📹 Camera access denied or not available');
    }
}

// ==========================================
// 🎤 LIVE MODE CONTROLS
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

// startTranslationBtn no longer needs a manual click handler — its text
// is now driven automatically by liveTranslation.js based on real
// connection state (setConnectionStatus), not a fake toggle.

endCallBtn.addEventListener('click', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    document.getElementById('localVideo').srcObject = null;

    const myPlaceholder = document.getElementById('myPlaceholder');
    if (myPlaceholder) myPlaceholder.style.display = 'flex';
    document.getElementById('localVideo').style.display = 'none';

    startTranslationBtn.innerText = '🌐 Not connected';
    startTranslationBtn.classList.remove('active');
    startTranslationBtn.disabled = true;

    disconnectlivetranslation();

    avatarModeBtn.click();
});

// ==========================================
// 1. SCENE, CAMERA, RENDERER, LIGHTING
// ==========================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.3, 3); 
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);

document.getElementById('canvas-container').appendChild(renderer.domElement);

const canvasContainer = document.getElementById('canvas-container');
renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
camera.updateProjectionMatrix();

const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(1, 1, 1).normalize();
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// ==========================================
// 2. WEB AUDIO API SETUP
// ==========================================
let audioContext, analyser, dataArray;
let isAudioSetup = false, isSpeaking = false;
let avatarMediaRecorder = null;
let avatarAudioChunks = [];
let isAvatarRecording = false;

function initAudioContext() {
    if (isAudioSetup) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32; 
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isAudioSetup = true;
}

async function submitAvatarAudio(blob) {
    const userVoiceMsg = document.createElement('div');
    userVoiceMsg.className = 'msg-user';
    userVoiceMsg.innerText = '🎙️ Voice message recorded. Processing...';
    chatContainer.appendChild(userVoiceMsg);
    scrollToBottom();

    const formData = new FormData();
    formData.append('audio', blob, 'avatar_voice.webm');
    formData.append('persona', personaSelect.value || 'Tutor');
    formData.append('model_id', modelSelect.value || '');
    formData.append('session_id', SESSION_ID);

    try {
        const response = await fetch('http://localhost:8000/ask_audio', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

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
        console.error('❌ Avatar audio submit failed:', error);
        alert('Failed to process voice input.');
    } finally {
        recordBtn.innerText = '🎙️';
        recordBtn.classList.remove('recording');
    }
}

async function startAvatarRecording() {
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
            recordBtn.classList.remove('recording');
            recordBtn.innerText = '🎙️';

            if (avatarAudioChunks.length === 0) {
                return;
            }

            const blob = new Blob(avatarAudioChunks, { type: 'audio/webm;codecs=opus' });
            await submitAvatarAudio(blob);
        };

        avatarMediaRecorder.start();
        isAvatarRecording = true;
        recordBtn.classList.add('recording');
        recordBtn.innerText = '⏹️ Stop';
    } catch (error) {
        console.error('❌ Failed to start avatar recording:', error);
        alert('Unable to access microphone. Please allow microphone permission.');
    }
}

function stopAvatarRecording() {
    if (avatarMediaRecorder && isAvatarRecording) {
        avatarMediaRecorder.stop();
    }
}

// ==========================================
// 3. LOAD THE VRM AVATAR
// ==========================================
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
let currentVrm = null;

loader.load('/avatar.vrm', (gltf) => {
    const vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm);
    scene.add(vrm.scene);
    currentVrm = vrm;
    document.getElementById('loading').classList.add('hidden');
    updateCharacterVisuals('Tutor'); 
});

// ==========================================
// 4. ANIMATION LOOP
// ==========================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = clock.getDelta();
  
  if (currentVrm && !canvasContainer.classList.contains('hidden')) {
    currentVrm.update(deltaTime);
    
    if (!isSpeaking && Math.random() < 0.01) {
        currentVrm.expressionManager.setValue('blink', 1.0);
        setTimeout(() => { if(currentVrm) currentVrm.expressionManager.setValue('blink', 0); }, 150);
    }

    if (analyser && isSpeaking) {
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freqData);
        
        let lowSum = 0, highSum = 0;
        const lowRange = Math.floor(freqData.length * 0.2); 
        for (let i = 0; i < lowRange; i++) lowSum += freqData[i];
        for (let i = lowRange; i < freqData.length; i++) highSum += freqData[i];
        
        const lowAvg = lowSum / lowRange;
        const highAvg = highSum / (freqData.length - lowRange);

        currentVrm.expressionManager.setValue('aa', Math.min((lowAvg / 128) * 1.5, 1.0));
        currentVrm.expressionManager.setValue('ih', Math.min((highAvg / 128) * 1.2, 1.0));
    } else {
        currentVrm.expressionManager.setValue('aa', 0);
        currentVrm.expressionManager.setValue('ih', 0);
    }
  }
  
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const container = document.getElementById('canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

// ==========================================
// 5. AUDIO PLAYBACK
// ==========================================
async function playAudioSequentially(url) {
    const audioResponse = await fetch(url + "?t=" + new Date().getTime());
    const arrayBuffer = await audioResponse.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    return new Promise((resolve) => {
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser)          g;
        analyser.connect(audioContext.destination);
        
        isSpeaking = true;
        source.start(0);
        
        const faceImg = document.getElementById('uploaded-face');
        const faceContainer = document.getElementById('face-container');
        
        if (!faceContainer.classList.contains('hidden') && faceImg.src) {
            const animateFace = () => {
                if (!isSpeaking) {
                    faceImg.style.transform = 'scale(1) translateY(0)';
                    return;
                }
                const freqData = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(freqData);
                let sum = 0;
                for (let i = 0; i < freqData.length; i++) sum += freqData[i];
                const avg = sum / freqData.length;
                
                const jawDrop = (avg / 255) * 15; 
                const scale = 1 + (avg / 255) * 0.05; 
                faceImg.style.transform = `scale(${scale}) translateY(${jawDrop}px)`;
                requestAnimationFrame(animateFace);
            };
            animateFace();
        }
        
        source.onended = () => {
            isSpeaking = false;
            if(currentVrm) {
                currentVrm.expressionManager.setValue('aa', 0);
                currentVrm.expressionManager.setValue('ih', 0);
            }
            resolve(); 
        };
    });
}

// ==========================================
// 🧠 LOAD MODELS
// ==========================================
async function loadModels() {
    try {
        const response = await fetch('http://localhost:8000/models');
        const data = await response.json();
        
        const modelSelect = document.getElementById('modelSelect');
        modelSelect.innerHTML = ''; 
        
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.innerText = model.name;
            if (model.id === data.default) option.selected = true;
            modelSelect.appendChild(option);
        });
    } catch (error) {
        console.error("❌ Failed to load models:", error);
    }
}
loadModels();

// ==========================================
// 6. UI CONTROLS & CHAT LOGIC
// ==========================================
const speakBtn = document.getElementById('speakBtn');
const userInput = document.getElementById('userInput');
const chatContainer = document.getElementById('chat-container'); 
const imageUploadBtn = document.getElementById('imageUploadBtn');
const recordBtn = document.getElementById('recordBtn');
const personaSelect = document.getElementById('personaSelect');
const modelSelect = document.getElementById('modelSelect');

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function updateCharacterVisuals(persona) {
    const aura = document.getElementById('face-aura');
    const badge = document.getElementById('mode-badge');
    const body = document.body;

    body.classList.remove('bg-tutor', 'bg-business', 'bg-casual');
    if (aura) aura.classList.remove('aura-tutor', 'aura-business', 'aura-casual');

    if (persona === 'Tutor') {
        body.classList.add('bg-tutor');
        if(aura) aura.classList.add('aura-tutor');
        if(badge) badge.innerText = '📚';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0.8);
    } else if (persona === 'Business') {
        body.classList.add('bg-business');
        if(aura) aura.classList.add('aura-business');
        if(badge) badge.innerText = '💼';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0);
    } else {
        body.classList.add('bg-casual');
        if(aura) aura.classList.add('aura-casual');
        if(badge) badge.innerText = '😎';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 1.0);
    }
}    

personaSelect.addEventListener('change', (e) => {
    updateCharacterVisuals(e.target.value);
});

speakBtn.addEventListener('click', async () => {
    const text = userInput.value.trim();
    if (!text) return;

    initAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();

    const userMsg = document.createElement('div');
    userMsg.className = 'msg-user';
    userMsg.innerText = text;
    chatContainer.appendChild(userMsg);
    scrollToBottom();

    speakBtn.innerText = "Thinking...";
    speakBtn.disabled = true;
    userInput.value = ""; 

    try {
      const selectedPersona = personaSelect.value;
      const selectedModel = modelSelect.value; 

      updateCharacterVisuals(selectedPersona); 

      const response = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona: selectedPersona, model_id: selectedModel, session_id: SESSION_ID })
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
});

imageUploadBtn.addEventListener('click', () => imageFileInput.click());

if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
        if (!avatarMode.classList.contains('active')) return;
        if (isAvatarRecording) {
            stopAvatarRecording();
        } else {
            await startAvatarRecording();
        }
    });
}

// ==========================================
// 7. 2D IMAGE UPLOAD & MODE TOGGLE
// ==========================================
const imageFileInput = document.getElementById('imageFile');
const faceContainer = document.getElementById('face-container');
const mode3dBtn = document.getElementById('mode3dBtn');
const mode2dBtn = document.getElementById('mode2dBtn');

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

mode3dBtn.addEventListener('click', () => {
    canvasContainer.classList.remove('hidden');
    faceContainer.classList.add('hidden');
    mode3dBtn.classList.add('active');
    mode2dBtn.classList.remove('active');
});

mode2dBtn.addEventListener('click', () => {
    if (!document.getElementById('uploaded-face').src) {
        alert("Please upload an image first!");
        return;
    }
    canvasContainer.classList.add('hidden');
    faceContainer.classList.remove('hidden');
    mode2dBtn.classList.add('active');
    mode3dBtn.classList.remove('active');
});

// ==========================================
// 🎙️ LIVE MODE - START INTERVIEW BUTTON (now backed by liveTranslation.js)
// Toggles continuous listening with automatic silence-based sentence
// detection — no manual "stop" needed per sentence, only to end the
// session entirely.
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
            micBtn.innerText = '🎙️ Start Interview';
            micBtn.classList.add('primary');
            micBtn.classList.remove('danger');
        }
    });
}