import * as THREE from 'three';

/** Target standing height in scene units — tuned for Genies-style waist-up framing. */
const TARGET_HEIGHT = 1.38;

/**
 * Normalizes different VRM exports to a consistent on-screen size and
 * grounds feet at y=0. Uses skeleton bones (foot → head) so hair spikes
 * and T-pose arm spread do not skew height.
 */
export class AvatarScale {
    static measureHeight(vrm) {
        const humanoid = vrm?.humanoid;
        if (humanoid) {
            const foot = humanoid.getNormalizedBoneNode('leftFoot')
                || humanoid.getNormalizedBoneNode('rightFoot');
            const head = humanoid.getNormalizedBoneNode('head');
            if (foot && head) {
                vrm.scene.updateMatrixWorld(true);
                const footPos = new THREE.Vector3();
                const headPos = new THREE.Vector3();
                foot.getWorldPosition(footPos);
                head.getWorldPosition(headPos);
                const legToHead = Math.abs(headPos.y - footPos.y);
                if (legToHead > 0.5) return legToHead + 0.14;
            }
        }
        const box = new THREE.Box3().setFromObject(vrm.scene);
        return box.getSize(new THREE.Vector3()).y;
    }

    static ground(vrm) {
        vrm.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(vrm.scene);
        vrm.scene.position.y -= box.min.y;
    }

    static apply(vrm, { heightScale = 1, buildScale = 1 } = {}) {
        if (!vrm?.scene) return { norm: 1 };

        vrm.scene.scale.set(1, 1, 1);
        vrm.scene.position.set(0, 0, 0);
        vrm.scene.updateMatrixWorld(true);

        const rawHeight = this.measureHeight(vrm);
        const norm = rawHeight > 0.01 ? TARGET_HEIGHT / rawHeight : 1;

        const sx = norm * buildScale;
        const sy = norm * heightScale;
        const sz = norm * buildScale;
        vrm.scene.scale.set(sx, sy, sz);
        this.ground(vrm);

        vrm.userData = vrm.userData || {};
        vrm.userData.avatarScale = { norm, sx, sy, sz, heightScale, buildScale };

        return { norm, sx, sy, sz };
    }

    /** Apply studio height/build on top of normalized base scale. */
    static applyProportions(vrm, heightScale = 1, buildScale = 1) {
        const base = vrm?.userData?.avatarScale?.norm ?? 1;
        const sx = base * buildScale;
        const sy = base * heightScale;
        const sz = base * buildScale;
        vrm.scene.scale.set(sx, sy, sz);
        this.ground(vrm);
        if (vrm.userData?.avatarScale) {
            vrm.userData.avatarScale.sx = sx;
            vrm.userData.avatarScale.sy = sy;
            vrm.userData.avatarScale.sz = sz;
            vrm.userData.avatarScale.heightScale = heightScale;
            vrm.userData.avatarScale.buildScale = buildScale;
        }
    }
}
