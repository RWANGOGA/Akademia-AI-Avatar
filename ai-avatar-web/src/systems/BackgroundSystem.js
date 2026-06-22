/**
 * BackgroundSystem — the world the avatar lives in.
 *
 * Each world has a visual (image or gradient) and a mood. If a real photo
 * exists under /assets/backgrounds it is used. If not (the common case —
 * that folder is empty until you add files), a small hand-built SVG scene
 * is used instead so the avatar isn't standing in front of a flat gradient.
 * Drop a real .jpg with the matching name into public/assets/backgrounds/
 * at any time and it will automatically take over — no code changes needed.
 */
const SCENES = {
    classroom: svgScene('#16223b', '#080c14', `
        <rect x="60" y="40" width="260" height="150" rx="6" fill="#0c1322" stroke="#2a3a5c" stroke-width="3"/>
        <rect x="80" y="58" width="220" height="118" rx="2" fill="#0f1a2e"/>
        <line x1="100" y1="80" x2="220" y2="80" stroke="#5b7fb8" stroke-width="2" opacity="0.5"/>
        <line x1="100" y1="100" x2="260" y2="100" stroke="#5b7fb8" stroke-width="2" opacity="0.4"/>
        <line x1="100" y1="120" x2="190" y2="120" stroke="#5b7fb8" stroke-width="2" opacity="0.4"/>
        <rect x="500" y="0" width="180" height="300" fill="#0e1b30" opacity="0.55"/>
        <rect x="520" y="30" width="60" height="90" fill="#1c2b4a" opacity="0.7"/>
        <rect x="600" y="30" width="60" height="90" fill="#223457" opacity="0.6"/>
    `),
    office: svgScene('#240e0e', '#0c0707', `
        <rect x="450" y="0" width="260" height="320" fill="#150a0a" opacity="0.6"/>
        ${gridWindows(465, 16, 7, 5, 28, 30, '#5c2a2a')}
        <rect x="40" y="190" width="160" height="14" rx="4" fill="#1e0f0f"/>
        <rect x="55" y="120" width="130" height="72" rx="4" fill="#180c0c" stroke="#3a1c1c" stroke-width="2"/>
        <circle cx="220" cy="90" r="26" fill="#3a1a1a" opacity="0.5"/>
    `),
    lounge: svgScene('#0e2215', '#050c08', `
        <polygon points="0,300 0,150 70,150 90,110 140,150 190,140 220,170 280,150 320,160 360,140 400,170 400,300" fill="#081008" opacity="0.7"/>
        ${gridWindows(40, 130, 5, 3, 16, 16, '#e8c27a', 0.25)}
        ${gridWindows(180, 110, 4, 4, 14, 14, '#e8c27a', 0.2)}
        <rect x="470" y="210" width="220" height="60" rx="18" fill="#15301f"/>
        <rect x="470" y="195" width="220" height="22" rx="11" fill="#1c3a26"/>
    `),
    tokyo: svgScene('#1a1030', '#0a0714', `
        <rect x="0" y="0" width="200" height="320" fill="#0d0820" opacity="0.8"/>
        <rect x="220" y="40" width="160" height="280" fill="#100a26" opacity="0.8"/>
        <rect x="420" y="-10" width="200" height="330" fill="#0d0820" opacity="0.85"/>
        ${gridWindows(20, 30, 4, 9, 12, 16, '#ff6fae', 0.5)}
        ${gridWindows(440, 20, 4, 10, 12, 18, '#5fe1ff', 0.45)}
        <rect x="240" y="70" width="120" height="26" rx="3" fill="#ff3d8b" opacity="0.85"/>
        <rect x="248" y="78" width="100" height="10" fill="#2a0a1c" opacity="0.4"/>
    `),
};

function gridWindows(x0, y0, cols, rows, w, h, color, op = 0.6) {
    let out = '';
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const lit = Math.random() > 0.35;
            out += `<rect x="${x0 + c * (w + 8)}" y="${y0 + r * (h + 8)}" width="${w}" height="${h}" fill="${color}" opacity="${lit ? op : op * 0.15}"/>`;
        }
    }
    return out;
}

function svgScene(c1, c2, shapes) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 320" preserveAspectRatio="xMidYMax slice">
        <defs>
          <radialGradient id="bg" cx="50%" cy="30%" r="75%">
            <stop offset="0%" stop-color="${c1}"/>
            <stop offset="55%" stop-color="${c2}"/>
            <stop offset="100%" stop-color="#020203"/>
          </radialGradient>
        </defs>
        <rect width="700" height="320" fill="url(#bg)"/>
        ${shapes}
        <rect width="700" height="320" fill="#000" opacity="0.18"/>
      </svg>`;
    const encoded = encodeURIComponent(svg.replace(/\s+/g, ' '));
    return `linear-gradient(rgba(0,0,0,0.15), rgba(0,0,0,0.55)), url("data:image/svg+xml,${encoded}") center bottom/cover no-repeat, radial-gradient(ellipse 80% 55% at 50% 38%, ${c1} 0%, ${c2} 50%, #020204 100%)`;
}

export const WORLDS = {
    classroom: {
        name: 'Academic Classroom',
        image: '/assets/backgrounds/classroom.jpg',
        gradient: SCENES.classroom,
    },
    office: {
        name: 'Corporate Office',
        image: '/assets/backgrounds/office.jpg',
        gradient: SCENES.office,
    },
    lounge: {
        name: 'Urban Lounge',
        image: '/assets/backgrounds/lounge.jpg',
        gradient: SCENES.lounge,
    },
    tokyo: {
        name: 'Tokyo Street',
        image: '/assets/backgrounds/tokyo.jpg',
        gradient: SCENES.tokyo,
    },
};

export class BackgroundSystem {
    constructor(elementId = 'scene-bg') {
        this.el = document.getElementById(elementId);
    }

    load(worldKey) {
        const world = WORLDS[worldKey] || WORLDS.classroom;
        if (!this.el) return world;

        // Try the real photo first, fall back to the generated scene if it
        // is missing (404 -> onerror -> generated SVG scene).
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