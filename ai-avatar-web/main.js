/**
 * Akademia AI Avatar — main.js (the conductor)
 *
 * Loads local VRM files from /assets/avatars/.
 * Wires AI behavior JSON to ExpressionEngine / GestureEngine / LipSync.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { AvatarManager }    from './src/avatar/AvatarManager.js';
import { ExpressionEngine } from './src/avatar/ExpressionEngine.js';
import { GestureEngine }    from './src/avatar/GestureEngine.js';
import { LipSync }          from './src/avatar/LipSync.js';

import { CharacterBrain }    from './src/ai/CharacterBrain.js';
import { PersonaSystem }     from './src/systems/PersonaSystem.js';
import { BackgroundSystem }  from './src/systems/BackgroundSystem.js';
import { Controls }          from './src/ui/Controls.js';

const BACKEND = '';   // Vite proxy (see vite.config.js)

// ── Three.js scene ──────────────────────────────────────────────────────────
const scene    = new THREE.Scene();
const canvas3d = document.getElementById('avatar-canvas');
const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 100);
const CAMERA_DISTANCE = 1.8;
camera.position.set(0, 1.4, CAMERA_DISTANCE);

const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.target.set(0, 1.3, 0);
orbitControls.enableDamping  = true;
orbitControls.enablePan      = false;
orbitControls.enableZoom     = false;
orbitControls.minPolarAngle  = Math.PI / 2.4;
orbitControls.maxPolarAngle  = Math.PI / 2.05;
orbitControls.update();

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const keyLight = new THREE.DirectionalLight(0xfff5ee, 2.0);
keyLight.position.set(1.2, 3.5, 2.5);
scene.add(keyLight);

// ── Systems ──────────────────────────────────────────────────────────────────
const avatarManager   = new AvatarManager(scene);
const brain           = new CharacterBrain(BACKEND);
const personaSystem   = new PersonaSystem('Tutor');
const backgroundSystem = new BackgroundSystem('scene-bg');

// Per-avatar engines (rebuilt whenever a new avatar loads).
let expression = null;
let gesture    = null;
let lipSync    = null;
let currentVrm = null;

// ── Avatar registry ───────────────────────────────────────────────────────────
// All files live in  ai-avatar-web/public/assets/avatars/
// VRM files you place there are served at /assets/avatars/<filename>.vrm
//
// EACH NAMED CHARACTER NOW HAS ITS OWN FILE SLOT. Right now Amara/Yuki both
// point at sample_a.vrm and Kwame/Kenji both point at sample_b.vrm, which is
// why picking different characters only ever showed one of two looks. To
// give each of the 4 a distinct appearance:
//   1. Download (or make) 4 separate .vrm files — see "WHERE TO GET MORE
//      AVATARS" below.
//   2. Save them into public/assets/avatars/ as EXACTLY:
//        amara.vrm   kwame.vrm   yuki.vrm   kenji.vrm
//   3. Change the four `file:` lines below to point at those names instead
//      of sample_a.vrm / sample_b.vrm.
// Until you do that, nothing breaks — they just keep sharing the 2 sample
// models. If a file is missing, that character shows "No model loaded"
// (chat/voice/expressions all still work; only the 3D body is absent).
//
// WHERE TO GET MORE AVATARS (free):
//   • https://hub.vroid.com — browse, filter by "Free", open a model page,
//     click Download. Works for both this app and VRoid Studio.
//   • https://vroid.com/en/studio — free desktop app to build your OWN
//     character from scratch (hair/face/outfit sliders) and export as .vrm.
//   • Both give you a VRoid/anime-style humanoid VRM with the standard bones
//     and face blendshapes this app expects (expressions, lip sync, gestures
//     all rely on those). A photorealistic "realistic human" VRM with the
//     same rigging is not something there's a reliable free source for right
//     now — that's a real limitation, not something missing from this code.
let avatarList = [
    {
        id: 'uganda-female',
        name: 'Amara',
        handle: '@amara_ug',
        bio: 'Friendly bilingual tutor for English and Japanese.',
        file: '/assets/avatars/sample_a.vrm',   // ← change to amara.vrm once you have one
        // Picture shown in the "Discover" list. Drop your own image here
        // (any /assets/... path or full URL); falls back to a color if missing.
        image: '/assets/thumbs/avatar-uganda-female.svg',
        culture: 'en',
        voiceEn: 'en-US-JennyNeural',
        voiceJa: 'ja-JP-NanamiNeural',
    },
    {
        id: 'uganda-male',
        name: 'Kwame',
        handle: '@kwame_ug',
        bio: 'Advanced native instruction specialist.',
        file: '/assets/avatars/sample_b.vrm',   // ← change to kwame.vrm once you have one
        image: '/assets/thumbs/avatar-uganda-male.svg',
        culture: 'en',
        voiceEn: 'en-US-GuyNeural',
        voiceJa: 'ja-JP-KeitaNeural',
    },
    {
        id: 'japan-female',
        name: 'Yuki',
        handle: '@yuki_jp',
        bio: 'Warm Japanese companion for everyday conversation.',
        file: '/assets/avatars/sample_a.vrm',   // ← change to yuki.vrm once you have one
        image: '/assets/thumbs/avatar-japan-female.svg',
        culture: 'ja',
        voiceEn: 'en-US-AriaNeural',
        voiceJa: 'ja-JP-NanamiNeural',
    },
    {
        id: 'japan-male',
        name: 'Kenji',
        handle: '@kenji_jp',
        bio: 'Linguistic acquisition mentor.',
        file: '/assets/avatars/sample_b.vrm',   // ← change to kenji.vrm once you have one
        image: '/assets/thumbs/avatar-japan-male.svg',
        culture: 'ja',
        voiceEn: 'en-US-DavisNeural',
        voiceJa: 'ja-JP-KeitaNeural',
    },
];

let currentAvatarId = 'uganda-female';

// ── UI controls ───────────────────────────────────────────────────────────────
const ui = new Controls({
    onAsk:           handleAsk,
    onSelectAvatar:  selectAvatar,
    onSelectScenario: selectScenario,
    onCreateAvatar:  createAvatar,
    onDeleteAvatar:  deleteAvatar,
    onSetVoice:      setAvatarVoice,
    onReset:         resetConversation,
    onReplay:        replayLastReply,
    getAvatars:      () => avatarList,
    currentAvatarId: () => currentAvatarId,
});

// ── Avatar loading ────────────────────────────────────────────────────────────
async function selectAvatar(avatarId) {
    const a = avatarList.find((x) => x.id === avatarId);
    if (!a) return;
    currentAvatarId = avatarId;

    ui.setProfile({ name: a.name, handle: a.handle, bio: a.bio });
    ui.setVoiceLang(a.culture);
    ui.setVoiceSelectors(a.voiceEn, a.voiceJa);
    ui.setStatus(`Loading ${a.name}…`);
    ui.setDot('yellow');

    try {
        currentVrm = await avatarManager.loadAvatar(a.file);
        avatarManager.applyCustomization(currentVrm, {
            hairColor: a.hairColor, clothColor: a.clothColor, skinColor: a.skinColor,
            heightScale: a.heightScale || 1, buildScale: a.buildScale || 1,
        });
        attachEngines(currentVrm);
        ui.setStatus('Ready');
        ui.setDot('green');
    } catch (err) {
        console.warn('Avatar load failed — engines idle until model loads:', err.message);
        currentVrm = null;
        expression = gesture = lipSync = null;
        ui.setStatus('Ready (no model)');
        ui.setDot('green');
    }
}

function attachEngines(vrm) {
    expression = new ExpressionEngine(vrm);
    gesture    = new GestureEngine(vrm);
    lipSync    = new LipSync(vrm);
}

function selectScenario(personaKey) {
    const p = personaSystem.set(personaKey);
    backgroundSystem.load(p.background);
    ui.setVoiceLang(p.culture);
}

// ── The brain → body pipeline ─────────────────────────────────────────────────
async function handleAsk(text) {
    ui.setBusy(true);
    ui.setStatus('Thinking…');
    ui.setDot('yellow');

    const current = avatarList.find((a) => a.id === currentAvatarId);
    let data;
    try {
        data = await brain.ask(text, personaSystem.current, {
            en: current?.voiceEn, ja: current?.voiceJa,
        }, current?.name);
    } catch (err) {
        console.warn('Backend unavailable, using offline behavior:', err.message);
        data = brain.offlineBehavior(text, personaSystem.current);
    }

    applyBehavior(data);
    ui.setStatus('Ready');
    ui.setDot('green');
    ui.setBusy(false);
    ui.refreshSuggestions();
}

/** Change the CURRENT avatar's voice for a given language. Takes effect on
 *  the next reply — no model reload needed, this only affects the backend
 *  TTS call. */
function setAvatarVoice(lang, voiceName) {
    const current = avatarList.find((a) => a.id === currentAvatarId);
    if (!current || !voiceName) return;
    if (lang === 'ja') current.voiceJa = voiceName;
    else current.voiceEn = voiceName;
    ui.showSpeechBubble('SYSTEM', `Voice updated.`, '');
}

/** "Restart Chat" must reset more than the text — without this, the avatar
 *  stays frozen in whatever gesture/expression its last reply triggered
 *  (e.g. raised "explain" arms), since nothing else ever calls .play('idle')
 *  again. This is almost certainly why the avatar looked stuck in a
 *  shrug-like pose after clearing a conversation that had messages in it. */
function resetConversation() {
    brain.reset();
    gesture?.play('idle');
    expression?.setExpression('neutral');
    lipSync?.stop();
}

let lastAudio = null; // { url, visemes } of the most recent reply, for the replay icon

function applyBehavior(data) {
    const en = data.reply || data.text_en || '';
    const ja = data.translated_reply || data.text_ja || '';
    ui.showSpeechBubble('AVATAR', en, ja);

    // Face
    expression?.setExpression(data.expression || data.emotion || 'neutral');
    // Body
    gesture?.play(data.gesture || 'explain');
    // World
    if (data.background) backgroundSystem.load(data.background);

    // Audio + lip sync — play the persona's primary language track.
    const primary  = data.primary || 'en';
    const audioUrl = primary === 'ja'
        ? (data.audio_url_ja || data.audio_url)
        : (data.audio_url_en || data.audio_url);
    const visemes  = primary === 'ja'
        ? (data.visemes_ja  || data.visemes)
        : (data.visemes_en  || data.visemes);

    if (lipSync && audioUrl) {
        lastAudio = { url: audioUrl, visemes: visemes || [] };
        lipSync.play(BACKEND + audioUrl, visemes || []);
    }
}

/** Re-plays the most recent reply's voice line and gesture — wired to the
 *  small inline icon next to the latest chat bubble. */
function replayLastReply() {
    if (!lastAudio) return;
    gesture?.play('explain');
    if (lipSync) lipSync.play(BACKEND + lastAudio.url, lastAudio.visemes);
}

// ── Avatar creator (preset-based, no external iframe) ─────────────────────────
function createAvatar({ name, style, culture, bio, image, hairColor, clothColor, skinColor, heightScale, buildScale, voiceEn, voiceJa }) {
    const id = 'custom-' + Date.now();

    // Map style + culture to one of the local VRM files.
    // 'style' is either 'anime-female' | 'anime-male' | 'realistic-female' | 'realistic-male'
    const fileMap = {
        'anime-female':     '/assets/avatars/sample_a.vrm',
        'realistic-female': '/assets/avatars/sample_a.vrm',
        'anime-male':       '/assets/avatars/sample_b.vrm',
        'realistic-male':   '/assets/avatars/sample_b.vrm',
    };
    const file = fileMap[style] || '/assets/avatars/sample_a.vrm';

    // Picture: use the one the user picked, else a default per chosen style.
    // This is what "automatically adds a picture when the avatar is made".
    const thumb = image || `/assets/thumbs/style-${style}.svg`;

    const avatar = {
        id,
        name,
        handle: '@' + name.toLowerCase().replace(/\s+/g, '_'),
        bio,
        file,
        image: thumb,
        culture,
        hairColor: hairColor || null,
        clothColor: clothColor || null,
        skinColor: skinColor || null,
        heightScale: heightScale || 1,
        buildScale: buildScale || 1,
        voiceEn: voiceEn || 'en-US-JennyNeural',
        voiceJa: voiceJa || 'ja-JP-NanamiNeural',
    };
    avatarList.push(avatar);
    selectAvatar(id);
    ui.showSpeechBubble('STUDIO', `Avatar "${name}" created and loaded.`, '');
}

function deleteAvatar(avatarId) {
    if (!avatarId.startsWith('custom-')) {
        ui.showSpeechBubble('SYSTEM', 'Cannot delete default avatars.', '');
        return;
    }
    const index = avatarList.findIndex((a) => a.id === avatarId);
    if (index === -1) return;

    const avatar = avatarList[index];
    avatarList.splice(index, 1);

    if (currentAvatarId === avatarId) {
        const next = avatarList[0];
        if (next) {
            selectAvatar(next.id);
        } else {
            currentAvatarId = null;
            currentVrm = null;
            expression = gesture = lipSync = null;
            ui.setStatus('No avatars available');
        }
    }
    ui.showSpeechBubble('SYSTEM', `Avatar "${avatar.name}" deleted.`, '');
}

// ── Render loop ───────────────────────────────────────────────────────────────
const clock = new THREE.Timer();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    gesture?.update(delta);
    expression?.update(delta);
    lipSync?.update(delta);
    if (currentVrm && typeof currentVrm.update === 'function') currentVrm.update(delta);

    orbitControls.update();
    renderer.render(scene, camera);
}

// Horizontal framing width (meters) the camera should always keep in view,
// derived from the original desktop setup (32° vertical FOV @ a typical
// ~1.6 browser-window aspect ratio and 1.8m distance) — so desktop framing
// is unchanged, but narrow/portrait screens now widen the vertical FOV
// instead of leaving it fixed, which is what was clipping the arms/hands.
// A FIXED FOV only controls vertical framing; horizontal framing is then a
// side-effect of aspect ratio, which is backwards for what a portrait phone
// screen needs (lots of vertical room, but the arm span still needs to fit
// horizontally). Solving for FOV from a fixed horizontal width fixes that
// structurally, for any window size, instead of patching specific breakpoints.
const FRAME_WIDTH = 1.65;

function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    camera.aspect = aspect;

    const horizontalHalfFov = Math.atan((FRAME_WIDTH / 2) / CAMERA_DISTANCE);
    let verticalFovRad = 2 * Math.atan(Math.tan(horizontalHalfFov) / aspect);
    let verticalFovDeg = THREE.MathUtils.radToDeg(verticalFovRad);
    // Clamp to a sane range so extreme window shapes don't produce a
    // fisheye (too wide) or telephoto (too narrow) view.
    verticalFovDeg = Math.max(28, Math.min(70, verticalFovDeg));

    camera.fov = verticalFovDeg;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
    resize();
    ui.init();
    backgroundSystem.load(personaSystem.persona.background);

    try {
        const { catalog } = await brain.voices();
        ui.setVoiceCatalog(catalog || { en: [], ja: [] });
    } catch (err) {
        console.warn('Could not load voice catalog from backend:', err.message);
    }

    await selectAvatar(currentAvatarId);
    animate();
}

document.addEventListener('DOMContentLoaded', init);