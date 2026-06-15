import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ==========================================
// 1. SCENE, CAMERA, RENDERER, LIGHTING
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.3, 3); 
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

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
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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
        
        // --- 2D IMAGE "JAW-BOB" LIP-SYNC EFFECT ---
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
                
                // Map audio to a "jaw drop" effect (translating Y and scaling slightly)
                const jawDrop = (avg / 255) * 15; // Pixels to drop the jaw
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
// 6. UI CONTROLS, PERSONAS & CHARACTER MODES
// ==========================================
const speakBtn = document.getElementById('speakBtn');
const userInput = document.getElementById('userInput');
const responseArea = document.getElementById('responseArea');
const textEn = document.getElementById('textEn');
const textJa = document.getElementById('textJa');
const uploadBtn = document.getElementById('uploadBtn');
const audioFileInput = document.getElementById('audioFile');
const personaSelect = document.getElementById('personaSelect');

// Function to update the "Character" visuals based on the Persona
function updateCharacterVisuals(persona) {
    const aura = document.getElementById('face-aura');
    const badge = document.getElementById('mode-badge');
    
    if (persona === 'Tutor') {
        if(aura) aura.style.background = 'rgba(255, 193, 7, 0.5)'; // Warm Yellow Aura
        if(badge) badge.innerText = '📚';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0.8); // 3D smiles gently
    } else if (persona === 'Business') {
        if(aura) aura.style.background = 'rgba(0, 123, 255, 0.5)'; // Sharp Blue Aura
        if(badge) badge.innerText = '💼';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0); // 3D looks serious
    } else { // Casual
        if(aura) aura.style.background = 'rgba(255, 0, 128, 0.5)'; // Fun Pink Aura
        if(badge) badge.innerText = '😎';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 1.0); // 3D smiles huge
    }
}

// Listen for Persona changes to update visuals immediately
personaSelect.addEventListener('change', (e) => {
    updateCharacterVisuals(e.target.value);
});

speakBtn.addEventListener('click', async () => {
    const text = userInput.value.trim();
    if (!text) return;

    initAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();

    speakBtn.innerText = "Thinking...";
    speakBtn.disabled = true;
    responseArea.style.display = 'none'; 

    try {
      const selectedPersona = personaSelect.value;
      updateCharacterVisuals(selectedPersona); // Apply character mode before speaking

      const response = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona: selectedPersona })
      });
      
      const data = await response.json();
      textEn.innerText = "🇬🇧 " + data.text_en;
      textJa.innerText = "🇯🇵 " + data.text_ja;
      responseArea.style.display = 'block';

      speakBtn.innerText = "🔊 Speaking English...";
      await playAudioSequentially(data.audio_url_en); 
      
      speakBtn.innerText = "🔊 Speaking Japanese...";
      await playAudioSequentially(data.audio_url_ja); 
      
      speakBtn.innerText = "Ask & Speak";
      speakBtn.disabled = false;
      userInput.value = "";

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
            mode2dBtn.click(); // Auto-switch to 2D mode
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

// Initialize default character visual on load
updateCharacterVisuals('Tutor');