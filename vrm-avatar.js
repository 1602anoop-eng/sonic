// 3D VRM avatar using three.js and @pixiv/three-vrm (loaded from the CDN via the importmap in index.html).
// Emotions use the model's own VRM expressions (happy, angry, sad, surprised, relaxed).
// Mouth opens on each spoken word through the 'aa' mouth expression.
// Lip-sync is word-based, not phoneme-accurate.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// Our emotion name -> VRM expression name (null means no expression)
const EXPRESSION_FOR = {
  neutral: null,
  happy: 'happy',
  excited: 'happy',
  sad: 'sad',
  angry: 'angry',
  surprised: 'surprised',
  confused: 'surprised',
  thinking: 'relaxed',
  focused: 'relaxed'
};
const BLEND_NAMES = ['happy', 'angry', 'sad', 'surprised', 'relaxed'];

export class VrmAvatar {
  constructor(canvas) {
    this.canvas = canvas;
    this.loaded = false;
    this.vrm = null;
    this.state = 'idle';
    this.emotion = null;
    this.expression = 'auto';
    this.pulseAmt = 0;
    this.open = 0;
    this.weights = {};
    this.blinkStart = -10;
    this.nextBlink = 2;

    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.pivot = new THREE.Group(); // used for a gentle sway
    this.scene.add(this.pivot);

    this.camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20);
    this.camera.position.set(0, 1.3, 2.6);
    this.camera.lookAt(0, 1.2, 0);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 1.5, 2);
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));

    this.clock = new THREE.Clock();
    this.resize();
    this.loop();
  }

  // Loads a .vrm file (Blob). Replaces any model that was loaded before.
  async load(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('Ye file VRM format mein nahi hai');

      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      if (vrm.meta?.metaVersion === '0') VRMUtils.rotateVRM0(vrm); // VRM 0.x models face the other way

      if (this.vrm) this.pivot.remove(this.vrm.scene);
      this.vrm = vrm;
      this.pivot.add(vrm.scene);
      this.loaded = true;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  update(s) {
    this.expression = s.expression;
    this.reduced = s.reducedMotion;
    this.resize();
  }

  setState(s) { this.state = s; }

  setEmotion(name) { this.emotion = name || null; }

  pulse() { this.pulseAmt = 1; }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return; // hidden canvas
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  pickEmotion() {
    if (this.expression !== 'auto') return this.expression;
    if (this.state === 'thinking') return 'thinking';
    if (this.state === 'error') return 'confused';
    if (this.state === 'listening') return 'neutral';
    if (this.emotion) return this.emotion;
    return 'neutral';
  }

  loop() {
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    if (this.vrm) {
      this.animate(dt, t);
      this.renderer.render(this.scene, this.camera);
    }
    requestAnimationFrame(() => this.loop());
  }

  animate(dt, t) {
    const em = this.vrm.expressionManager;
    const wanted = EXPRESSION_FOR[this.pickEmotion()] || null;

    // Emotions: blend each VRM expression toward its target
    for (const name of BLEND_NAMES) {
      const goal = name === wanted ? 0.9 : 0;
      const w = this.weights[name] || 0;
      this.weights[name] = w + (goal - w) * 0.1;
      em?.setValue(name, this.weights[name]);
    }

    // Mouth: opens on each spoken word
    this.pulseAmt *= 0.88;
    const base = this.state === 'speaking'
      ? 0.1 + 0.6 * this.pulseAmt + 0.1 * Math.abs(Math.sin(t * 8))
      : 0;
    this.open += (base - this.open) * 0.35;
    em?.setValue('aa', Math.min(1, this.open));

    // Blink
    if (!this.reduced && t > this.nextBlink) {
      this.blinkStart = t;
      this.nextBlink = t + 2.5 + Math.random() * 3;
    }
    const bt = t - this.blinkStart;
    em?.setValue('blink', !this.reduced && bt < 0.2 ? Math.sin((Math.PI * bt) / 0.2) : 0);

    // Gentle sway
    this.pivot.rotation.y = this.reduced ? 0 : Math.sin(t * 0.5) * 0.05;

    this.vrm.update(dt);
  }
}
