/**
 * PersonaSystem — who the avatar represents.
 *
 * A persona is more than appearance: name, culture, language, personality,
 * background and voice. The persona key (Tutor/Business/Casual) is sent to the
 * backend, which holds the matching system prompt and voice.
 */
export const PERSONAS = {
    Tutor: {
        key: 'Tutor',
        name: 'Kwame',
        handle: '@kwame_ug',
        culture: 'en',
        language: 'English',
        personality: 'friendly tutor',
        background: 'classroom',
        voice: 'en-US',
        bio: 'Friendly bilingual tutor for English and Japanese.',
    },
    Business: {
        key: 'Business',
        name: 'Amara',
        handle: '@amara_corp',
        culture: 'en',
        language: 'English',
        personality: 'professional assistant',
        background: 'office',
        voice: 'en-US',
        bio: 'Professional assistant for bilingual business communication.',
    },
    Casual: {
        key: 'Casual',
        name: 'Yuki',
        handle: '@yuki_jp',
        culture: 'ja',
        language: 'Japanese',
        personality: 'polite, warm companion',
        background: 'lounge',
        voice: 'ja-JP',
        bio: 'Warm Japanese companion for everyday conversation.',
    },
};

export class PersonaSystem {
    constructor(initial = 'Tutor') {
        this.current = PERSONAS[initial] ? initial : 'Tutor';
    }

    get persona() {
        return PERSONAS[this.current];
    }

    set(key) {
        if (PERSONAS[key]) this.current = key;
        return this.persona;
    }

    list() {
        return Object.values(PERSONAS);
    }
}
