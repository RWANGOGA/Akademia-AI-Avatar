/**
 * LipSync — mouth shapes synced to TTS audio + viseme timeline.
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
        this._prevViseme = 'sil';
        MOUTH.forEach((m) => { this.target[m] = 0; this.current[m] = 0; });
    }

    get manager() {
        return this.vrm && this.vrm.expressionManager;
    }

    _silence() {
        MOUTH.forEach((m) => { this.target[m] = 0; });
        this._prevViseme = 'sil';
    }

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

    _visemeAt(ms) {
        let cur = 'sil';
        let prev = 'sil';
        for (const v of this.visemes) {
            if (v.t <= ms) {
                prev = cur;
                cur = v.v;
            } else break;
        }
        return { cur, prev };
    }

    update(delta) {
        const mgr = this.manager;
        if (!mgr) return;
        const dt = delta || 0.016;

        if (this.playing && this.audio) {
            const ms = this.audio.currentTime * 1000;

            if (this.visemes.length) {
                const { cur, prev } = this._visemeAt(ms);
                MOUTH.forEach((m) => { this.target[m] = 0; });
                if (cur !== 'sil' && MOUTH.includes(cur)) {
                    this.target[cur] = 0.88;
                }
                if (prev !== 'sil' && prev !== cur && MOUTH.includes(prev)) {
                    this.target[prev] = Math.max(this.target[prev] || 0, 0.25);
                }
                this._prevViseme = cur;
            } else {
                // No viseme data — gentle jaw motion from speech energy proxy
                const t = ms * 0.008;
                const jaw = 0.15 + Math.abs(Math.sin(t * 3.1)) * 0.35;
                MOUTH.forEach((m) => { this.target[m] = 0; });
                this.target.aa = jaw;
            }
        }

        MOUTH.forEach((m) => {
            this.current[m] += (this.target[m] - this.current[m]) * Math.min(1, dt * 16);
            try { mgr.setValue(m, this.current[m]); } catch (_) {}
        });
    }
}
