/**
 * BackgroundSystem — the world the avatar lives in.
 *
 * Each world has a visual (image or gradient) and a mood. If an image file
 * exists under /assets/backgrounds it is used; otherwise a themed gradient is
 * applied as a graceful fallback.
 */
export const WORLDS = {
    classroom: {
        name: 'Academic Classroom',
        image: '/assets/backgrounds/classroom.jpg',
        gradient: 'radial-gradient(ellipse 80% 55% at 50% 38%, #16223b 0%, #080c14 50%, #020204 100%)',
    },
    office: {
        name: 'Corporate Office',
        image: '/assets/backgrounds/office.jpg',
        gradient: 'radial-gradient(ellipse 80% 55% at 50% 38%, #240e0e 0%, #0c0707 50%, #020202 100%)',
    },
    lounge: {
        name: 'Urban Lounge',
        image: '/assets/backgrounds/lounge.jpg',
        gradient: 'radial-gradient(ellipse 80% 55% at 50% 38%, #0e2215 0%, #050c08 50%, #020302 100%)',
    },
    tokyo: {
        name: 'Tokyo Street',
        image: '/assets/backgrounds/tokyo.jpg',
        gradient: 'radial-gradient(ellipse 80% 55% at 50% 38%, #1a1030 0%, #0a0714 50%, #020204 100%)',
    },
};

export class BackgroundSystem {
    constructor(elementId = 'scene-bg') {
        this.el = document.getElementById(elementId);
    }

    load(worldKey) {
        const world = WORLDS[worldKey] || WORLDS.classroom;
        if (!this.el) return world;

        // Try the image, fall back to the themed gradient if it is missing.
        const img = new Image();
        img.onload = () => {
            this.el.style.background =
                `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.55)), url("${world.image}") center/cover`;
        };
        img.onerror = () => { this.el.style.background = world.gradient; };
        this.el.style.background = world.gradient;
        img.src = world.image;
        return world;
    }
}
