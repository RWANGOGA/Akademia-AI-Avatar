/**
 * EmotionSystem — maps AI behavior JSON to face, body clips, and lip sync.
 */
export class EmotionSystem {
    constructor({ expression, gesture, animation, lipSync }) {
        this.expression = expression;
        this.gesture = gesture;
        this.animation = animation;
        this.lipSync = lipSync;
    }

    /**
     * @param {object} data — backend behavior payload
     * @param {string} backendUrl — prefix for audio paths
     * @returns {Promise<object|null>} lastAudio for replay
     */
    apply(data, backendUrl = '') {
        const en = data.reply || data.text_en || '';
        const emotion = data.expression || data.emotion || 'neutral';
        const bodyKey = data.animation || data.gesture || 'explain';

        this.expression?.setExpression(emotion);

        const usedClip = this.animation?.play(bodyKey, {
            loop: bodyKey === 'idle' || bodyKey === 'talk',
        });

        if (this.gesture) {
            if (usedClip) {
                this.gesture.enabled = false;
            } else {
                this.gesture.enabled = true;
                this.gesture.play(data.gesture || bodyKey);
            }
        }

        const primary = data.primary || 'en';
        const audioUrl = primary === 'ja'
            ? (data.audio_url_ja || data.audio_url)
            : (data.audio_url_en || data.audio_url);
        const visemes = primary === 'ja'
            ? (data.visemes_ja || data.visemes)
            : (data.visemes_en || data.visemes);

        if (this.lipSync && audioUrl) {
            const full = audioUrl.startsWith('http') || audioUrl.startsWith('/')
                ? backendUrl + audioUrl
                : backendUrl + '/' + audioUrl;
            if (this.animation?.hasClip('talk')) {
                this.animation.play('talk', { loop: true });
                if (this.gesture) this.gesture.enabled = false;
            }
            this.lipSync.play(full, visemes || []);
            return { url: audioUrl, visemes: visemes || [] };
        }
        return null;
    }

    reset() {
        this.animation?.playIdle();
        if (this.gesture) {
            this.gesture.enabled = !this.animation?.hasClip?.('idle');
            this.gesture.play('idle');
        }
        this.expression?.setExpression('neutral');
        this.lipSync?.stop();
    }

    replayExplain(lastAudio, backendUrl) {
        if (!lastAudio) return;
        const used = this.animation?.play('explain');
        if (this.gesture) {
            if (used) this.gesture.enabled = false;
            else {
                this.gesture.enabled = true;
                this.gesture.play('explain');
            }
        }
        if (this.lipSync) {
            this.lipSync.play(backendUrl + lastAudio.url, lastAudio.visemes);
        }
    }
}
