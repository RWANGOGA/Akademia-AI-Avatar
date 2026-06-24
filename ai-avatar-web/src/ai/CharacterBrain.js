/**
 * CharacterBrain — the frontend's connection to the AI backend (the brain).
 *
 * It does not think on its own; it asks the backend, which calls the LLM and
 * returns a single behavior JSON (reply + emotion + gesture + voice + visemes).
 * If the backend is unreachable it returns a safe offline behavior so the UI
 * never hard-crashes.
 */
export class CharacterBrain {
    constructor(backendUrl = '') {
        this.backend = backendUrl;
    }

    /**
     * @param {string} text
     * @param {string} persona
     * @param {{en?: string, ja?: string}} [voices] - optional per-character
     *   voice override (full Edge-TTS neural voice names). Omit a key to use
     *   the backend's default voice for that language.
     * @param {string} [characterName] - the currently-selected AVATAR's name.
     *   The backend uses this for the LLM's self-identification, so picking
     *   a scenario (Tutor/Business/Casual) only changes personality/
     *   background/voice — whichever character is actually on screen still
     *   answers as itself.
     */
    async ask(text, persona, voices = {}, characterName = null, cultureMode = 'uganda') {
        const res = await fetch(`${this.backend}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text, persona,
                character_name: characterName || null,
                voice_en: voices.en || null,
                voice_ja: voices.ja || null,
                culture_mode: cultureMode || 'uganda',
            }),
        });
        if (!res.ok) throw new Error(`Backend /ask failed (${res.status})`);
        return res.json();
    }

    async translate(text, target = 'ja') {
        const res = await fetch(`${this.backend}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, target }),
        });
        if (!res.ok) throw new Error(`Backend /translate failed (${res.status})`);
        return res.json();
    }

    /** { catalog: { en: [{name,label}], ja: [{name,label}] }, default_en, default_ja } */
    async voices() {
        const res = await fetch(`${this.backend}/voices`);
        if (!res.ok) throw new Error(`Backend /voices failed (${res.status})`);
        return res.json();
    }

    async reset() {
        try { await fetch(`${this.backend}/reset`, { method: 'POST' }); } catch (_) {}
    }

    /** TTS for live meeting avatar interpreter. */
    async voice(text, voice = 'en-US', culture = 'en') {
        const res = await fetch(`${this.backend}/voice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice, culture }),
        });
        if (!res.ok) throw new Error(`Backend /voice failed (${res.status})`);
        return res.json();
    }

    /** Upload a document for AI analysis — same behavior JSON as /ask. */
    async analyzeFile(file, { persona, characterName, voices = {}, cultureMode = 'uganda' } = {}) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('persona', persona || 'FirstMeeting');
        if (characterName) fd.append('character_name', characterName);
        if (voices.en) fd.append('voice_en', voices.en);
        if (voices.ja) fd.append('voice_ja', voices.ja);
        fd.append('culture_mode', cultureMode || 'uganda');

        const res = await fetch(`${this.backend}/analyze-file`, { method: 'POST', body: fd });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Upload failed (${res.status})`);
        }
        return res.json();
    }

    /** Offline fallback behavior so the avatar still reacts without a backend. */
    offlineBehavior(text, persona) {
        return {
            reply: `(offline) I heard: "${text}". Start the backend to enable the AI.`,
            translated_reply: '',
            romanization: '',
            expression: 'thinking',
            gesture: 'explain',
            animation: 'explain',
            voice: persona === 'JapanPrep' ? 'ja-JP' : 'en-US',
            background: 'classroom',
            primary: persona === 'JapanPrep' ? 'ja' : 'en',
            audio_url_en: '', audio_url_ja: '', audio_url: '',
            visemes_en: [], visemes_ja: [], visemes: [],
        };
    }
}