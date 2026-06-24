/**
 * PersonaSystem — cultural learning scenarios for Uganda ↔ Japan.
 *
 * Each scenario sets background, focus topic, and backend persona key.
 */
export const PERSONAS = {
    FirstMeeting: {
        key: 'FirstMeeting',
        name: 'First Meeting in Kampala',
        culture: 'en',
        language: 'English',
        personality: 'Ugandan business etiquette',
        background: 'office',
        voice: 'en-US',
        bio: 'Learn greetings, elders-first protocol, and warm introductions.',
        thumb: '/assets/thumbs/scenario-office.svg',
    },
    Negotiation: {
        key: 'Negotiation',
        name: 'Negotiation & Trust',
        culture: 'en',
        language: 'English',
        personality: 'relationship-first deal-making',
        background: 'office',
        voice: 'en-US',
        bio: 'Relationship before contracts, silence, and communal decisions.',
        thumb: '/assets/thumbs/scenario-office.svg',
    },
    SocialMeal: {
        key: 'SocialMeal',
        name: 'Social Meal & Hospitality',
        culture: 'en',
        language: 'English',
        personality: 'food and social customs',
        background: 'lounge',
        voice: 'en-US',
        bio: 'Matooke, Rolex, accepting food, and bonding over meals.',
        thumb: '/assets/thumbs/scenario-lounge.svg',
    },
    MarketVisit: {
        key: 'MarketVisit',
        name: 'Market Visit',
        culture: 'en',
        language: 'English',
        personality: 'market culture guide',
        background: 'market',
        voice: 'en-US',
        bio: 'Bargaining respectfully in Kampala markets like Owino.',
        thumb: '/assets/thumbs/scenario-office.svg',
    },
    PreTrip: {
        key: 'PreTrip',
        name: 'Pre-Trip Briefing',
        culture: 'en',
        language: 'English',
        personality: 'investor travel coach',
        background: 'classroom',
        voice: 'en-US',
        bio: 'Visa, health, packing, and day-one cultural mistakes to avoid.',
        thumb: '/assets/thumbs/scenario-classroom.svg',
    },
    JapanPrep: {
        key: 'JapanPrep',
        name: 'Meeting Japanese Partners',
        culture: 'ja',
        language: 'Japanese',
        personality: 'Japanese business etiquette for Ugandan partners',
        background: 'tokyo',
        voice: 'ja-JP',
        bio: 'Meishi, punctuality, and what Japanese investors expect.',
        thumb: '/assets/thumbs/scenario-tokyo.svg',
    },
};

/** Map legacy keys from older builds. */
const LEGACY = {
    Tutor: 'FirstMeeting',
    Business: 'Negotiation',
    Casual: 'SocialMeal',
};

export class PersonaSystem {
    constructor(initial = 'FirstMeeting') {
        const key = LEGACY[initial] || initial;
        this.current = PERSONAS[key] ? key : 'FirstMeeting';
    }

    get persona() {
        return PERSONAS[this.current];
    }

    set(key) {
        const resolved = LEGACY[key] || key;
        if (PERSONAS[resolved]) this.current = resolved;
        return this.persona;
    }

    list() {
        return Object.values(PERSONAS);
    }
}
