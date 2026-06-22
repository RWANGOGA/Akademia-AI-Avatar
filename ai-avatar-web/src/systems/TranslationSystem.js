/**
 * TranslationSystem — thin helper over the backend /translate endpoint.
 * Used for ad-hoc EN<->JA translation outside the main /ask pipeline.
 */
export class TranslationSystem {
    constructor(brain) {
        this.brain = brain;
    }

    async toJapanese(text) {
        const r = await this.brain.translate(text, 'ja');
        return { text: r.text, romanization: r.romanization || '' };
    }

    async toEnglish(text) {
        const r = await this.brain.translate(text, 'en');
        return { text: r.text };
    }
}
