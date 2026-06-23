import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ==========================================
// 🎭 AVATAR MANAGER MODULE
// Handles 3D avatar loading, animation, and 2D/3D mode switching
// ==========================================

let scene, camera, renderer;
let currentVrm = null;
let canvasContainer;
let clock;

// Audio analysis for lip sync
let analyser;
let isSpeaking = false;

// ==========================================
// 🎬 INITIALIZE 3D SCENE
// ==========================================
export function initAvatarScene() {
    canvasContainer = document.getElementById('canvas-container');
    
    // Scene setup
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.1, 20);
    camera.position.set(0, 1.3, 3);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    canvasContainer.appendChild(renderer.domElement);
    renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    
    // Lighting
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(1, 1, 1).normalize();
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    
    clock = new THREE.Clock();
    
    // Load avatar
    loadVRMAvatar();
    
    // Start animation loop
    animate();
    
    // Handle resize
    window.addEventListener('resize', handleResize);
}

// ==========================================
// 🎭 LOAD VRM AVATAR
// ==========================================
function loadVRMAvatar() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    
    loader.load('/avatar.vrm', (gltf) => {
        const vrm = gltf.userData.vrm;
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);
        currentVrm = vrm;
        
        document.getElementById('loading').classList.add('hidden');
        updateCharacterVisuals('Tutor');
    });
}

// ==========================================
// 🔄 ANIMATION LOOP
// ==========================================
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();
    
    if (currentVrm && !canvasContainer.classList.contains('hidden')) {
        currentVrm.update(deltaTime);
        
        // Random blinking
        if (!isSpeaking && Math.random() < 0.01) {
            currentVrm.expressionManager.setValue('blink', 1.0);
            setTimeout(() => {
                if (currentVrm) currentVrm.expressionManager.setValue('blink', 0);
            }, 150);
        }
        
        // Lip sync
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

// ==========================================
// 📐 HANDLE RESIZE
// ==========================================
function handleResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

// ==========================================
// 🎙️ SET AUDIO ANALYZER (called from avatarChat.js)
// ==========================================
export function setAudioAnalyzer(analyzerInstance) {
    analyser = analyzerInstance;
}

export function setSpeakingState(state) {
    isSpeaking = state;
}

// ==========================================
// 🎭 UPDATE CHARACTER VISUALS (persona-based)
// ==========================================
export function updateCharacterVisuals(persona) {
    const aura = document.getElementById('face-aura');
    const badge = document.getElementById('mode-badge');
    const body = document.body;
    
    body.classList.remove('bg-tutor', 'bg-business', 'bg-casual');
    if (aura) aura.classList.remove('aura-tutor', 'aura-business', 'aura-casual');
    
    if (persona === 'Tutor') {
        body.classList.add('bg-tutor');
        if (aura) aura.classList.add('aura-tutor');
        if (badge) badge.innerText = '📚';
        if (currentVrm) currentVrm.expressionManager.setValue('happy', 0.8);
    } else if (persona === 'Business') {
        body.classList.add('bg-business');
        if (aura) aura.classList.add('aura-business');
        if (badge) badge.innerText = '💼';
        if (currentVrm) currentVrm.expressionManager.setValue('happy', 0);
    } else {
        body.classList.add('bg-casual');
        if (aura) aura.classList.add('aura-casual');
        if (badge) badge.innerText = '😎';
        if (currentVrm) currentVrm.expressionManager.setValue('happy', 1.0);
    }
}

// ==========================================
// 🖼️ 2D/3D MODE SWITCHING
// ==========================================
export function switchTo3DMode() {
    canvasContainer.classList.remove('hidden');
    document.getElementById('face-container').classList.add('hidden');
    document.getElementById('mode3dBtn').classList.add('active');
    document.getElementById('mode2dBtn').classList.remove('active');
}

export function switchTo2DMode() {
    const faceImg = document.getElementById('uploaded-face');
    if (!faceImg.src) {
        alert("Please upload an image first!");
        return false;
    }
    canvasContainer.classList.add('hidden');
    document.getElementById('face-container').classList.remove('hidden');
    document.getElementById('mode2dBtn').classList.add('active');
    document.getElementById('mode3dBtn').classList.remove('active');
    return true;
}

// ==========================================
// 🖼️ 2D FACE ANIMATION (during audio playback)
// ==========================================
export function animate2DFace(audioAnalyser) {
    const faceImg = document.getElementById('uploaded-face');
    const faceContainer = document.getElementById('face-container');
    
    if (!faceContainer.classList.contains('hidden') && faceImg.src) {
        const animateFace = () => {
            if (!isSpeaking) {
                faceImg.style.transform = 'scale(1) translateY(0)';
                return;
            }
            const freqData = new Uint8Array(audioAnalyser.frequencyBinCount);
            audioAnalyser.getByteFrequencyData(freqData);
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
}