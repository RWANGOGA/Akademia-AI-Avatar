import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ==========================================
// 1. SCENE, CAMERA, RENDERER, LIGHTING
// ==========================================
const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.3, 1.8);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
let isMuted = false;

function initAudioContext() {
    if (isAudioSetup) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    isAudioSetup = true;
}

// ==========================================
// 3. LOAD THE VRM AVATAR + BONE REFERENCES
// ==========================================
const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
let currentVrm = null;

let bones = {};

const REST_POSE = {
    leftUpperArm:  { x: 0,    y: 0,    z: 1.15  },
    rightUpperArm: { x: 0,    y: 0,    z: -1.15 },
    leftLowerArm:  { x: 0,    y: -0.2, z: 0     },
    rightLowerArm: { x: 0,    y: 0.2,  z: 0     },
    leftHand:      { x: 0,    y: 0,    z: 0     },
    rightHand:     { x: 0,    y: 0,    z: 0     },
    spine:         { x: 0,    y: 0,    z: 0     },
    chest:         { x: 0,    y: 0,    z: 0     },
    neck:          { x: 0,    y: 0,    z: 0     },
    head:          { x: 0,    y: 0,    z: 0     },
    hips:          { x: 0,    y: 0,    z: 0     },
    leftUpperLeg:  { x: 0,    y: 0,    z: 0.04  },
    rightUpperLeg: { x: 0,    y: 0,    z: -0.04 },
};

function getBone(humanoid, name) {
    return humanoid.getNormalizedBoneNode(name);
}

loader.load('/avatar.vrm', (gltf) => {
    const vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm);
    scene.add(vrm.scene);
    currentVrm = vrm;
    document.getElementById('loading').style.display = 'none';

    const humanoid = vrm.humanoid;
    bones = {
        leftUpperArm: getBone(humanoid, 'leftUpperArm'),
        rightUpperArm: getBone(humanoid, 'rightUpperArm'),
        leftLowerArm: getBone(humanoid, 'leftLowerArm'),
        rightLowerArm: getBone(humanoid, 'rightLowerArm'),
        leftHand: getBone(humanoid, 'leftHand'),
        rightHand: getBone(humanoid, 'rightHand'),
        spine: getBone(humanoid, 'spine'),
        chest: getBone(humanoid, 'chest'),
        neck: getBone(humanoid, 'neck'),
        head: getBone(humanoid, 'head'),
        hips: getBone(humanoid, 'hips'),
        leftUpperLeg: getBone(humanoid, 'leftUpperLeg'),
        rightUpperLeg: getBone(humanoid, 'rightUpperLeg'),
    };

    applyRestPose();
});

function applyRestPose() {
    for (const key in REST_POSE) {
        const bone = bones[key];
        if (!bone) continue;
        bone.rotation.x = REST_POSE[key].x;
        bone.rotation.y = REST_POSE[key].y;
        bone.rotation.z = REST_POSE[key].z;
    }
}

// ==========================================
// 4. CONTINUOUS BODY MOTION SYSTEM
// ==========================================
let elapsedTime = 0;

let idleGestureTimer = 0;
let currentGesture = null;
let gestureProgress = 0;
const GESTURE_DURATION = 2.4;

function pickRandomGesture() {
    const options = ['wave', 'touchHead', 'lookAround'];
    return options[Math.floor(Math.random() * options.length)];
}

function applyBreathing(t) {
    if (!bones.chest || !bones.spine) return;
    const breath = Math.sin(t * 1.1) * 0.025;
    bones.chest.rotation.x = REST_POSE.chest.x - breath;
    bones.spine.rotation.x = REST_POSE.spine.x - breath * 0.4;
}

function applyWeightShift(t) {
    if (!bones.hips) return;
    const sway = Math.sin(t * 0.35) * 0.04;
    bones.hips.rotation.z = REST_POSE.hips.z + sway;
    if (bones.spine) bones.spine.rotation.z = sway * 0.5;
}

function applyHeadIdleMotion(t) {
    if (!bones.head || !bones.neck) return;
    if (currentGesture === 'lookAround' || isSpeaking) return;
    const lookX = Math.sin(t * 0.25) * 0.06;
    const lookY = Math.cos(t * 0.18) * 0.03;
    bones.head.rotation.y = REST_POSE.head.y + lookX;
    bones.head.rotation.x = REST_POSE.head.x + lookY;
}

function applyIdleArmSway(t) {
    if (!bones.leftUpperArm || !bones.rightUpperArm) return;
    if (currentGesture === 'wave' || currentGesture === 'touchHead' || isSpeaking) return;
    const swayL = Math.sin(t * 0.5) * 0.03;
    const swayR = Math.sin(t * 0.5 + Math.PI) * 0.03;
    bones.leftUpperArm.rotation.x = swayL;
    bones.rightUpperArm.rotation.x = swayR;
}

function applyIdleGesture(deltaTime) {
    if (!bones.rightUpperArm || !bones.rightLowerArm || !bones.head) return;

    if (isSpeaking) {
        currentGesture = null;
        gestureProgress = 0;
        return;
    }

    idleGestureTimer += deltaTime;

    if (!currentGesture && idleGestureTimer > 6) {
        currentGesture = pickRandomGesture();
        gestureProgress = 0;
        idleGestureTimer = 0;
    }

    if (currentGesture) {
        gestureProgress += deltaTime;
        const t = Math.min(gestureProgress / GESTURE_DURATION, 1);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const swing = Math.sin(eased * Math.PI);

        if (currentGesture === 'wave') {
            bones.rightUpperArm.rotation.z = REST_POSE.rightUpperArm.z + swing * 1.6;
            bones.rightLowerArm.rotation.z = swing * 0.6 * Math.sin(gestureProgress * 8);
        } else if (currentGesture === 'touchHead') {
            bones.rightUpperArm.rotation.z = REST_POSE.rightUpperArm.z + swing * 2.0;
            bones.rightLowerArm.rotation.x = -swing * 1.6;
        } else if (currentGesture === 'lookAround') {
            bones.head.rotation.y = Math.sin(eased * Math.PI * 2) * 0.3;
        }

        if (t >= 1) {
            bones.rightUpperArm.rotation.z = REST_POSE.rightUpperArm.z;
            bones.rightLowerArm.rotation.x = 0;
            bones.rightLowerArm.rotation.z = 0;
            bones.head.rotation.y = REST_POSE.head.y;
            currentGesture = null;
            gestureProgress = 0;
        }
    }
}

function applyTalkingGestures(t) {
    if (!isSpeaking || !bones.leftUpperArm || !bones.rightUpperArm || !analyser) return;

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);
    let sum = 0;
    for (let i = 0; i < freqData.length; i++) sum += freqData[i];
    const avg = sum / freqData.length / 255;

    const gestureL = Math.sin(t * 3.2) * 0.18 * avg;
    const gestureR = Math.sin(t * 3.2 + 1.4) * 0.22 * avg;

    bones.leftUpperArm.rotation.x = gestureL;
    bones.rightUpperArm.rotation.x = gestureR;
    bones.leftLowerArm.rotation.x = -Math.abs(gestureL) * 0.6;
    bones.rightLowerArm.rotation.x = -Math.abs(gestureR) * 0.6;

    if (bones.head) {
        bones.head.rotation.y = REST_POSE.head.y + Math.sin(t * 1.6) * 0.08 * avg;
        bones.head.rotation.x = REST_POSE.head.x + Math.cos(t * 1.1) * 0.04 * avg;
    }
}

// ==========================================
// 5. ANIMATION LOOP
// ==========================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = clock.getDelta();
  elapsedTime += deltaTime;

  if (currentVrm && document.getElementById('canvas-container').style.display !== 'none') {
    currentVrm.update(deltaTime);

    if (!isSpeaking && Math.random() < 0.01) {
        currentVrm.expressionManager.setValue('blink', 1.0);
        setTimeout(() => { if(currentVrm) currentVrm.expressionManager.setValue('blink', 0); }, 150);
    }

    applyBreathing(elapsedTime);
    applyWeightShift(elapsedTime);
    applyHeadIdleMotion(elapsedTime);
    applyIdleArmSway(elapsedTime);
    applyIdleGesture(deltaTime);
    applyTalkingGestures(elapsedTime);

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
// 6. SEQUENTIAL AUDIO (WITH 2D JAW-BOB LIP-SYNC)
// ==========================================
async function playAudioSequentially(url) {
    if (isMuted) return Promise.resolve();

    const audioResponse = await fetch(url + "?t=" + new Date().getTime());
    const arrayBuffer = await audioResponse.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return new Promise((resolve) => {
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        isSpeaking = true;
        setSpeakingGlow(true);
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
            setSpeakingGlow(false);
            if (currentVrm) {
                currentVrm.expressionManager.setValue('aa', 0);
                currentVrm.expressionManager.setValue('ih', 0);
            }
            if (bones.leftUpperArm) bones.leftUpperArm.rotation.x = 0;
            if (bones.rightUpperArm) bones.rightUpperArm.rotation.x = 0;
            if (bones.leftLowerArm) bones.leftLowerArm.rotation.x = 0;
            if (bones.rightLowerArm) bones.rightLowerArm.rotation.x = 0;
            resolve();
        };
    });
}

// ==========================================
// 7. UI CONTROLS, PERSONAS & CHARACTER MODES
// ==========================================
const speakBtn = document.getElementById('speakBtn');
const userInput = document.getElementById('userInput');
const responseArea = document.getElementById('responseArea');
const textEn = document.getElementById('textEn');
const textJa = document.getElementById('textJa');
const uploadBtn = document.getElementById('uploadBtn');
const audioFileInput = document.getElementById('audioFile');
const imageFileInput = document.getElementById('imageFile');
const personaSelect = document.getElementById('personaSelect');

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');

function setStatus(label) {
    if (!statusPill || !statusText) return;
    if (label) {
        statusText.innerText = label;
        statusPill.classList.add('show');
    } else {
        statusPill.classList.remove('show');
    }
}

function setSpeakingGlow(active) {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    if (active) container.classList.add('speaking');
    else container.classList.remove('speaking');
}

function updateCharacterVisuals(persona) {
    const aura = document.getElementById('face-aura');
    const badge = document.getElementById('mode-badge');

    if (persona === 'Tutor') {
        if(aura) aura.style.background = 'rgba(255, 193, 7, 0.5)';
        if(badge) badge.innerText = '📚';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0.8);
    } else if (persona === 'Business') {
        if(aura) aura.style.background = 'rgba(0, 123, 255, 0.5)';
        if(badge) badge.innerText = '💼';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 0);
    } else {
        if(aura) aura.style.background = 'rgba(255, 0, 128, 0.5)';
        if(badge) badge.innerText = '😎';
        if(currentVrm) currentVrm.expressionManager.setValue('happy', 1.0);
    }
}

personaSelect.addEventListener('change', (e) => {
    updateCharacterVisuals(e.target.value);
});

// ==========================================
// UPLOAD MENU (paperclip popup: Gallery / Files / Audio)
// ==========================================
const uploadMenu = document.getElementById('uploadMenu');
const pickGalleryBtn = document.getElementById('pickGallery');
const pickFilesBtn = document.getElementById('pickFiles');
const pickAudioBtn = document.getElementById('pickAudio');

if (uploadBtn && uploadMenu) {
    uploadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
        if (!uploadMenu.contains(e.target) && e.target !== uploadBtn) {
            uploadMenu.classList.remove('show');
        }
    });

    if (pickGalleryBtn) {
        pickGalleryBtn.addEventListener('click', () => {
            imageFileInput.click();
            uploadMenu.classList.remove('show');
        });
    }

    if (pickFilesBtn) {
        pickFilesBtn.addEventListener('click', () => {
            imageFileInput.click();
            uploadMenu.classList.remove('show');
        });
    }

    if (pickAudioBtn) {
        pickAudioBtn.addEventListener('click', () => {
            audioFileInput.click();
            uploadMenu.classList.remove('show');
        });
    }
}

// ==========================================
// CONVERSATION HISTORY
// ==========================================
const historyList = document.getElementById('historyList');
const historyPanel = document.getElementById('historyPanel');
const historyToggle = document.getElementById('historyToggle');

function addToHistory(userText, enText, jaText) {
    if (!historyList) return;
    const entry = document.createElement('div');
    entry.className = 'history-entry';
    entry.innerHTML = `
        <div class="history-user">You: ${userText}</div>
        <div class="history-reply">🇬🇧 ${enText}</div>
        <div class="history-reply">🇯🇵 ${jaText}</div>
    `;
    historyList.appendChild(entry);
    historyPanel.scrollTop = historyPanel.scrollHeight;
}

if (historyToggle) {
    historyToggle.addEventListener('click', () => {
        historyPanel.classList.toggle('show');
    });
}

// ==========================================
// RESET BUTTON
// ==========================================
const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        if (historyList) historyList.innerHTML = '';
        textEn.innerText = '';
        textJa.innerText = '';
        responseArea.style.display = 'none';
        userInput.value = '';
        setStatus(null);
    });
}

// ==========================================
// MUTE BUTTON
// ==========================================
const muteBtn = document.getElementById('muteBtn');
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        const circle = muteBtn.querySelector('.icon-circle');
        if (circle) circle.innerText = isMuted ? '🔇' : '🔊';
    });
}

speakBtn.addEventListener('click', async () => {
    const text = userInput.value.trim();
    if (!text) return;

    initAudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();

    speakBtn.disabled = true;
    responseArea.style.display = 'none';
    setStatus('🤔 Thinking');

    try {
      const selectedPersona = personaSelect.value;
      updateCharacterVisuals(selectedPersona);

      const response = await fetch('http://localhost:8000/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, persona: selectedPersona })
      });

      const data = await response.json();
      textEn.innerText = "🇬🇧 " + data.text_en;
      textJa.innerText = "🇯🇵 " + data.text_ja;
      responseArea.style.display = 'block';

      addToHistory(text, data.text_en, data.text_ja);

      setStatus('🔊 Speaking English');
      await playAudioSequentially(data.audio_url_en);

      setStatus('🔊 Speaking Japanese');
      await playAudioSequentially(data.audio_url_ja);

      speakBtn.disabled = false;
      userInput.value = "";
      setStatus(null);

    } catch (error) {
      console.error("❌ Error:", error);
      speakBtn.disabled = false;
      setStatus(null);
    }
});

audioFileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    uploadBtn.disabled = true;
    setStatus('🎤 Transcribing');
    const formData = new FormData();
    formData.append('audio', file);
    try {
        const response = await fetch('http://localhost:8000/transcribe', { method: 'POST', body: formData });
        const data = await response.json();
        userInput.value = data.text;
    } catch (error) { console.error("❌ Transcription error:", error); }
    finally {
        uploadBtn.disabled = false; audioFileInput.value = "";
        setStatus(null);
    }
});

// ==========================================
// LIVE MIC RECORDING
// ==========================================
const micBtn = document.getElementById('micBtn');
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

if (micBtn) {
    micBtn.addEventListener('click', async () => {
        const circle = micBtn.querySelector('.icon-circle');
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);

                mediaRecorder.onstop = async () => {
                    const blob = new Blob(audioChunks, { type: 'audio/webm' });
                    const formData = new FormData();
                    formData.append('audio', blob, 'recording.webm');

                    setStatus('🎤 Transcribing');
                    try {
                        const response = await fetch('http://localhost:8000/transcribe', { method: 'POST', body: formData });
                        const data = await response.json();
                        userInput.value = data.text;
                    } catch (error) {
                        console.error("❌ Mic transcription error:", error);
                    } finally {
                        setStatus(null);
                    }
                };

                mediaRecorder.start();
                isRecording = true;
                if (circle) circle.classList.add('recording');
                setStatus('🎤 Listening');
            } catch (err) {
                console.error("❌ Microphone access error:", err);
                alert("Could not access microphone. Please check browser permissions.");
            }
        } else {
            if (mediaRecorder) mediaRecorder.stop();
            isRecording = false;
            if (circle) circle.classList.remove('recording');
        }
    });
}

// ==========================================
// 8. 2D IMAGE UPLOAD & MODE TOGGLE
// ==========================================
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
        imageFileInput.value = "";
    }
});

mode3dBtn.addEventListener('click', () => {
    canvasContainer.style.display = 'block';
    faceContainer.style.display = 'none';
    mode3dBtn.style.backgroundColor = '#c9a876';
    mode3dBtn.style.color = '#1a1a1a';
    mode2dBtn.style.backgroundColor = '#2a3050';
    mode2dBtn.style.color = '#aab2cf';
});

mode2dBtn.addEventListener('click', () => {
    if (!document.getElementById('uploaded-face').src) {
        alert("Please upload an image first using the Upload button!");
        return;
    }
    canvasContainer.style.display = 'none';
    faceContainer.style.display = 'block';
    mode2dBtn.style.backgroundColor = '#c9a876';
    mode2dBtn.style.color = '#1a1a1a';
    mode3dBtn.style.backgroundColor = '#2a3050';
    mode3dBtn.style.color = '#aab2cf';
});

updateCharacterVisuals('Tutor');