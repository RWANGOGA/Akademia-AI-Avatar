/**
 * LipSync — controls the avatar's MOUTH, synced to spoken audio.
 *
 * Flow:  text -> (Edge-TTS on backend) -> audio + viseme timeline -> mouth shapes
 *
 * Backend sends a timeline like [{ t: 120, v: "aa" }, ...] where `t` is ms and
 * `v` is one of the VRM mouth presets (aa/ih/ou/ee/oh) or "sil" (silence).
 * LipSync owns the mouth channel exclusively so it never fights ExpressionEngine.
 */
const MOUTH = ['aa', 'ih', 'ou', 'ee', 'oh'];

export class LipSync {
    constructor(vrm) {
        this.vrm = vrm;
        this.visemes = [];
        this.audio = null;
        this.playing = false;
        this.target = {};
        this.current = {};
        MOUTH.forEach((m) => { this.target[m] = 0; this.current[m] = 0; });
    }

    get manager() {
        return this.vrm && this.vrm.expressionManager;
    }

    _silence() {
        MOUTH.forEach((m) => { this.target[m] = 0; });
    }

    /** Start playing audio and drive the mouth from the viseme timeline. */
    async play(audioUrl, visemes) {
        this.stop();
        this.visemes = Array.isArray(visemes) ? visemes : [];
        if (!audioUrl) return;

        this.audio = new Audio(audioUrl);
        this.audio.crossOrigin = 'anonymous';
        this.audio.onended = () => { this.playing = false; this._silence(); };
        this.audio.onerror = () => { 
            console.warn('Audio load error:', audioUrl);
            this.playing = false; 
            this._silence();
        };
        
        try {
            await this.audio.play();
            this.playing = true;
        } catch (err) {
            console.warn('Audio playback blocked:', err.message);
            this.playing = false;
        }
        return this.audio;
    }

    stop() {
        if (this.audio) {
            try { this.audio.pause(); } catch (_) {}
            this.audio = null;
        }
        this.playing = false;
        this._silence();
    }

    _currentViseme(ms) {
        let cur = 'sil';
        for (const v of this.visemes) {
            if (v.t <= ms) cur = v.v; else break;
        }
        return cur;
    }

    update(delta) {
        const mgr = this.manager;
        if (!mgr) return;
        const dt = delta || 0.016;

        if (this.playing && this.audio && this.visemes.length) {
            const ms = this.audio.currentTime * 1000;
            const cur = this._currentViseme(ms);
            MOUTH.forEach((m) => { this.target[m] = (m === cur) ? 0.85 : 0; });
        }

        MOUTH.forEach((m) => {
            this.current[m] += (this.target[m] - this.current[m]) * Math.min(1, dt * 14);
            try { mgr.setValue(m, this.current[m]); } catch (_) {}
        });
    }
}
