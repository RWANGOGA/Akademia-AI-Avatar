import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * AvatarManager — loads and positions the avatar body.
 * It only manages the model. It does NOT handle emotions, gestures or speech.
 */
export class AvatarManager {
    constructor(scene) {
        this.scene = scene;
        this.currentAvatar = null;
        this.loader = new GLTFLoader();
        this.loader.register((parser) => new VRMLoaderPlugin(parser));
    }

    get vrm() {
        return this.currentAvatar;
    }

    _removeCurrent() {
        if (!this.currentAvatar) return;
        if (this.currentAvatar.scene) this.scene.remove(this.currentAvatar.scene);
        if (this.currentAvatar.dispose) {
            try { this.currentAvatar.dispose(); } catch (_) {}
        } else if (this.currentAvatar.scene) {
            VRMUtils.deepDispose(this.currentAvatar.scene);
        }
        this.currentAvatar = null;
    }

    async loadAvatar(url) {
        this._removeCurrent();

        return new Promise((resolve, reject) => {
            this.loader.load(
                url,
                (gltf) => {
                    const vrm = gltf.userData.vrm;

                    if (vrm) {
                        // VRM avatar (VRoid style)
                        VRMUtils.rotateVRM0(vrm);
                        vrm.scene.traverse((obj) => {
                            obj.frustumCulled = false;
                            obj.castShadow = true;
                        });
                        vrm.scene.position.set(0, 0, 0);
                        vrm.scene.scale.set(1, 1, 1);
                        this.scene.add(vrm.scene);
                        this.currentAvatar = vrm;
                        console.log('VRM avatar loaded:', url);
                        resolve(vrm);
                    } else {
                        // Standard GLB avatar (Ready Player Me style)
                        gltf.scene.rotation.y = Math.PI;
                        gltf.scene.position.set(0, -1, 0);
                        gltf.scene.traverse((obj) => {
                            obj.frustumCulled = false;
                            obj.castShadow = true;
                        });
                        this.scene.add(gltf.scene);

                        // Wrap GLB so the rest of the app treats it like a VRM.
                        const wrapper = {
                            scene: gltf.scene,
                            humanoid: null,
                            expressionManager: null,
                            isGLB: true,
                            update: () => {},
                            dispose: () => VRMUtils.deepDispose(gltf.scene),
                        };
                        this.currentAvatar = wrapper;
                        console.log('GLB avatar loaded:', url);
                        resolve(wrapper);
                    }
                },
                (xhr) => {
                    if (xhr.total) {
                        const pct = Math.round((xhr.loaded / xhr.total) * 100);
                        console.log(`Loading avatar: ${pct}%`);
                    }
                },
                (error) => {
                    const raw = (error && error.message) || String(error);
                    // The browser tried to parse an HTML 404/proxy page as a
                    // binary model — this means the .vrm/.glb file simply
                    // does not exist at that path on the server.
                    const friendly = /Unexpected token|JSON|DOCTYPE/i.test(raw)
                        ? `Avatar file not found at "${url}" (server returned a web page instead of a model). Check that the file exists under public${url}.`
                        : `Avatar load error for "${url}": ${raw}`;
                    console.error(friendly, error);
                    reject(new Error(friendly));
                }
            );
        });
    }

    /**
     * Best-effort visual customization for the in-page Avatar Creator.
     *
     * - `heightScale` / `buildScale`: REAL, always-works body-proportion
     *   controls. `heightScale` scales the whole rig vertically (taller /
     *   shorter); `buildScale` scales it horizontally (broader / slimmer
     *   silhouette). This is a simple, robust approximation of "body
     *   proportions" — it can't reshape individual bones like shoulder
     *   width without knowing that specific rig's local bone axes (every
     *   VRM file can differ), but uniform height/build scaling works
     *   correctly on ANY VRM file, which a guessed per-bone scale would not.
     * - `hairColor` / `clothColor`: tints any material whose name contains
     *   "hair" / "cloth" | "outfit" | "costume". VRoid Studio exports
     *   usually name materials this way, but this is heuristic — not every
     *   VRM file will have materials that match, so treat it as best
     *   effort, not guaranteed.
     */
    applyCustomization(vrm, { hairColor, clothColor, skinColor, heightScale, buildScale } = {}) {
        if (!vrm || !vrm.scene) return;

        const h = heightScale || 1;
        const b = buildScale || 1;
        vrm.scene.scale.set(b, h, b);

        if (!hairColor && !clothColor && !skinColor) return;

        const tint = (material, hex) => {
            try {
                if (material && material.color && material.color.isColor) {
                    material.color.set(hex);
                }
            } catch (_) { /* non-tintable material, skip */ }
        };

        vrm.scene.traverse((obj) => {
            const mats = obj.material
                ? (Array.isArray(obj.material) ? obj.material : [obj.material])
                : [];
            mats.forEach((m) => {
                if (!m) return;
                const n = (m.name || '').toLowerCase();
                if (hairColor && n.includes('hair')) tint(m, hairColor);
                if (clothColor && (n.includes('cloth') || n.includes('outfit') || n.includes('costume') || n.includes('body_clothes'))) tint(m, clothColor);
                if (skinColor && (n.includes('skin') || n.includes('face'))) tint(m, skinColor);
            });
        });
    }
}