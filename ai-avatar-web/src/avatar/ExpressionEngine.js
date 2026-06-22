/**
 * ExpressionEngine — controls the avatar's FACE (emotion + blinking).
 *
 * It owns the emotion channel and blinking only. The mouth visemes
 * (aa/ih/ou/ee/oh) are owned by LipSync so the two never fight.
 *
 * AI sends:  emotion: "happy"  ->  expression.set("happy")
 */
const EMOTION_TO_VRM = {
    neutral:   'neutral',
    happy:     'happy',
    sad:       'sad',
    surprised: 'surprised',
    relaxed:   'relaxed',
    thinking:  'relaxed',   // VRM has no "thinking" preset; relaxed reads as pensive
    angry:     'angry',
    excited:   'happy',
    confused:  'surprised',
    loving:    'happy',
    worried:   'sad',
};

const ALL_EMOTIONS = ['neutral', 'happy', 'sad', 'surprised', 'relaxed', 'angry', 'excited', 'confused', 'loving', 'worried'];

export class ExpressionEngine {
    constructor(vrm) {
        this.vrm = vrm;
        this.target = {};          // emotion -> desired weight
        this.current = {};         // emotion -> current (smoothed) weight
        ALL_EMOTIONS.forEach((e) => { this.target[e] = 0; this.current[e] = 0; });
        this.current.neutral = 1;

        this._blink = 0;
        this._nextBlink = this._scheduleBlink();
    }

    get manager() {
        return this.vrm && this.vrm.expressionManager;
    }

    setExpression(emotion) {
        const vrmName = EMOTION_TO_VRM[emotion] || 'neutral';
        ALL_EMOTIONS.forEach((e) => { this.target[e] = 0; });
        
        // Set primary emotion with appropriate intensity
        const intensity = this._getIntensity(emotion);
        this.target[vrmName] = intensity;
        
        // Blend with neutral for more natural look
        if (vrmName !== 'neutral') {
            this.target.neutral = 1 - intensity;
        }
        
        // Add secondary emotion blends for more complex expressions
        this._addSecondaryBlends(emotion);
    }

    _getIntensity(emotion) {
        const intensities = {
            neutral: 1.0,
            happy: 0.85,
            sad: 0.8,
            surprised: 0.9,
            relaxed: 0.75,
            angry: 0.85,
            excited: 0.9,
            confused: 0.7,
            loving: 0.8,
            worried: 0.75,
        };
        return intensities[emotion] || 0.8;
    }

    _addSecondaryBlends(emotion) {
        // Add subtle secondary emotions for more natural expressions
        switch (emotion) {
            case 'excited':
                this.target.surprised = 0.2;
                break;
            case 'worried':
                this.target.surprised = 0.15;
                break;
            case 'loving':
                this.target.relaxed = 0.3;
                break;
            case 'confused':
                this.target.surprised = 0.4;
                this.target.neutral = 0.3;
                break;
        }
    }

    _scheduleBlink() {
        return performance.now() + 1500 + Math.random() * 3500;
    }

    update(delta) {
        const mgr = this.manager;
        if (!mgr) return;
        const dt = delta || 0.016;

        // Smoothly approach target emotion weights.
        const speed = 6;
        ALL_EMOTIONS.forEach((e) => {
            this.current[e] += (this.target[e] - this.current[e]) * Math.min(1, dt * speed);
            try { mgr.setValue(e, this.current[e]); } catch (_) {}
        });

        // Natural blinking.
        const now = performance.now();
        if (now >= this._nextBlink && this._blink === 0) {
            this._blink = 1;
        }
        if (this._blink > 0) {
            this._blink -= dt * 8;          // quick close+open
            if (this._blink <= 0) {
                this._blink = 0;
                this._nextBlink = this._scheduleBlink();
            }
            const w = Math.sin(Math.max(0, Math.min(1, this._blink)) * Math.PI);
            try { mgr.setValue('blink', w); } catch (_) {}
        }
    }
}
