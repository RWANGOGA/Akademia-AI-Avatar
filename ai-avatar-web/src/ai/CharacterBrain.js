/**
 * CharacterBrain — the frontend's connection to the AI backend (the brain).
 *
 * It does not think on its own; it asks the backend, which calls ChatGPT and
 * returns a single behavior JSON (reply + emotion + gesture + voice + visemes).
 * If the backend is unreachable it returns a safe offline behavior so the UI
 * never hard-crashes.
 */
export class CharacterBrain {
    constructor(backendUrl = '') {
        this.backend = backendUrl;
    }

    async ask(text, persona) {
        const res = await fetch(`${this.backend}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, persona }),
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

    async reset() {
        try { await fetch(`${this.backend}/reset`, { method: 'POST' }); } catch (_) {}
    }

    /** Offline fallback behavior so the avatar still reacts without a backend. */
    offlineBehavior(text, persona) {
        return {
            reply: `(offline) I heard: "${text}". Start the backend to enable ChatGPT.`,
            translated_reply: '',
            romanization: '',
            expression: 'thinking',
            gesture: 'explain',
            voice: persona === 'Casual' ? 'ja-JP' : 'en-US',
            background: 'classroom',
            primary: persona === 'Casual' ? 'ja' : 'en',
            audio_url_en: '', audio_url_ja: '', audio_url: '',
            visemes_en: [], visemes_ja: [], visemes: [],
        };
    }
}
