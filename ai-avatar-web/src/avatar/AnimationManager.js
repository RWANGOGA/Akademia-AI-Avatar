import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { retargetAnimation } from 'vrm-mixamo-retarget';

/** Maps AI gesture / animation names to clip keys in manifest.json */
export const GESTURE_TO_CLIP = {
    idle: 'idle',
    wave: 'wave',
    nod: 'nod',
    shake: 'nod',
    explain: 'explain',
    think: 'think',
    shrug: null,
    happy: 'wave',
    listening: 'idle',
};

const MANIFEST_URL = '/assets/animations/manifest.json';
const CLIP_BASE = '/assets/animations/';

/**
 * AnimationManager — Mixamo FBX clips retargeted to VRM via AnimationMixer.
 * Falls back gracefully when clip files are not present yet.
 */
export class AnimationManager {
    constructor() {
        this.vrm = null;
        this.mixer = null;
        this.actions = {};
        this.current = null;
        this.fbxLoader = new FBXLoader();
        this.ready = false;
        this.loading = false;
    }

    async init(vrm) {
        this.dispose();
        this.vrm = vrm;
        if (!vrm?.scene || vrm.isGLB) return false;

        this.mixer = new THREE.AnimationMixer(vrm.scene);
        this.actions = {};
        this.current = null;
        this.ready = false;
        this.loading = true;

        let manifest = { clips: {} };
        try {
            const res = await fetch(MANIFEST_URL);
            if (res.ok) manifest = await res.json();
        } catch (_) {}

        const entries = Object.entries(manifest.clips || {});
        let loaded = 0;

        await Promise.all(entries.map(async ([name, file]) => {
            try {
                const fbx = await this.fbxLoader.loadAsync(CLIP_BASE + file);
                const clip = retargetAnimation(fbx, vrm, { logWarnings: false });
                if (!clip) return;
                clip.name = name;
                const action = this.mixer.clipAction(clip);
                action.setEffectiveTimeScale(1);
                this.actions[name] = action;
                loaded += 1;
            } catch (err) {
                console.debug(`Animation clip "${name}" not loaded (add ${file} to public/assets/animations/)`);
            }
        }));

        this.loading = false;
        this.ready = loaded > 0;

        if (this.actions.idle) {
            this._playAction('idle', { loop: true, fade: 0 });
        }

        return this.ready;
    }

    hasClip(name) {
        return Boolean(this.actions[name]);
    }

    /** Play clip by gesture/animation name; returns true if a clip handled it. */
    play(name, { loop = false, fade = 0.35 } = {}) {
        if (!this.ready || !this.mixer) return false;

        const key = GESTURE_TO_CLIP[name] ?? name;
        if (!key || !this.actions[key]) return false;

        this._playAction(key, { loop: loop || key === 'idle', fade });
        return true;
    }

    _playAction(key, { loop, fade }) {
        const next = this.actions[key];
        if (!next) return;

        next.reset();
        next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        next.clampWhenFinished = !loop;

        if (this.current && this.current !== next) {
            next.enabled = true;
            next.setEffectiveWeight(1);
            this.current.crossFadeTo(next, fade, false);
        } else {
            next.play();
        }

        if (!loop && key !== 'idle') {
            const mixer = this.mixer;
            const onFinished = (e) => {
                if (e.action !== next) return;
                mixer.removeEventListener('finished', onFinished);
                if (this.actions.idle) this._playAction('idle', { loop: true, fade: 0.4 });
            };
            mixer.addEventListener('finished', onFinished);
        }

        this.current = next;
    }

    playIdle() {
        return this.play('idle', { loop: true });
    }

    update(delta) {
        this.mixer?.update(delta || 0.016);
    }

    dispose() {
        this.mixer?.stopAllAction();
        this.mixer = null;
        this.actions = {};
        this.current = null;
        this.vrm = null;
        this.ready = false;
    }
}
