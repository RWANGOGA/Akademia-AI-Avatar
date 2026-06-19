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
                    console.error('Avatar load error:', error);
                    reject(error);
                }
            );
        });
    }
}
