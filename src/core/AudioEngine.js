import * as THREE from 'three';

// Procedural audio. No sample files: every sound is synthesised from noise, oscillators,
// filters and a generated convolution reverb, then spatialised with HRTF panning.
// Gunshots are layered (supersonic crack / muzzle blast body / low thump / mechanical
// action / reverb tail) and are low-passed + delayed by distance (speed of sound).

const SPEED_OF_SOUND = 343;

function makeNoiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function makeImpulse(ctx, seconds, decay, lp = 0.3, early = true) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let f = 0; const coef = lp;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      let s = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      // progressively darker tail
      f += (s - f) * (coef + (1 - coef) * (1 - t) * 0.6);
      d[i] = f * 0.6;
    }
    if (early) {
      // a few discrete early reflections
      for (let k = 0; k < 6; k++) {
        const at = Math.floor(ctx.sampleRate * (0.012 + k * 0.011 + Math.random() * 0.006));
        const g = 0.5 - k * 0.07;
        for (let i = 0; i < 200 && at + i < n; i++) d[at + i] += (Math.random() * 2 - 1) * g * (1 - i / 200);
      }
    }
  }
  return b;
}

class AudioEngineClass {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volumes = { master: 0.8, sfx: 1, ui: 0.7, ambience: 0.6 };
    this.listenerPos = new THREE.Vector3();
    this.listenerFwd = new THREE.Vector3(0, 0, -1);
    this.listenerUp = new THREE.Vector3(0, 1, 0);
    this.losCheck = null;    // (pos) => boolean, provided by the game for occlusion
    this.interior = false;   // listener indoors → longer tails
    this._recent = [];
    this._ambient = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.volumes.master;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 18; this.comp.ratio.value = 6; this.comp.attack.value = 0.002; this.comp.release.value = 0.18;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.master.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = this.volumes.ui; this.ui.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = this.volumes.ambience; this.amb.connect(this.master);
    // reverbs
    this.revRoom = ctx.createConvolver(); this.revRoom.buffer = makeImpulse(ctx, 0.9, 3.2, 0.25);
    this.revHall = ctx.createConvolver(); this.revHall.buffer = makeImpulse(ctx, 2.4, 2.2, 0.12);
    this.revRoomGain = ctx.createGain(); this.revRoomGain.gain.value = 0.55; this.revRoom.connect(this.revRoomGain); this.revRoomGain.connect(this.sfx);
    this.revHallGain = ctx.createGain(); this.revHallGain.gain.value = 0.5; this.revHall.connect(this.revHallGain); this.revHallGain.connect(this.sfx);
    this.noise = makeNoiseBuffer(ctx, 2);
    this.noiseLong = makeNoiseBuffer(ctx, 6);
    if (ctx.listener.forwardX) { ctx.listener.forwardZ.value = -1; ctx.listener.upY.value = 1; }
    this.ready = true;
  }

  setVolume(k, v) { this.volumes[k] = v; if (!this.ctx) return; ({ master: this.master, sfx: this.sfx, ui: this.ui, ambience: this.amb })[k].gain.value = v; }

  updateListener(pos, fwd, up) {
    if (!this.ctx) return;
    this.listenerPos.copy(pos); this.listenerFwd.copy(fwd); this.listenerUp.copy(up);
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  // --- building blocks -----------------------------------------------------
  _noiseSrc(long = false) { const s = this.ctx.createBufferSource(); s.buffer = long ? this.noiseLong : this.noise; s.loop = true; s.loopStart = Math.random() * 1.5; return s; }
  _env(node, t0, attack, peak, decay, tail = 0.0001) {
    const g = node.gain; g.cancelScheduledValues(t0); g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + attack); g.exponentialRampToValueAtTime(tail, t0 + attack + decay);
  }
  _filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  // Output stage for a positional sound: panner + distance gain + distance/occlusion low-pass.
  // Returns {input, when} where `when` is the scheduled start time (delayed by distance).
  _spatial(pos, opts = {}) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!pos) { const g = ctx.createGain(); g.gain.value = opts.gain !== undefined ? opts.gain : 1; g.connect(opts.bus || this.sfx); return { input: g, when: now, dist: 0, occluded: false }; }
    const d = pos.distanceTo(this.listenerPos);
    const maxD = opts.maxDist || 90;
    if (d > maxD) return null;
    const occluded = this.losCheck ? !this.losCheck(pos) : false;
    const ref = opts.ref || 6;
    let gain = 1 / (1 + Math.pow(d / ref, 1.35));
    if (occluded) gain *= opts.occlusionGain !== undefined ? opts.occlusionGain : 0.45;
    gain *= opts.gain !== undefined ? opts.gain : 1;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'linear'; panner.refDistance = 1; panner.maxDistance = 10000; panner.rolloffFactor = 0;
    panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z;
    const lp = this._filter('lowpass', 1, 0.5);
    let cutoff = 14000 * Math.max(0.06, 1 - d / (maxD * 0.95)) + 500;
    if (occluded) cutoff *= 0.35;
    lp.frequency.value = Math.min(18000, cutoff);
    const g = ctx.createGain(); g.gain.value = gain;
    g.connect(lp); lp.connect(panner); panner.connect(opts.bus || this.sfx);
    const when = now + (opts.noDelay ? 0 : d / SPEED_OF_SOUND);
    return { input: g, when, dist: d, occluded, gain };
  }

  _reverbSend(input, amount, hall = false) {
    const s = this.ctx.createGain(); s.gain.value = amount; input.connect(s); s.connect(hall ? this.revHall : this.revRoom);
  }

  // --- gunshots ------------------------------------------------------------
  // profile: { cal: '556'|'9mm'|'12ga'|'45'|'762', loud: 1 }
  gunshot(profile, pos, firstPerson = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    // throttle: limit simultaneous distant shots
    const now = ctx.currentTime;
    this._recent = this._recent.filter(t => now - t < 0.03);
    if (this._recent.length > 6 && !firstPerson) return;
    this._recent.push(now);

    const P = GunProfiles[profile.cal] || GunProfiles['556'];
    const out = firstPerson ? { input: ctx.createGain(), when: now, dist: 0 } : this._spatial(pos, { ref: 9, maxDist: 120, gain: P.loud });
    if (!out) return;
    if (firstPerson) { out.input.gain.value = P.loud * 0.95; out.input.connect(this.sfx); }
    const t0 = out.when;
    const dist = out.dist || 0;
    const distMix = Math.min(1, dist / 45);   // far shots lose crack, keep boom

    // 1) supersonic crack / muzzle snap
    {
      const src = this._noiseSrc(); const hp = this._filter('highpass', P.crackHz, 0.7); const g = ctx.createGain();
      src.connect(hp); hp.connect(g); g.connect(out.input);
      this._env(g, t0, 0.0008, P.crack * (1 - distMix * 0.8), P.crackDecay);
      src.start(t0); src.stop(t0 + 0.3);
    }
    // 2) blast body
    {
      const src = this._noiseSrc(); const bp = this._filter('bandpass', P.bodyHz, 0.7); const g = ctx.createGain();
      src.connect(bp); bp.connect(g); g.connect(out.input);
      this._env(g, t0, 0.002, P.body, P.bodyDecay);
      src.start(t0); src.stop(t0 + 0.6);
      this._reverbSend(g, firstPerson ? (this.interior ? 0.35 : 0.2) : 0.5, !this.interior);
    }
    // 3) low thump
    {
      const o = ctx.createOscillator(); o.type = 'sine'; const g = ctx.createGain();
      o.frequency.setValueAtTime(P.thumpHz, t0); o.frequency.exponentialRampToValueAtTime(P.thumpHz * 0.35, t0 + P.thumpDecay);
      o.connect(g); g.connect(out.input);
      this._env(g, t0, 0.002, P.thump * (0.8 + distMix * 0.4), P.thumpDecay);
      o.start(t0); o.stop(t0 + P.thumpDecay + 0.1);
      const src = this._noiseSrc(); const lp = this._filter('lowpass', 220, 0.5); const g2 = ctx.createGain();
      src.connect(lp); lp.connect(g2); g2.connect(out.input);
      this._env(g2, t0, 0.003, P.thump * 0.9, P.thumpDecay * 1.4);
      src.start(t0); src.stop(t0 + 0.8);
      this._reverbSend(g2, 0.4, !this.interior);
    }
    // 4) mechanical action (bolt) — first person only, subtle
    if (firstPerson && P.mech) {
      const src = this._noiseSrc(); const bp = this._filter('bandpass', 2600, 2); const g = ctx.createGain();
      src.connect(bp); bp.connect(g); g.connect(out.input);
      this._env(g, t0 + P.mechAt, 0.001, P.mech, 0.018);
      src.start(t0 + P.mechAt); src.stop(t0 + P.mechAt + 0.08);
    }
    // 5) distant rumble tail for far shots
    if (dist > 25) {
      const src = this._noiseSrc(); const lp = this._filter('lowpass', 400, 0.6); const g = ctx.createGain();
      src.connect(lp); lp.connect(g); g.connect(out.input);
      this._env(g, t0 + 0.02, 0.01, 0.35 * distMix, 0.45);
      src.start(t0); src.stop(t0 + 0.7);
    }
  }

  // --- misc one-shots ------------------------------------------------------
  footstep(pos, surface = 'concrete', speed = 1, firstPerson = false) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const out = firstPerson ? { input: ctx.createGain(), when: ctx.currentTime } : this._spatial(pos, { ref: 3.5, maxDist: 34, gain: 1 });
    if (!out) return;
    if (firstPerson) { out.input.gain.value = 0.35; out.input.connect(this.sfx); }
    const t0 = out.when; const vol = 0.5 + 0.7 * speed;
    const S = Surfaces[surface] || Surfaces.concrete;
    // heel thud
    { const src = this._noiseSrc(); const lp = this._filter('lowpass', S.thudHz, 0.7); const g = ctx.createGain(); src.connect(lp); lp.connect(g); g.connect(out.input); this._env(g, t0, 0.002, S.thud * vol, S.thudDecay); src.start(t0); src.stop(t0 + 0.3); }
    // scuff / click
    { const src = this._noiseSrc(); const hp = this._filter(S.clickType, S.clickHz, 1.2); const g = ctx.createGain(); src.connect(hp); hp.connect(g); g.connect(out.input); this._env(g, t0 + 0.004, 0.001, S.click * vol, S.clickDecay); src.start(t0); src.stop(t0 + 0.25); }
    if (S.tone) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = S.tone; const g = ctx.createGain(); o.connect(g); g.connect(out.input); this._env(g, t0, 0.002, S.toneGain * vol, S.toneDecay); o.start(t0); o.stop(t0 + 0.3); }
    if (S.gravel) { for (let i = 0; i < 3; i++) { const src = this._noiseSrc(); const bp = this._filter('bandpass', 1800 + Math.random() * 1500, 2); const g = ctx.createGain(); src.connect(bp); bp.connect(g); g.connect(out.input); this._env(g, t0 + 0.01 + i * 0.02, 0.001, 0.25 * vol, 0.03); src.start(t0); src.stop(t0 + 0.2); } }
    this._reverbSend(out.input, this.interior ? 0.25 : 0.08, !this.interior);
  }

  click(type = 'ui') {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    if (type === 'hover') { const src = this._noiseSrc(); const bp = this._filter('bandpass', 3200, 4); const g = ctx.createGain(); src.connect(bp); bp.connect(g); g.connect(this.ui); this._env(g, t0, 0.001, 0.12, 0.02); src.start(t0); src.stop(t0 + 0.1); return; }
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = type === 'back' ? 520 : 760; const g = ctx.createGain(); o.connect(g); g.connect(this.ui); this._env(g, t0, 0.001, 0.06, 0.05); o.start(t0); o.stop(t0 + 0.12);
    const src = this._noiseSrc(); const bp = this._filter('bandpass', 2400, 3); const g2 = ctx.createGain(); src.connect(bp); bp.connect(g2); g2.connect(this.ui); this._env(g2, t0, 0.001, 0.1, 0.03); src.start(t0); src.stop(t0 + 0.1);
  }

  hitmarker(kill = false, headshot = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = headshot ? 2200 : 1500; const g = ctx.createGain(); o.connect(g); g.connect(this.ui);
    this._env(g, t0, 0.001, kill ? 0.22 : 0.14, kill ? 0.09 : 0.05); o.start(t0); o.stop(t0 + 0.2);
    const src = this._noiseSrc(); const hp = this._filter('highpass', 4000, 1); const g2 = ctx.createGain(); src.connect(hp); hp.connect(g2); g2.connect(this.ui); this._env(g2, t0, 0.001, 0.12, 0.02); src.start(t0); src.stop(t0 + 0.1);
    if (kill) { const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 1100; const g3 = ctx.createGain(); o2.connect(g3); g3.connect(this.ui); this._env(g3, t0 + 0.05, 0.001, 0.16, 0.12); o2.start(t0 + 0.05); o2.stop(t0 + 0.3); }
  }

  reload(kind, pos, firstPerson, duration) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const out = firstPerson ? { input: ctx.createGain(), when: ctx.currentTime } : this._spatial(pos, { ref: 3, maxDist: 20 });
    if (!out) return;
    if (firstPerson) { out.input.gain.value = 0.7; out.input.connect(this.sfx); }
    const t0 = out.when;
    const clank = (t, hz, q, peak, dec, type = 'bandpass') => { const src = this._noiseSrc(); const f = this._filter(type, hz, q); const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(out.input); this._env(g, t, 0.001, peak, dec); src.start(t); src.stop(t + dec + 0.1); };
    const tone = (t, hz, peak, dec) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz; const g = ctx.createGain(); o.connect(g); g.connect(out.input); this._env(g, t, 0.001, peak, dec); o.start(t); o.stop(t + dec + 0.05); };
    if (kind === 'shotgun') {
      // shells inserted one by one
      const n = Math.max(1, Math.round(duration / 0.55));
      for (let i = 0; i < n; i++) { const t = t0 + 0.25 + i * (duration - 0.4) / n; clank(t, 1400, 2, 0.5, 0.03); tone(t + 0.02, 900, 0.08, 0.05); clank(t + 0.06, 600, 1.5, 0.3, 0.05); }
      clank(t0 + duration - 0.12, 800, 1, 0.6, 0.06); clank(t0 + duration - 0.05, 1900, 2, 0.5, 0.04);
      return;
    }
    clank(t0 + 0.12, 700, 1, 0.55, 0.06); tone(t0 + 0.13, 240, 0.12, 0.08);           // mag release
    clank(t0 + 0.22, 1800, 3, 0.25, 0.05);                                             // mag slides out
    clank(t0 + duration * 0.55, 450, 0.8, 0.7, 0.07); tone(t0 + duration * 0.55, 180, 0.2, 0.09); // mag seated
    clank(t0 + duration * 0.62, 2200, 3, 0.3, 0.03);
    if (kind !== 'tactical') { clank(t0 + duration * 0.82, 2600, 2.5, 0.45, 0.03); clank(t0 + duration * 0.9, 1500, 1.5, 0.6, 0.05); tone(t0 + duration * 0.9, 320, 0.15, 0.07); } // charging handle
  }

  explosion(pos, size = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const out = this._spatial(pos, { ref: 14, maxDist: 200, gain: 1.4 * size, occlusionGain: 0.6 });
    if (!out) return;
    const t0 = out.when;
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(70, t0); sub.frequency.exponentialRampToValueAtTime(22, t0 + 1.1);
    const sg = ctx.createGain(); sub.connect(sg); sg.connect(out.input); this._env(sg, t0, 0.004, 1.0, 1.2); sub.start(t0); sub.stop(t0 + 1.4);
    const src = this._noiseSrc(true); const lp = this._filter('lowpass', 4000, 0.5); lp.frequency.setValueAtTime(5000, t0); lp.frequency.exponentialRampToValueAtTime(150, t0 + 1.2);
    const g = ctx.createGain(); src.connect(lp); lp.connect(g); g.connect(out.input); this._env(g, t0, 0.003, 1.2, 1.1); src.start(t0); src.stop(t0 + 1.5);
    const src2 = this._noiseSrc(); const hp = this._filter('highpass', 1800, 0.7); const g2 = ctx.createGain(); src2.connect(hp); hp.connect(g2); g2.connect(out.input); this._env(g2, t0, 0.001, 0.9, 0.08); src2.start(t0); src2.stop(t0 + 0.3);
    for (let i = 0; i < 9; i++) { const t = t0 + 0.25 + Math.random() * 1.1; const s = this._noiseSrc(); const bp = this._filter('bandpass', 500 + Math.random() * 2500, 3); const gg = ctx.createGain(); s.connect(bp); bp.connect(gg); gg.connect(out.input); this._env(gg, t, 0.002, 0.15 + Math.random() * 0.2, 0.03 + Math.random() * 0.06); s.start(t); s.stop(t + 0.2); }
    this._reverbSend(g, 0.9, true); this._reverbSend(sg, 0.5, true);
  }

  impact(pos, material) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const out = this._spatial(pos, { ref: 4, maxDist: 30, gain: 0.8 });
    if (!out) return;
    const t0 = out.when;
    const M = ImpactProfiles[material] || ImpactProfiles.concrete;
    const src = this._noiseSrc(); const f = this._filter(M.type, M.hz, M.q); const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(out.input); this._env(g, t0, 0.001, M.gain, M.decay); src.start(t0); src.stop(t0 + 0.3);
    if (M.ring) { for (const hz of M.ring) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz * (0.95 + Math.random() * 0.1); const gg = ctx.createGain(); o.connect(gg); gg.connect(out.input); this._env(gg, t0, 0.001, 0.12, 0.14); o.start(t0); o.stop(t0 + 0.3); } }
    if (M.debris) { for (let i = 0; i < 3; i++) { const t = t0 + 0.03 + Math.random() * 0.12; const s = this._noiseSrc(); const bp = this._filter('bandpass', 1500 + Math.random() * 3000, 4); const gg = ctx.createGain(); s.connect(bp); bp.connect(gg); gg.connect(out.input); this._env(gg, t, 0.001, 0.12, 0.02); s.start(t); s.stop(t + 0.1); } }
  }

  whizz(pos) {
    if (!this.ready) return;
    const ctx = this.ctx; const out = this._spatial(pos, { ref: 2, maxDist: 6, gain: 0.7, noDelay: true }); if (!out) return;
    const t0 = out.when; const src = this._noiseSrc(); const bp = this._filter('bandpass', 3500, 6); bp.frequency.setValueAtTime(4000, t0); bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.09);
    const g = ctx.createGain(); src.connect(bp); bp.connect(g); g.connect(out.input); this._env(g, t0, 0.005, 0.5, 0.08); src.start(t0); src.stop(t0 + 0.2);
  }

  glass(pos) {
    if (!this.ready) return;
    const ctx = this.ctx; const out = this._spatial(pos, { ref: 6, maxDist: 50, gain: 1 }); if (!out) return;
    const t0 = out.when;
    const src = this._noiseSrc(); const hp = this._filter('highpass', 3000, 0.7); const g = ctx.createGain(); src.connect(hp); hp.connect(g); g.connect(out.input); this._env(g, t0, 0.001, 0.6, 0.12); src.start(t0); src.stop(t0 + 0.4);
    for (let i = 0; i < 14; i++) { const t = t0 + Math.random() * 0.35; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 3000 + Math.random() * 6000; const gg = ctx.createGain(); o.connect(gg); gg.connect(out.input); this._env(gg, t, 0.001, 0.08, 0.02 + Math.random() * 0.05); o.start(t); o.stop(t + 0.15); }
    this._reverbSend(g, 0.4, false);
  }

  melee(pos, hit, material = 'wood') {
    if (!this.ready) return;
    const ctx = this.ctx; const out = this._spatial(pos, { ref: 4, maxDist: 25, gain: 1 }); if (!out) return;
    const t0 = out.when;
    const src = this._noiseSrc(); const bp = this._filter('bandpass', 900, 1.5); bp.frequency.setValueAtTime(1200, t0); bp.frequency.exponentialRampToValueAtTime(300, t0 + 0.14);
    const g = ctx.createGain(); src.connect(bp); bp.connect(g); g.connect(out.input); this._env(g, t0, 0.02, 0.35, 0.12); src.start(t0); src.stop(t0 + 0.3);
    if (hit) { const t = t0 + 0.11; this.impact(pos, material === 'flesh' ? 'flesh' : 'wood'); const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 160; const gg = ctx.createGain(); o.connect(gg); gg.connect(out.input); this._env(gg, t, 0.002, 0.5, 0.09); o.start(t); o.stop(t + 0.2); const s2 = this._noiseSrc(); const lp = this._filter('lowpass', 700, 1); const g2 = ctx.createGain(); s2.connect(lp); lp.connect(g2); g2.connect(out.input); this._env(g2, t, 0.001, 0.7, 0.07); s2.start(t); s2.stop(t + 0.2); }
  }

  beep(pos, hz = 2600, dur = 0.07, gain = 0.4, when = 0) {
    if (!this.ready) return;
    const ctx = this.ctx; const out = this._spatial(pos, { ref: 5, maxDist: 40, gain }); if (!out) return;
    const t0 = out.when + when; const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz; const lp = this._filter('lowpass', hz * 2.2, 1); const g = ctx.createGain(); o.connect(lp); lp.connect(g); g.connect(out.input); this._env(g, t0, 0.003, 0.5, dur); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // Reinforcement / barricade / hammer / drill loops. Returns a stop function.
  tool(kind, pos, duration) {
    if (!this.ready) return () => {};
    const ctx = this.ctx; const out = this._spatial(pos, { ref: 5, maxDist: 40, gain: 0.9 }); if (!out) return () => {};
    const t0 = out.when; const nodes = [];
    if (kind === 'drill' || kind === 'reinforce') {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 130; const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 262;
      const bp = this._filter('bandpass', 1400, 2); const g = ctx.createGain(); g.gain.value = 0; o.connect(bp); o2.connect(bp); bp.connect(g); g.connect(out.input);
      const src = this._noiseSrc(true); const hp = this._filter('highpass', 2500, 1); const g2 = ctx.createGain(); g2.gain.value = 0; src.connect(hp); hp.connect(g2); g2.connect(out.input);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.2); g.gain.setValueAtTime(0.18, t0 + duration - 0.15); g.gain.linearRampToValueAtTime(0, t0 + duration);
      g2.gain.setValueAtTime(0, t0); g2.gain.linearRampToValueAtTime(0.08, t0 + 0.2); g2.gain.setValueAtTime(0.08, t0 + duration - 0.15); g2.gain.linearRampToValueAtTime(0, t0 + duration);
      o.start(t0); o2.start(t0); src.start(t0); o.stop(t0 + duration + 0.05); o2.stop(t0 + duration + 0.05); src.stop(t0 + duration + 0.05);
      nodes.push(o, o2, src);
      if (kind === 'reinforce') { for (let i = 0; i < 4; i++) { const t = t0 + 0.4 + i * (duration - 0.6) / 4; this._clankAt(out.input, t); } }
    } else if (kind === 'barricade') {
      const n = Math.max(3, Math.round(duration / 0.32));
      for (let i = 0; i < n; i++) { const t = t0 + 0.15 + i * (duration - 0.3) / n; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 230 + Math.random() * 40; const g = ctx.createGain(); o.connect(g); g.connect(out.input); this._env(g, t, 0.002, 0.5, 0.09); o.start(t); o.stop(t + 0.2); const s = this._noiseSrc(); const bp = this._filter('bandpass', 1500, 1.2); const g2 = ctx.createGain(); s.connect(bp); bp.connect(g2); g2.connect(out.input); this._env(g2, t, 0.001, 0.45, 0.04); s.start(t); s.stop(t + 0.15); }
    } else if (kind === 'plant' || kind === 'defuse') {
      const n = Math.round(duration / 0.5);
      for (let i = 0; i < n; i++) { const t = t0 + i * 0.5; const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = kind === 'plant' ? 1800 : 2400; const lp = this._filter('lowpass', 4000, 1); const g = ctx.createGain(); o.connect(lp); lp.connect(g); g.connect(out.input); this._env(g, t, 0.003, 0.25, 0.06); o.start(t); o.stop(t + 0.15); nodes.push(o); }
    } else if (kind === 'thermite') {
      const src = this._noiseSrc(true); const bp = this._filter('bandpass', 1800, 0.6); const g = ctx.createGain(); src.connect(bp); bp.connect(g); g.connect(out.input);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.9, t0 + 0.4); g.gain.setValueAtTime(0.9, t0 + duration - 0.5); g.gain.linearRampToValueAtTime(0, t0 + duration);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55; const g2 = ctx.createGain(); o.connect(g2); g2.connect(out.input); g2.gain.setValueAtTime(0, t0); g2.gain.linearRampToValueAtTime(0.25, t0 + 0.4); g2.gain.linearRampToValueAtTime(0, t0 + duration);
      src.start(t0); o.start(t0); src.stop(t0 + duration + 0.1); o.stop(t0 + duration + 0.1); nodes.push(src, o);
      for (let i = 0; i < 30; i++) { const t = t0 + 0.3 + Math.random() * (duration - 0.5); const s = this._noiseSrc(); const hp = this._filter('highpass', 3500, 1); const gg = ctx.createGain(); s.connect(hp); hp.connect(gg); gg.connect(out.input); this._env(gg, t, 0.001, 0.25, 0.02); s.start(t); s.stop(t + 0.1); }
    }
    return () => { const t = ctx.currentTime; for (const n of nodes) { try { n.stop(t + 0.05); } catch (e) {} } };
  }
  _clankAt(input, t) { const ctx = this.ctx; for (const hz of [880, 1320, 2100]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz * (0.97 + Math.random() * 0.06); const g = ctx.createGain(); o.connect(g); g.connect(input); this._env(g, t, 0.001, 0.14, 0.18); o.start(t); o.stop(t + 0.4); } const s = this._noiseSrc(); const bp = this._filter('bandpass', 2500, 2); const g2 = ctx.createGain(); s.connect(bp); bp.connect(g2); g2.connect(input); this._env(g2, t, 0.001, 0.4, 0.03); s.start(t); s.stop(t + 0.1); }

  emp(pos) {
    if (!this.ready) return; const ctx = this.ctx; const out = this._spatial(pos, { ref: 8, maxDist: 60, gain: 1 }); if (!out) return; const t0 = out.when;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(200, t0); o.frequency.exponentialRampToValueAtTime(3200, t0 + 0.25); o.frequency.exponentialRampToValueAtTime(90, t0 + 0.9);
    const g = ctx.createGain(); o.connect(g); g.connect(out.input); this._env(g, t0, 0.02, 0.5, 0.9); o.start(t0); o.stop(t0 + 1.1);
    const src = this._noiseSrc(); const hp = this._filter('highpass', 2000, 1); const g2 = ctx.createGain(); src.connect(hp); hp.connect(g2); g2.connect(out.input); this._env(g2, t0, 0.005, 0.5, 0.3); src.start(t0); src.stop(t0 + 0.5);
  }

  scan() {
    if (!this.ready) return; const ctx = this.ctx; const t0 = ctx.currentTime;
    for (let i = 0; i < 3; i++) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 1200 + i * 400; const g = ctx.createGain(); o.connect(g); g.connect(this.ui); this._env(g, t0 + i * 0.12, 0.01, 0.2, 0.25); o.start(t0 + i * 0.12); o.stop(t0 + i * 0.12 + 0.4); }
  }

  stun(intensity) {
    if (!this.ready) return; const ctx = this.ctx; const t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 3800; const g = ctx.createGain(); o.connect(g); g.connect(this.sfx);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.3 * intensity, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.5 * intensity + 0.3); o.start(t0); o.stop(t0 + 3);
    // duck everything else
    const now = t0; this.sfx.gain.cancelScheduledValues(now); this.sfx.gain.setValueAtTime(this.volumes.sfx * 0.15, now); this.sfx.gain.linearRampToValueAtTime(this.volumes.sfx, now + 2.2 * intensity + 0.5);
  }

  ambience(interior) {
    if (!this.ready) return; const ctx = this.ctx;
    if (!this._ambient) {
      const wind = this._noiseSrc(true); const lp = this._filter('lowpass', 260, 0.6); const g = ctx.createGain(); g.gain.value = 0; wind.connect(lp); lp.connect(g); g.connect(this.amb); wind.start();
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 60; const hg = ctx.createGain(); hg.gain.value = 0; hum.connect(hg); hg.connect(this.amb); hum.start();
      const room = this._noiseSrc(true); const lp2 = this._filter('lowpass', 140, 0.5); const rg = ctx.createGain(); rg.gain.value = 0; room.connect(lp2); lp2.connect(rg); rg.connect(this.amb); room.start();
      this._ambient = { windGain: g, humGain: hg, roomGain: rg };
    }
    const a = this._ambient, t = ctx.currentTime;
    a.windGain.gain.setTargetAtTime(interior ? 0.05 : 0.22, t, 0.8);
    a.humGain.gain.setTargetAtTime(interior ? 0.02 : 0.0, t, 0.8);
    a.roomGain.gain.setTargetAtTime(interior ? 0.16 : 0.03, t, 0.8);
  }
  stopAmbience() { if (this._ambient && this.ctx) { const t = this.ctx.currentTime; this._ambient.windGain.gain.setTargetAtTime(0, t, 0.3); this._ambient.humGain.gain.setTargetAtTime(0, t, 0.3); this._ambient.roomGain.gain.setTargetAtTime(0, t, 0.3); } }

  bombTick(pos, urgency) { this.beep(pos, 1400 + urgency * 600, 0.05, 0.5); }
  roundStinger(win) {
    if (!this.ready) return; const ctx = this.ctx; const t0 = ctx.currentTime;
    const notes = win ? [392, 523, 659, 784] : [392, 349, 311, 262];
    notes.forEach((hz, i) => { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz; const g = ctx.createGain(); o.connect(g); g.connect(this.ui); this._env(g, t0 + i * 0.16, 0.01, 0.18, 0.6); o.start(t0 + i * 0.16); o.stop(t0 + i * 0.16 + 0.8); });
  }
}

const GunProfiles = {
  '556': { crack: 1.0, crackHz: 2800, crackDecay: 0.03, body: 0.85, bodyHz: 700, bodyDecay: 0.11, thump: 0.75, thumpHz: 130, thumpDecay: 0.14, mech: 0.12, mechAt: 0.045, loud: 1.0 },
  '762': { crack: 1.0, crackHz: 2400, crackDecay: 0.035, body: 1.0, bodyHz: 520, bodyDecay: 0.14, thump: 0.95, thumpHz: 110, thumpDecay: 0.18, mech: 0.12, mechAt: 0.05, loud: 1.1 },
  '9mm': { crack: 0.7, crackHz: 3400, crackDecay: 0.022, body: 0.75, bodyHz: 950, bodyDecay: 0.08, thump: 0.5, thumpHz: 160, thumpDecay: 0.1, mech: 0.1, mechAt: 0.035, loud: 0.85 },
  '45': { crack: 0.65, crackHz: 3000, crackDecay: 0.025, body: 0.85, bodyHz: 800, bodyDecay: 0.09, thump: 0.6, thumpHz: 140, thumpDecay: 0.12, mech: 0.08, mechAt: 0.04, loud: 0.9 },
  'pistol': { crack: 0.8, crackHz: 3600, crackDecay: 0.02, body: 0.7, bodyHz: 1100, bodyDecay: 0.07, thump: 0.45, thumpHz: 170, thumpDecay: 0.09, mech: 0.14, mechAt: 0.03, loud: 0.85 },
  '12ga': { crack: 0.75, crackHz: 2000, crackDecay: 0.04, body: 1.1, bodyHz: 380, bodyDecay: 0.2, thump: 1.2, thumpHz: 95, thumpDecay: 0.26, mech: 0.0, mechAt: 0, loud: 1.25 },
};

const Surfaces = {
  concrete: { thud: 0.55, thudHz: 700, thudDecay: 0.05, click: 0.3, clickHz: 2500, clickType: 'highpass', clickDecay: 0.02 },
  tile: { thud: 0.4, thudHz: 900, thudDecay: 0.04, click: 0.5, clickHz: 3200, clickType: 'highpass', clickDecay: 0.03, tone: 1600, toneGain: 0.06, toneDecay: 0.05 },
  wood: { thud: 0.6, thudHz: 500, thudDecay: 0.06, click: 0.2, clickHz: 1800, clickType: 'bandpass', clickDecay: 0.03, tone: 170, toneGain: 0.18, toneDecay: 0.08 },
  carpet: { thud: 0.35, thudHz: 350, thudDecay: 0.05, click: 0.08, clickHz: 1500, clickType: 'bandpass', clickDecay: 0.03 },
  dirt: { thud: 0.45, thudHz: 400, thudDecay: 0.06, click: 0.2, clickHz: 2200, clickType: 'bandpass', clickDecay: 0.04, gravel: true },
  metal: { thud: 0.5, thudHz: 800, thudDecay: 0.05, click: 0.4, clickHz: 3000, clickType: 'highpass', clickDecay: 0.03, tone: 1100, toneGain: 0.12, toneDecay: 0.12 },
  drywall: { thud: 0.55, thudHz: 600, thudDecay: 0.05, click: 0.25, clickHz: 2500, clickType: 'highpass', clickDecay: 0.02 },
  barricade: { thud: 0.6, thudHz: 500, thudDecay: 0.06, click: 0.2, clickHz: 1800, clickType: 'bandpass', clickDecay: 0.03, tone: 170, toneGain: 0.18, toneDecay: 0.08 },
  glass: { thud: 0.4, thudHz: 900, thudDecay: 0.04, click: 0.5, clickHz: 3200, clickType: 'highpass', clickDecay: 0.03 },
  reinforced: { thud: 0.5, thudHz: 800, thudDecay: 0.05, click: 0.4, clickHz: 3000, clickType: 'highpass', clickDecay: 0.03, tone: 1100, toneGain: 0.12, toneDecay: 0.12 },
};

const ImpactProfiles = {
  concrete: { type: 'bandpass', hz: 1600, q: 1.2, gain: 0.7, decay: 0.035, debris: true },
  brick: { type: 'bandpass', hz: 1400, q: 1.2, gain: 0.7, decay: 0.035, debris: true },
  dirt: { type: 'lowpass', hz: 900, q: 1, gain: 0.6, decay: 0.05 },
  drywall: { type: 'bandpass', hz: 1100, q: 1, gain: 0.6, decay: 0.045, debris: true },
  wood: { type: 'bandpass', hz: 700, q: 1.2, gain: 0.7, decay: 0.05 },
  barricade: { type: 'bandpass', hz: 700, q: 1.2, gain: 0.7, decay: 0.05 },
  metal: { type: 'highpass', hz: 2500, q: 1, gain: 0.5, decay: 0.03, ring: [2300, 3400] },
  reinforced: { type: 'highpass', hz: 2500, q: 1, gain: 0.5, decay: 0.03, ring: [1900, 2800] },
  shield: { type: 'highpass', hz: 2500, q: 1, gain: 0.5, decay: 0.03, ring: [1600, 2400] },
  glass: { type: 'highpass', hz: 4000, q: 1, gain: 0.5, decay: 0.05 },
  tile: { type: 'bandpass', hz: 2200, q: 1.5, gain: 0.6, decay: 0.03, debris: true },
  carpet: { type: 'lowpass', hz: 700, q: 1, gain: 0.4, decay: 0.04 },
  flesh: { type: 'lowpass', hz: 450, q: 1, gain: 0.8, decay: 0.04 },
};

export const AudioEngine = new AudioEngineClass();
