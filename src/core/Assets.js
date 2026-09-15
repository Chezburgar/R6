import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Central asset cache. Every operator/weapon GLB is loaded once; characters are
// SkeletonUtils clones sharing geometry + textures, weapons share geometry.
class AssetsClass {
  constructor() {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.gltf = new Map();      // key -> gltf
    this.progress = { done: 0, total: 0, status: '' };
    this.onProgress = null;
  }

  async loadAll(manifest) {
    const entries = Object.entries(manifest);
    this.progress.total = entries.length;
    this.progress.done = 0;
    // Load in small parallel batches so the progress bar moves and the GPU upload is staggered.
    const batch = 3;
    for (let i = 0; i < entries.length; i += batch) {
      await Promise.all(entries.slice(i, i + batch).map(async ([key, url]) => {
        this.progress.status = key.toUpperCase();
        try {
          const g = await this.loader.loadAsync(url);
          this._prepare(key, g);
          this.gltf.set(key, g);
        } catch (e) {
          console.error('Failed to load', key, url, e);
        }
        this.progress.done++;
        this.onProgress && this.onProgress(this.progress);
      }));
    }
  }

  _prepare(key, g) {
    g.scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = true;
        const m = o.material;
        if (m) {
          if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = 8; }
          if (m.metalnessMap) m.metalnessMap.anisotropy = 4;
          if (m.normalMap) m.normalMap.anisotropy = 8;
          // Meshy bakes fairly hot metallic values; tame them so cloth doesn't look like chrome.
          if (key.startsWith('op_')) { m.metalness = 0.35; m.roughness = 1.0; m.envMapIntensity = 0.6; }
          else { m.metalness = 1.0; m.roughness = 1.0; m.envMapIntensity = 0.9; }
          m.side = THREE.FrontSide;
        }
      }
    });
  }

  has(key) { return this.gltf.has(key); }
  get(key) { return this.gltf.get(key); }

  // Deep clone with skinning preserved (operators).
  cloneSkinned(key) {
    const g = this.gltf.get(key);
    if (!g) return null;
    const scene = SkeletonUtils.clone(g.scene);
    return { scene, animations: g.animations };
  }

  // Shallow clone sharing geometry (weapons, props).
  cloneStatic(key, cloneMaterial = false) {
    const g = this.gltf.get(key);
    if (!g) return null;
    const scene = g.scene.clone(true);
    if (cloneMaterial) scene.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
    return scene;
  }
}

export const Assets = new AssetsClass();
