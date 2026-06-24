import * as THREE from 'three';

/**
 * GestureEngine — controls the avatar's BODY (arms, head, torso).
 *
 * Purely procedural — no animation files needed. Each gesture is a
 * function of elapsed time (t) returning Euler-angle offsets per bone.
 * Offsets are smoothly interpolated toward their targets every frame,
 * so gestures blend naturally and always settle back to idle.
 *
 * Works on both VRM (via humanoid bone map) and GLB (via skeleton
 * bone name search as fallback).
 *
 * To add a new gesture:
 *   1. Add a case in _poseFor() returning { boneName: [x, y, z] }
 *   2. Add it to GESTURE_DURATIONS if it should auto-expire
 *   3. Done — AI can trigger it immediately via gesture: "yourname"
 */

const BONES = [
    'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperArm',  'leftLowerArm',  'leftHand',
    'head', 'neck', 'spine', 'chest', 'hips',
];

// How long each gesture plays before returning to idle (seconds).
// Omitted = uses default 2.2s. Set to 0 for idle (never expires).
const GESTURE_DURATIONS = {
    idle:        0,
    wave:        3.0,
    nod:         2.0,
    shake:       2.0,
    explain:     4.0,
    think:       3.5,
    shrug:       2.5,
    happy:       2.5,
    listening:   0,     // stays until next gesture
    point:       2.0,
    celebrate:   3.5,
    cross_arms:  0,     // stays until next gesture
    bow:         2.5,
    lean_in:     0,
    disagree:    2.5,
    present:     4.0,
    count:       3.0,
    facepalm:    2.5,
    stretch:     3.0,
    talk:        0,     // gentle talking motion, stays until next
};

export class GestureEngine {
    constructor(vrm) {
        this.vrm     = vrm;
        this.gesture = 'idle';
        this.elapsed = 0;
        this.duration = 0;
        this.enabled = true;

        this.base   = {};   // bone -> rest quaternion
        this.offset = {};   // bone -> current euler offset (smoothed)
        this.nodes  = {};

        BONES.forEach((name) => {
            const node = this._getBoneNode(vrm, name);
            this.nodes[name]  = node || null;
            if (node) this.base[name] = node.quaternion.clone();
            this.offset[name] = new THREE.Euler(0, 0, 0);
        });
    }

    /**
     * Get a bone node from either a VRM (humanoid map) or a plain GLB
     * (skeleton bone name search). VRM is tried first.
     */
    _getBoneNode(vrm, name) {
        // VRM path
        if (vrm?.humanoid) {
            const node = vrm.humanoid.getNormalizedBoneNode(name);
            if (node) return node;
        }
        // GLB fallback — search skeleton by common Mixamo/RPM bone names
        if (vrm?.scene) {
            const aliases = GLB_BONE_ALIASES[name] || [name];
            let found = null;
            vrm.scene.traverse((obj) => {
                if (found) return;
                const lower = (obj.name || '').toLowerCase();
                if (aliases.some((a) => lower.includes(a.toLowerCase()))) {
                    found = obj;
                }
            });
            return found;
        }
        return null;
    }

    play(gesture) {
        this.gesture  = gesture || 'idle';
        this.elapsed  = 0;
        const dur = GESTURE_DURATIONS[this.gesture];
        this.duration = dur === undefined ? 2.2 : dur;
    }

    // ── Pose definitions ──────────────────────────────────────────────────────
    // Each case returns { boneName: [x, y, z] } in radians.
    // t = elapsed time in seconds (drives oscillation).
    // Axes: x = pitch (forward/back tilt), y = yaw (left/right turn),
    //       z = roll (side lean). Sign convention follows VRM normalized space.
    _poseFor(g, t) {
        const sin = Math.sin;
        const cos = Math.cos;

        switch (g) {

            // ── Original gestures (tuned) ──────────────────────────────────

            case 'wave': {
                // Right arm up, forearm oscillates fast like a real wave
                const swing = sin(t * 8) * 0.55;
                const drift = sin(t * 3) * 0.08;
                return {
                    rightUpperArm: [0.1,  drift, -1.4],
                    rightLowerArm: [0,    0,     -0.4 + swing],
                    rightHand:     [0,    swing * 0.3, 0],
                    head:          [0.05, sin(t * 2) * 0.12, 0],
                };
            }

            case 'nod': {
                // Head + neck + slight spine bob
                const bob = sin(t * 5) * 0.22;
                return {
                    head:  [bob + 0.1,   0, 0],
                    neck:  [bob * 0.5,   0, 0],
                    spine: [bob * 0.15,  0, 0],
                };
            }

            case 'shake': {
                // Head swings side to side
                const sw = sin(t * 6) * 0.32;
                return {
                    head: [0.02, sw,       sin(t * 3) * 0.04],
                    neck: [0,    sw * 0.4, 0],
                };
            }

            case 'explain': {
                // Both hands open, alternating emphasis gestures
                const a = sin(t * 3)   * 0.3;
                const b = sin(t * 2.5) * 0.15;
                const c = sin(t * 2)   * 0.08;
                return {
                    rightUpperArm: [ 0.15,  b,      -0.65 - a * 0.35],
                    rightLowerArm: [ 0,     a * 0.4, -0.75],
                    rightHand:     [ 0,     a * 0.2,  0],
                    leftUpperArm:  [-0.15, -b,       0.65 + a * 0.35],
                    leftLowerArm:  [ 0,    -a * 0.4,  0.75],
                    leftHand:      [ 0,    -a * 0.2,  0],
                    chest:         [ a * 0.08, 0, 0],
                    head:          [ 0.05, c, 0],
                };
            }

            case 'think': {
                // Right hand near chin, head slightly tilted
                const s = sin(t * 1.8) * 0.05;
                const h = sin(t * 1.2) * 0.04;
                return {
                    rightUpperArm: [ 0.35,  0.1, -1.0],
                    rightLowerArm: [ 0.4,   0,   -1.7],
                    rightHand:     [ 0.2,   0,    0],
                    leftUpperArm:  [-0.1,   0,    0.35],
                    leftLowerArm:  [ 0,     0,    0.5],
                    head:          [ 0.12 + h, 0.18 + s, 0.06],
                    neck:          [ 0.05,     0.08,     0.03],
                };
            }

            case 'shrug': {
                // Shoulders rise, arms spread, palms up
                const rise = (sin(t * 2) + 1) * 0.5;
                return {
                    rightUpperArm: [-0.1, 0,  -0.35 - rise * 0.25],
                    leftUpperArm:  [-0.1, 0,   0.35 + rise * 0.25],
                    rightLowerArm: [ 0.2, 0,  -1.1],
                    leftLowerArm:  [ 0.2, 0,   1.1],
                    rightHand:     [-0.4, 0,   0],   // palm faces up
                    leftHand:      [-0.4, 0,   0],
                    head:          [ 0.1 + sin(t * 3) * 0.04, 0, 0],
                    chest:         [ rise * 0.06, 0, 0],
                };
            }

            case 'happy': {
                // Gentle bounce, arms slightly out
                const bounce = Math.abs(sin(t * 4)) * 0.06;
                const sway   = sin(t * 3) * 0.04;
                return {
                    rightUpperArm: [ 0.1, 0, -0.45],
                    leftUpperArm:  [-0.1, 0,  0.45],
                    chest:         [ bounce,  sway * 0.5, 0],
                    spine:         [ bounce * 0.6, 0, 0],
                    head:          [ 0.05 - bounce * 0.5, sway, 0],
                };
            }

            case 'listening': {
                // Slight head tilt, arms relaxed at sides, subtle lean
                const tilt = sin(t * 1.4) * 0.06;
                return {
                    head:         [0.08, 0.12, tilt],
                    neck:         [0.04, 0.06, tilt * 0.5],
                    rightUpperArm:[0.05, 0, -0.28],
                    leftUpperArm: [0.05, 0,  0.28],
                    spine:        [0.04, 0,  tilt * 0.2],
                };
            }

            // ── New gestures ───────────────────────────────────────────────

            case 'talk': {
                // Subtle ongoing talking motion — gentle hand movements,
                // head bob. Good default while the avatar is speaking.
                const a = sin(t * 2.8) * 0.18;
                const b = sin(t * 2.1) * 0.12;
                const c = sin(t * 1.9) * 0.06;
                return {
                    rightUpperArm: [ 0.1,  b * 0.4, -0.5 - a * 0.2],
                    rightLowerArm: [ 0,    0,        -0.6 + a * 0.3],
                    leftUpperArm:  [-0.05, 0,         0.3],
                    leftLowerArm:  [ 0,    0,         0.4],
                    head:          [ 0.05 + c * 0.3, b * 0.15, 0],
                    chest:         [ c * 0.08, 0, 0],
                };
            }

            case 'point': {
                // Right arm extends forward, index finger pointing
                const steady = sin(t * 1.5) * 0.02;  // tiny natural shake
                return {
                    rightUpperArm: [ 0.05, 0.1,   -0.5],
                    rightLowerArm: [-0.1,  0,      -1.4],
                    rightHand:     [-0.1,  steady,  0],
                    head:          [ 0.05, 0.1,     0],
                };
            }

            case 'celebrate': {
                // Both arms raise in a V, body bounces with excitement
                const t2 = t * 5;
                const bounce = Math.abs(sin(t2)) * 0.08;
                const openClose = sin(t * 4) * 0.2;
                return {
                    rightUpperArm: [-0.3,  0.1,  -1.2 - openClose * 0.2],
                    leftUpperArm:  [-0.3, -0.1,   1.2 + openClose * 0.2],
                    rightLowerArm: [-0.2,  0,     -0.3],
                    leftLowerArm:  [-0.2,  0,      0.3],
                    rightHand:     [-0.3,  0,      0],
                    leftHand:      [-0.3,  0,      0],
                    chest:         [ bounce, sin(t * 3) * 0.04, 0],
                    spine:         [ bounce * 0.5, 0, 0],
                    head:          [-0.1 + bounce * 0.5, sin(t * 2.5) * 0.08, 0],
                };
            }

            case 'cross_arms': {
                // Arms folded across chest — assertive / waiting pose
                const breathe = sin(t * 1.5) * 0.015;
                return {
                    rightUpperArm: [ 0.3, -0.4, -0.7],
                    rightLowerArm: [ 0.5,  0.6, -1.0],
                    leftUpperArm:  [ 0.3,  0.4,  0.7],
                    leftLowerArm:  [ 0.5, -0.6,  1.0],
                    chest:         [ breathe, 0, 0],
                    head:          [ 0.06, 0, sin(t * 1.7) * 0.02],
                };
            }

            case 'bow': {
                // Respectful bow — torso bends forward then straightens
                // t goes 0→duration; use a smooth arc so it bows then rises
                const arc = sin(t * Math.PI / (GESTURE_DURATIONS.bow || 2.5));
                const bend = arc * 0.55;  // max ~31° forward lean
                return {
                    spine: [ bend,       0, 0],
                    chest: [ bend * 0.6, 0, 0],
                    neck:  [-bend * 0.3, 0, 0],  // head stays roughly level
                    head:  [-bend * 0.2, 0, 0],
                    rightUpperArm: [0.05, 0, -0.25],
                    leftUpperArm:  [0.05, 0,  0.25],
                };
            }

            case 'lean_in': {
                // Leans slightly forward — engaged / interested body language
                const micro = sin(t * 1.3) * 0.015;
                return {
                    hips:  [0.12, 0, 0],
                    spine: [0.15, 0, 0],
                    chest: [0.08, 0, 0],
                    head:  [0.05 + micro, 0, 0],
                    rightUpperArm: [0.08, 0, -0.3],
                    leftUpperArm:  [0.08, 0,  0.3],
                };
            }

            case 'disagree': {
                // Head shakes while one hand comes up dismissively
                const sw = sin(t * 6) * 0.28;
                const lift = Math.min(1, t / 0.4);  // arm rises in first 0.4s
                return {
                    head:          [0.05, sw, sin(t * 3) * 0.03],
                    neck:          [0,    sw * 0.4, 0],
                    rightUpperArm: [0.1 * lift, 0, -0.6 * lift],
                    rightLowerArm: [0,          0, -0.5 * lift],
                    rightHand:     [0.2 * lift, sin(t * 5) * 0.1 * lift, 0],
                };
            }

            case 'present': {
                // One or both arms sweep out to "present" something —
                // like showing a product or gesturing to a screen
                const sweep = sin(t * 1.8) * 0.12;
                const b = sin(t * 2.2) * 0.08;
                return {
                    rightUpperArm: [ 0.15,  0.2 + sweep * 0.2, -0.8],
                    rightLowerArm: [-0.1,   0,                  -1.2],
                    rightHand:     [-0.2,   sweep,               0],
                    leftUpperArm:  [ 0.1,  -0.15,                0.5],
                    leftLowerArm:  [ 0,     0,                   0.6],
                    head:          [ 0.06,  b,                   0],
                    chest:         [ 0.05 + Math.abs(b) * 0.3, 0, 0],
                };
            }

            case 'count': {
                // Counts on fingers — right hand raises, fingers open one by one
                // (approximated as a rhythmic open/close with forearm lift)
                const beat  = Math.floor(t * 2) % 4;  // 0,1,2,3 counts
                const pulse = sin(t * Math.PI * 2) * 0.15;
                const raise = 0.3 + beat * 0.12;
                return {
                    rightUpperArm: [ 0.2,  0.1, -0.9 - raise * 0.3],
                    rightLowerArm: [ raise, 0,  -1.4],
                    rightHand:     [ pulse, 0,   0],
                    head:          [ 0.05,  sin(t * 1.5) * 0.06, 0],
                };
            }

            case 'facepalm': {
                // Right hand rises slowly to face — exasperated / amused
                const rise = Math.min(1, t / 0.7);
                const s    = sin(t * 2) * 0.03;
                return {
                    rightUpperArm: [ 0.3 * rise,  0,    -1.1 * rise],
                    rightLowerArm: [ 0.5 * rise,  0,    -1.6 * rise],
                    rightHand:     [-0.2 * rise,  0,     0],
                    head:          [ 0.08 + s,    0.05,  0.04],
                    spine:         [ 0.04, 0, 0],
                };
            }

            case 'stretch': {
                // Both arms reach up and out, torso extends — refreshing stretch
                const reach = sin(t * Math.PI / (GESTURE_DURATIONS.stretch || 3)) * 0.9;
                const sway  = sin(t * 2) * 0.06;
                return {
                    rightUpperArm: [-0.8 * reach, 0,  -0.8 * reach],
                    leftUpperArm:  [-0.8 * reach, 0,   0.8 * reach],
                    rightLowerArm: [-0.3 * reach, 0,  -0.1],
                    leftLowerArm:  [-0.3 * reach, 0,   0.1],
                    chest:         [-reach * 0.2, 0,   sway * 0.3],
                    spine:         [-reach * 0.1, 0,   0],
                    head:          [-reach * 0.15, 0,  0],
                };
            }

            default:
                return {};
        }
    }

    update(delta) {
        if (this.enabled === false) return;
        const dt = delta || 0.016;
        this.elapsed += dt;

        // Gestures auto-expire back to idle when duration is up.
        let active = this.gesture;
        const dur  = GESTURE_DURATIONS[active];
        if (active !== 'idle' && dur !== 0 && this.elapsed > (dur ?? 2.2)) {
            active = 'idle';
        }

        const t       = this.elapsed;
        const desired = this._poseFor(active, t);

        // Idle base layer — breathing + micro-movements always running.
        // Gestures override these values when they specify the same bone.
        const breathe       = Math.sin(t * 1.6)  * 0.03;
        const microHead     = Math.sin(t * 2.3)  * 0.02;
        const microShoulder = Math.sin(t * 1.8 + 0.5) * 0.015;
        const idle = {
            chest:         [breathe,           0,                    0],
            spine:         [breathe * 0.6,     0,                    0],
            head:          [microHead,         0,  Math.sin(t * 1.9) * 0.015],
            rightUpperArm: [0, microShoulder * 0.3,  -0.1],
            leftUpperArm:  [0, -microShoulder * 0.3,  0.1],
        };

        const speed = 8;
        BONES.forEach((name) => {
            const node = this.nodes[name];
            if (!node) return;

            const d = desired[name] || idle[name] || [0, 0, 0];
            const o = this.offset[name];
            o.x += (d[0] - o.x) * Math.min(1, dt * speed);
            o.y += (d[1] - o.y) * Math.min(1, dt * speed);
            o.z += (d[2] - o.z) * Math.min(1, dt * speed);

            const q = new THREE.Quaternion().setFromEuler(o);
            // VRM: multiply onto stored rest pose.
            // GLB: bones have no stored rest (humanoid is null), so just set directly.
            if (this.base[name]) {
                node.quaternion.copy(this.base[name]).multiply(q);
            } else {
                node.quaternion.setFromEuler(o);
            }
        });
    }
}

// ── GLB bone name aliases ─────────────────────────────────────────────────────
// Maps VRM normalized bone names → substrings found in Mixamo / RPM skeleton.
// The search is case-insensitive and uses `includes`, so partial matches work.
const GLB_BONE_ALIASES = {
    rightUpperArm: ['RightArm',       'mixamorig:RightArm',       'right_arm',       'R_Arm'],
    rightLowerArm: ['RightForeArm',   'mixamorig:RightForeArm',   'right_forearm',   'R_ForeArm'],
    rightHand:     ['RightHand',      'mixamorig:RightHand',      'right_hand',      'R_Hand'],
    leftUpperArm:  ['LeftArm',        'mixamorig:LeftArm',        'left_arm',        'L_Arm'],
    leftLowerArm:  ['LeftForeArm',    'mixamorig:LeftForeArm',    'left_forearm',    'L_ForeArm'],
    leftHand:      ['LeftHand',       'mixamorig:LeftHand',       'left_hand',       'L_Hand'],
    head:          ['Head',           'mixamorig:Head',           'head'],
    neck:          ['Neck',           'mixamorig:Neck',           'neck'],
    spine:         ['Spine',          'mixamorig:Spine',          'spine'],
    chest:         ['Spine1',         'mixamorig:Spine1',         'chest',           'Spine2'],
    hips:          ['Hips',           'mixamorig:Hips',           'hips',            'pelvis'],
};