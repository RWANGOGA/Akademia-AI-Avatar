import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ==========================================
// 1. SCENE, CAMERA, RENDERER, LIGHTING
// ==========================================
const scene = new THREE.Scene();
// No scene.background so the CSS gradients show through!
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.3, 3); 
// alpha: true makes the 3D canvas transparent
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Set initial size based on the left container, not the whole window
const container = document.getElementById('canvas-container');
renderer.setSize(container.clientWidth, container.clientHeight);
camera.aspect = container.clientWidth / container.clientHeight;
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

function initAudioContext() {
    if (isAudioSetup) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32; 
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isAudioSetup = true;
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
    document.getElementById('loading').style.display = 'none';
    updateCharacterVisuals('Tutor'); // Apply default background on load
});

// ==========================================
// 4. ANIMATION LOOP (3D LIP-SYNC + BLINKING)
// ==========================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = clock.getDelta();
  
  if (currentVrm && document.getElementById('canvas-container').style.display !== 'none') {
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
// 5. SEQUENTIAL AUDIO (WITH 2D JAW-BOB LIP-SYNC)
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
        
        isSpeaking = true;
        source.start(0);
        
        const faceImg = document.getElementById('uploaded-face');
        const faceContainer = document.getElementById('face-container');
        
        if (faceContainer.style.display === 'block' && faceImg.src) {
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
// 🧠 LOAD AVAILABLE MODELS FROM BACKEND
// ==========================================
async function loadModels() {
    try {
        const response = await fetch('http://localhost:8000/models');
        const data = await response.json();
        
        const modelSelect = document.getElementById('modelSelect');
        modelSelect.innerHTML = ''; // Clear existing options
        
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

// Call this when the page loads
loadModels();

// ==========================================
// 6. UI CONTROLS & CHAT LOGIC
// ==========================================
const speakBtn = document.getElementById('speakBtn');
const userInput = document.getElementById('userInput');
const chatContainer = document.getElementById('chat-container'); // The scrollable chat box
const uploadBtn = document.getElementById('uploadBtn');
const audioFileInput = document.getElementById('audioFile');
const personaSelect = document.getElementById('personaSelect');
const modelSelect = document.getElementById('modelSelect');

// Helper to scroll chat to the bottom
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function updateCharacterVisuals(persona) {
    const aura = document.getElementById('face-aura');
    const badge = document.getElementById('mode-badge');
    const body = document.body;

    body.classList.remove('bg-tutor', 'bg-business', 'bg-casual');

    if (persona === 'Tutor') {
        body.classList.add('bg-tutor');
        if(aura) aura.style.background = 'rgba(255, 193, 7, 0.5)'; 
        if(badge) badge.innerText = '📚';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0.8); 
    } else if (persona === 'Business') {
        body.classList.add('bg-business');
        if(aura) aura.style.background = 'rgba(0, 123, 255, 0.5)'; 
        if(badge) badge.innerText = '💼';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0); 
    } else { 
        body.classList.add('bg-casual');
        if(aura) aura.style.background = 'rgba(255, 0, 128, 0.5)'; 
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

    // 1. IMMEDIATELY SHOW USER'S QUESTION ON THE RIGHT
    const userMsg = document.createElement('div');
    userMsg.className = 'msg-user';
    userMsg.innerText = text;
    chatContainer.appendChild(userMsg);
    scrollToBottom();

    speakBtn.innerText = "Thinking...";
    speakBtn.disabled = true;
    userInput.value = ""; // Clear input

    try {
      // 👇 FIX: We define BOTH variables right here 👇
      const selectedPersona = personaSelect.value;
      const selectedModel = modelSelect.value; 
      // 👆 FIX 👆

      updateCharacterVisuals(selectedPersona); 

      const response = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            text, 
            persona: selectedPersona, 
            model_id: selectedModel // Now it knows what selectedModel is!
        })
      });
      
      const data = await response.json();
      
      // 2. SHOW AVATAR'S ANSWER ON THE LEFT
      const avatarMsg = document.createElement('div');
      avatarMsg.className = 'msg-avatar';
      avatarMsg.innerHTML = `<div class="text-en">🇬🇧 ${data.text_en}</div><div class="text-ja">🇯🇵 ${data.text_ja}</div>`;
      chatContainer.appendChild(avatarMsg);
      scrollToBottom();

      speakBtn.innerText = "🔊 Speaking English...";
      await playAudioSequentially(data.audio_url_en); 
      
      speakBtn.innerText = "🔊 Speaking Japanese...";
      await playAudioSequentially(data.audio_url_ja); 
      
      speakBtn.innerText = "Send";
      speakBtn.disabled = false;

    } catch (error) {
      console.error("❌ Error:", error);
      speakBtn.innerText = "Error!";
      speakBtn.disabled = false;
    }
});

// Audio Upload Logic
audioFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    uploadBtn.innerText = "⏳"; uploadBtn.disabled = true;
    const formData = new FormData();
    formData.append('audio', file);
    try {
        const response = await fetch('http://localhost:8000/transcribe', { method: 'POST', body: formData });
        const data = await response.json();
        userInput.value = data.text;
    } catch (error) { console.error("❌ Transcription error:", error); }
    finally { uploadBtn.innerText = "📁"; uploadBtn.disabled = false; audioFileInput.value = ""; }
});

// ==========================================
// 7. 2D IMAGE UPLOAD & MODE TOGGLE
// ==========================================
const imageFileInput = document.getElementById('imageFile');
const faceContainer = document.getElementById('face-container');
const canvasContainer = document.getElementById('canvas-container');
const mode3dBtn = document.getElementById('mode3dBtn');
const mode2dBtn = document.getElementById('mode2dBtn');

imageFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('uploaded-face').src = e.target.result;
            mode2dBtn.click(); 
        };
        reader.readAsDataURL(file);
    }
});

mode3dBtn.addEventListener('click', () => {
    canvasContainer.style.display = 'block';
    faceContainer.style.display = 'none';
    mode3dBtn.style.backgroundColor = '#007bff';
    mode2dBtn.style.backgroundColor = '#6c757d';
});

mode2dBtn.addEventListener('click', () => {
    if (!document.getElementById('uploaded-face').src) {
        alert("Please upload an image first using the 🖼️ button!");
        return;
    }
    canvasContainer.style.display = 'none';
    faceContainer.style.display = 'block';
    mode2dBtn.style.backgroundColor = '#007bff';
    mode3dBtn.style.backgroundColor = '#6c757d';
});
// ==========================================
// 🌉 LIVE INTERVIEW: WEBSOCKET CLIENT
// ==========================================
// Connect to the backend tunnel. (We are User #1 for now)
const ws = new WebSocket('ws://localhost:8000/interview_room/1');

ws.onopen = () => {
    console.log("✅ SUCCESS: Connected to the Live Interview Room!");
};

ws.onmessage = async (event) => {
    try {
        // Try to parse it as JSON (AI Response)
        const data = JSON.parse(event.data);
        
        if (data.type === "ai_response") {
            console.log("🧠 AI Response Received:", data.text);
            
            // Create a chat bubble for the translation
            const avatarMsg = document.createElement('div');
            avatarMsg.className = 'msg-avatar';
            avatarMsg.innerHTML = `<div class="text-en">🇬🇧 ${data.text}</div>`;
            chatContainer.appendChild(avatarMsg);
            scrollToBottom();
            
            // Play the audio and trigger lip-sync!
            await playAudioSequentially(data.audio_url);
        }
    } catch (e) {
        // If it's not JSON, it's just a regular text message
        console.log(" Received from Interview Room:", event.data);
    }
};
ws.onclose = () => {
    console.log("❌ Disconnected from Interview Room.");
    
    // 🛡️ FIX: If the connection drops, immediately stop the microphone to prevent spam errors
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        console.log("🛑 Microphone stopped automatically due to disconnection.");
    }
    
    // Reset the button UI
    micBtn.innerText = "🎙️ Start Interview";
    micBtn.style.backgroundColor = "#28a745";
};



// ==========================================
// 🎤 SPRINT 2: MICROPHONE AUDIO CHUNKING
// ==========================================
const micBtn = document.getElementById('micBtn');
let mediaRecorder;
let audioChunks = [];

micBtn.addEventListener('click', async () => {
    // If the button says "Start", begin recording
    if (micBtn.innerText.includes('Start')) {
        try {
            // 1. Ask the browser for microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            audioChunks = [];

            // 2. Collect the audio data as it records
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };

            // 3. Every 4 seconds, stop and restart to create a "chunk"
            const chunkInterval = setInterval(() => {
                if (mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    mediaRecorder.start(); // Restart immediately for the next chunk
                }
            }, 4000); // 4000ms = 4 seconds

            // 4. When a chunk stops, send it through the WebSocket!
                        mediaRecorder.onstop = () => {
                if (audioChunks.length > 0) {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    
                    // 🛡️ FIX: Only send if the WebSocket is actually open!
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(blob); 
                        console.log("🎤 Sent 4-second audio chunk to backend!");
                    } else {
                        console.warn("⚠️ WebSocket is closed. Dropping audio chunk.");
                    }
                    
                    audioChunks = []; 
                }
            };

            // Start the recording!
            mediaRecorder.start();
            micBtn.innerText = "🛑 Stop Interview";
            micBtn.style.backgroundColor = "#dc3545"; // Turn button red
            console.log("🎙️ Recording started. Sending chunks every 4 seconds...");

        } catch (err) {
            console.error("❌ Microphone access denied:", err);
            alert("Please allow microphone access to start the interview.");
        }
        
    } else {
        // If the button says "Stop", end the recording
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop()); // Release the mic
        }
        micBtn.innerText = "🎙️ Start Interview";
        micBtn.style.backgroundColor = "#28a745"; // Turn button green
        console.log("🛑 Recording stopped.");
    }
});