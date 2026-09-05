import * as THREE from 'three';

const SPEED_OF_SOUND = 343;

export interface EngineSound {
  update(pos: THREE.Vector3, vel: THREE.Vector3, driving: boolean, wet: number): void;
  stop(): void;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private tireBus!: AudioBufferSourceNode;
  private listener = new THREE.Vector3();
  private right = new THREE.Vector3(1, 0, 0);
  private forward = new THREE.Vector3(0, 0, -1);
  private env = { wind: 0, rain: 0, birds: 0, cuckoo: 0 };
  private birdTimer = 2;
  private cuckooTimer = 6;
  private lastCrash = 0;
  private t = 0;
  private breathGain!: GainNode;
  private bodyBus!: GainNode;
  private rustleGain!: GainNode;
  private mosquitoes: { gain: GainNode; pan: StereoPannerNode }[] = [];
  private mosquito = { near: 0, ambient: 0 };
  private breathPhase = 0;
  private pulsePhase = 0;
  private body = { breathRate: 0.3, breathLevel: 0, bpm: 60, pulseLevel: 0, self: 0.5, gait: 0, gaitPhase: 0 };

  get running() {
    return !!this.ctx;
  }

  start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let acc = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      acc = (acc + 0.02 * w[i]) / 1.02;
      b[i] = acc * 3.5;
    }

    const windSrc = this.loop(this.brown);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);

    const rainSrc = this.loop(this.white);
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2800;
    rainFilter.Q.value = 0.4;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);

    this.tireBus = this.loop(this.white);

    // everything the moose hears through its own body: close, dull, unpanned
    this.bodyBus = ctx.createGain();
    const bodyLp = ctx.createBiquadFilter();
    bodyLp.frequency.value = 900;
    this.bodyBus.connect(bodyLp).connect(this.master);

    const breathSrc = this.loop(this.brown);
    const breathBp = ctx.createBiquadFilter();
    breathBp.type = 'bandpass';
    breathBp.frequency.value = 700;
    breathBp.Q.value = 0.5;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    breathSrc.connect(breathBp).connect(this.breathGain).connect(this.bodyBus);

    const rustleSrc = this.loop(this.white);
    const rustleBp = ctx.createBiquadFilter();
    rustleBp.type = 'bandpass';
    rustleBp.frequency.value = 1500;
    rustleBp.Q.value = 0.8;
    this.rustleGain = ctx.createGain();
    this.rustleGain.gain.value = 0;
    rustleSrc.connect(rustleBp).connect(this.rustleGain).connect(this.master);

    for (const base of [470, 560, 650]) {
      const mo = ctx.createOscillator();
      mo.type = 'sawtooth';
      mo.frequency.value = base;
      const vib = ctx.createOscillator();
      vib.frequency.value = 7 + Math.random() * 4;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 30 + Math.random() * 25;
      vib.connect(vibGain).connect(mo.frequency);
      const lp = ctx.createBiquadFilter();
      lp.frequency.value = 2200;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      mo.connect(lp).connect(gain).connect(pan).connect(this.master);
      mo.start();
      vib.start();
      this.mosquitoes.push({ gain, pan });
    }
  }

  // near: a swarm at the head, voices join one by one; ambient: the faint dusk hum that never quite leaves
  setMosquito(near: number, ambient = 0) {
    this.mosquito = { near, ambient };
  }

  // the moose's own body: breathing, heartbeat, hide rustle; self scales how close the camera sits to it
  setBody(b: { breathRate: number; breathLevel: number; bpm: number; pulseLevel: number; self: number; gait: number; gaitPhase: number }) {
    this.body = b;
  }

  // a footfall felt through the skeleton rather than heard: weight shift, no clear transient
  step(strength: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const level = strength * this.body.self;
    const n = ctx.createBufferSource();
    n.buffer = this.brown;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 110;
    const e = ctx.createGain();
    e.gain.setValueAtTime(1.1 * level, t0);
    e.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    n.connect(lp).connect(e).connect(this.bodyBus);
    n.start(t0);
    n.stop(t0 + 0.16);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(44, t0);
    o.frequency.exponentialRampToValueAtTime(30, t0 + 0.1);
    const oe = ctx.createGain();
    oe.gain.setValueAtTime(0.5 * level, t0);
    oe.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    o.connect(oe).connect(this.bodyBus);
    o.start(t0);
    o.stop(t0 + 0.13);
    if (Math.random() < 0.2) this.joint(level);
  }

  private joint(level: number) {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + 0.03 + Math.random() * 0.06;
    const n = ctx.createBufferSource();
    n.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 500;
    bp.Q.value = 8;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.12 * level, t0);
    e.gain.exponentialRampToValueAtTime(0.001, t0 + 0.035);
    n.connect(bp).connect(e).connect(this.bodyBus);
    n.start(t0);
    n.stop(t0 + 0.05);
  }

  private heartbeat(level: number) {
    const ctx = this.ctx!;
    for (const [off, gain] of [[0, 1], [0.16, 0.6]] as const) {
      const t0 = ctx.currentTime + off;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(58, t0);
      o.frequency.exponentialRampToValueAtTime(36, t0 + 0.1);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.5 * level * gain, t0);
      e.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
      o.connect(e).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.13);
    }
  }

  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  setListener(pos: THREE.Vector3, forward: THREE.Vector3) {
    this.listener.copy(pos);
    this.forward.copy(forward).setY(0).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x);
  }

  setEnvironment(env: { wind: number; rain: number; birds: number; cuckoo: number }) {
    this.env = env;
  }

  private spatial(pos: THREE.Vector3, refDist = 12) {
    const to = pos.clone().sub(this.listener);
    const d = to.length();
    const pan = d > 0.01 ? THREE.MathUtils.clamp(to.dot(this.right) / d, -1, 1) : 0;
    return { gain: 1 / (1 + (d / refDist) ** 2), pan, dist: d, dir: to.divideScalar(Math.max(d, 0.01)) };
  }

  private out(pos: THREE.Vector3, refDist = 12) {
    const ctx = this.ctx!;
    const { gain, pan } = this.spatial(pos, refDist);
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.master);
    return g;
  }

  update(dt: number) {
    if (!this.ctx) return;
    this.t += dt;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gust = 0.6 + 0.4 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11 + 1);
    this.windGain.gain.setTargetAtTime(0.02 + 0.14 * this.env.wind * gust, now, 0.8);
    this.windFilter.frequency.setTargetAtTime(160 + 300 * this.env.wind * gust, now, 0.8);
    this.rainGain.gain.setTargetAtTime(0.09 * this.env.rain, now, 1.5);

    this.mosquitoes.forEach((m, i) => {
      const wander = 0.5 + 0.5 * Math.sin(this.t * (2.3 + i * 0.6) + i) * Math.sin(this.t * (0.7 + i * 0.2) + 2 * i);
      const join = THREE.MathUtils.clamp((this.mosquito.near - i * 0.3) / 0.4, 0, 1);
      const level = 0.035 * join + 0.006 * this.mosquito.ambient * (i === 0 ? 1 : 0.4);
      m.gain.gain.setTargetAtTime(level * wander, now, 0.15);
      m.pan.pan.setTargetAtTime(0.7 * Math.sin(this.t * (0.9 + i * 0.35) + i * 2.1), now, 0.2);
    });
    const b = this.body;
    this.breathPhase += dt * b.breathRate * Math.PI * 2;
    const inhale = Math.max(0, Math.sin(this.breathPhase));
    const exhale = Math.max(0, -Math.sin(this.breathPhase)) * 0.7;
    this.breathGain.gain.setTargetAtTime(b.breathLevel * (inhale + exhale) * 0.5, now, 0.05);
    const stride = 0.6 + 0.4 * Math.abs(Math.sin(b.gaitPhase * 2));
    this.rustleGain.gain.setTargetAtTime(b.self * (0.004 + 0.05 * b.gait) * stride, now, 0.04);
    this.pulsePhase += (dt * b.bpm) / 60;
    if (this.pulsePhase >= 1) {
      this.pulsePhase -= 1;
      if (b.pulseLevel > 0) this.heartbeat(b.pulseLevel);
    }

    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.birdTimer = 3 + Math.random() * 7;
      if (Math.random() < this.env.birds) this.chirp();
    }
    this.cuckooTimer -= dt;
    if (this.cuckooTimer < 0) {
      this.cuckooTimer = 5 + Math.random() * 12;
      if (Math.random() < this.env.cuckoo) this.cuckoo();
    }
  }

  private chirp() {
    const ctx = this.ctx!;
    const pos = this.listener.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 8, (Math.random() - 0.5) * 40));
    const g = this.out(pos, 14);
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1500;
    for (let i = 0; i < n; i++) {
      const t0 = ctx.currentTime + i * (0.12 + Math.random() * 0.08);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base, t0);
      o.frequency.linearRampToValueAtTime(base * 1.4, t0 + 0.05);
      o.frequency.linearRampToValueAtTime(base * 0.85, t0 + 0.11);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, t0);
      e.gain.linearRampToValueAtTime(0.03, t0 + 0.02);
      e.gain.linearRampToValueAtTime(0, t0 + 0.12);
      o.connect(e).connect(g);
      o.start(t0);
      o.stop(t0 + 0.13);
    }
  }

  private cuckoo() {
    const ctx = this.ctx!;
    const pos = this.listener.clone().add(new THREE.Vector3((Math.random() - 0.5) * 120, 10, (Math.random() - 0.5) * 120));
    const g = this.out(pos, 40);
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 1200;
    lp.connect(g);
    const reps = 2 + Math.floor(Math.random() * 3);
    for (let r = 0; r < reps; r++) {
      for (const [f, off, len] of [[690, 0, 0.22], [545, 0.3, 0.3]] as const) {
        const t0 = ctx.currentTime + r * 1.1 + off;
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t0);
        e.gain.linearRampToValueAtTime(0.08, t0 + 0.04);
        e.gain.setValueAtTime(0.08, t0 + len - 0.06);
        e.gain.linearRampToValueAtTime(0, t0 + len);
        o.connect(e).connect(lp);
        o.start(t0);
        o.stop(t0 + len + 0.01);
      }
    }
  }

  engine(pitch = 1, loud = 1): EngineSound {
    if (!this.ctx) return { update() {}, stop() {} };
    const ctx = this.ctx;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 520 * pitch;
    const g = ctx.createGain();
    g.gain.value = 0;
    const tireBp = ctx.createBiquadFilter();
    tireBp.type = 'bandpass';
    tireBp.frequency.value = 900;
    tireBp.Q.value = 0.6;
    const tireG = ctx.createGain();
    tireG.gain.value = 0;
    const skidBp = ctx.createBiquadFilter();
    skidBp.type = 'bandpass';
    skidBp.frequency.value = 1800;
    skidBp.Q.value = 3;
    const skidG = ctx.createGain();
    skidG.gain.value = 0;
    const pan = ctx.createStereoPanner();
    o1.connect(lp);
    o2.connect(o2g).connect(lp);
    lp.connect(g).connect(pan);
    this.tireBus.connect(tireBp).connect(tireG).connect(pan);
    this.tireBus.connect(skidBp).connect(skidG).connect(pan);
    pan.connect(this.master);
    o1.start();
    o2.start();
    return {
      update: (pos, vel, driving, wet) => {
        // engines carry a long way over the lake at night: you hear a car well before you see it
        const s = this.spatial(pos, 26);
        const now = ctx.currentTime;
        const speed = vel.length();
        const vRadial = -vel.dot(s.dir);
        const doppler = SPEED_OF_SOUND / Math.max(60, SPEED_OF_SOUND - vRadial);
        const rpmHz = (driving ? 40 + speed * 2.4 : 30) * doppler * pitch;
        o1.frequency.setTargetAtTime(rpmHz, now, 0.05);
        o2.frequency.setTargetAtTime(rpmHz * 2, now, 0.05);
        g.gain.setTargetAtTime(s.gain * loud * (driving ? 0.22 : 0.08), now, 0.05);
        tireG.gain.setTargetAtTime(s.gain * Math.min(1, speed / 25) * (0.12 + 0.25 * wet), now, 0.05);
        skidG.gain.setTargetAtTime(!driving && speed > 2 ? s.gain * Math.min(1, speed / 15) * 0.5 : 0, now, 0.05);
        pan.pan.setTargetAtTime(s.pan, now, 0.05);
      },
      stop: () => {
        o1.stop();
        o2.stop();
        pan.disconnect();
        tireBp.disconnect();
        skidBp.disconnect();
      },
    };
  }

  // hoofbeat: a short muffled thud, sharper on asphalt, hollow on the bridge deck
  hoof(pos: THREE.Vector3, strength: number, surface: 'forest' | 'asphalt' | 'deck') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = this.out(pos, 8);
    const t0 = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = surface === 'asphalt' ? this.white : this.brown;
    const f = ctx.createBiquadFilter();
    f.type = surface === 'deck' ? 'bandpass' : 'lowpass';
    f.frequency.value = surface === 'asphalt' ? 1800 : surface === 'deck' ? 320 : 220;
    f.Q.value = surface === 'deck' ? 4 : 0.7;
    const e = ctx.createGain();
    e.gain.setValueAtTime(strength * (surface === 'asphalt' ? 0.35 : 0.8), t0);
    e.gain.exponentialRampToValueAtTime(0.001, t0 + (surface === 'deck' ? 0.16 : 0.08));
    n.connect(f).connect(e).connect(g);
    n.start(t0);
    n.stop(t0 + 0.2);
  }

  crash(pos: THREE.Vector3, strength: number) {
    if (!this.ctx || this.t - this.lastCrash < 0.08) return;
    this.lastCrash = this.t;
    const ctx = this.ctx;
    const s = THREE.MathUtils.clamp(strength, 0.15, 1);
    const g = this.out(pos, 25);
    const t0 = ctx.currentTime;

    const n = ctx.createBufferSource();
    n.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(2200, t0);
    bp.frequency.exponentialRampToValueAtTime(220, t0 + 0.4);
    const ne = ctx.createGain();
    ne.gain.setValueAtTime(0, t0);
    ne.gain.linearRampToValueAtTime(1.2 * s, t0 + 0.01);
    ne.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5 + 0.3 * s);
    n.connect(bp).connect(ne).connect(g);
    n.start(t0);
    n.stop(t0 + 1);

    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(70, t0);
    thump.frequency.exponentialRampToValueAtTime(28, t0 + 0.35);
    const te = ctx.createGain();
    te.gain.setValueAtTime(0.9 * s, t0);
    te.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    thump.connect(te).connect(g);
    thump.start(t0);
    thump.stop(t0 + 0.45);

    for (const f of [1180, 1730, 2410]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (0.9 + Math.random() * 0.2);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.08 * s, t0 + 0.02);
      e.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5 + Math.random() * 0.4);
      o.connect(e).connect(g);
      o.start(t0 + 0.02);
      o.stop(t0 + 1);
    }
    if (s > 0.3) {
      for (let i = 0; i < 8; i++) {
        const ts = t0 + 0.03 + Math.random() * 0.3;
        const o = ctx.createOscillator();
        o.frequency.value = 3800 + Math.random() * 4000;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0.05 * s, ts);
        e.gain.exponentialRampToValueAtTime(0.001, ts + 0.1);
        o.connect(e).connect(g);
        o.start(ts);
        o.stop(ts + 0.12);
      }
    }
  }

  thud(pos: THREE.Vector3, strength: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = THREE.MathUtils.clamp(strength, 0.1, 1);
    const g = this.out(pos, 15);
    const t0 = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.brown;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 300;
    const e = ctx.createGain();
    e.gain.setValueAtTime(1.5 * s, t0);
    e.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    n.connect(lp).connect(e).connect(g);
    n.start(t0);
    n.stop(t0 + 0.2);
  }

  grunt(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = this.out(pos, 12);
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(80, t0);
    o.frequency.linearRampToValueAtTime(115, t0 + 0.15);
    o.frequency.linearRampToValueAtTime(70, t0 + 0.6);
    const f = ctx.createBiquadFilter();
    f.frequency.setValueAtTime(380, t0);
    f.frequency.linearRampToValueAtTime(260, t0 + 0.6);
    f.Q.value = 5;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t0);
    e.gain.linearRampToValueAtTime(0.35, t0 + 0.05);
    e.gain.setValueAtTime(0.3, t0 + 0.4);
    e.gain.linearRampToValueAtTime(0, t0 + 0.65);
    o.connect(f).connect(e).connect(g);
    o.start(t0);
    o.stop(t0 + 0.7);
  }

  honk(pos: THREE.Vector3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const g = this.out(pos, 20);
    const t0 = ctx.currentTime;
    const len = 0.35 + Math.random() * 0.5;
    const lp = ctx.createBiquadFilter();
    lp.frequency.value = 1800;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t0);
    e.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
    e.gain.setValueAtTime(0.16, t0 + len - 0.03);
    e.gain.linearRampToValueAtTime(0, t0 + len);
    lp.connect(e).connect(g);
    for (const f of [440, 554]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + len + 0.01);
    }
  }
}
