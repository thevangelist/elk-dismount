import * as THREE from 'three';

export type Weather = 'sunny' | 'partly cloudy' | 'overcast' | 'rain';
const WEATHERS: Weather[] = ['sunny', 'sunny', 'partly cloudy', 'partly cloudy', 'overcast', 'rain', 'rain'];
const HOURS = [5.5, 9, 13, 17, 20.5, 23.5];

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const RAIN_COUNT = 2500;

// phase 0 = new, 0.5 = full, 1 = new again
export function moonTexture(phase: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const lit = '#e9e6d8', dark = '#0b0d18';
  g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fillStyle = dark; g.fill();
  g.save();
  g.clip();
  // lit half on the sunward side, then an ellipse fixes the terminator: dark for crescents, lit for gibbous
  const waxing = phase < 0.5;
  const k = Math.cos(phase * Math.PI * 2);
  g.fillStyle = lit;
  g.fillRect(waxing ? 64 : 0, 0, 64, 128);
  g.fillStyle = k > 0 ? dark : lit;
  g.beginPath(); g.ellipse(64, 64, Math.abs(k) * 56, 56, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(40,35,30,0.35)';
  for (const [x, y, r] of [[40, 50, 9], [80, 70, 12], [60, 90, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  g.restore();
  return new THREE.CanvasTexture(c);
}

export class Sky {
  hour = 13;
  weather: Weather = 'sunny';
  wind = 2;
  wetness = 0;
  sunDir = new THREE.Vector3(0, 1, 0);
  elevation = 60;
  daylight = 1;

  readonly sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private clouds: THREE.Sprite[] = [];
  private cloudMat: THREE.SpriteMaterial;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private fog: THREE.Fog;
  private moon: THREE.Sprite;
  moonPhase = 0.5;

  constructor(private scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0015;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x88aaff, 0x332a1a, 0.8);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xffffff, 40, 500);
    scene.fog = this.fog;
    scene.background = new THREE.Color();

    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color() },
        sunGlow: { value: 1 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 zenith, horizon, sunDir, sunColor; uniform float sunGlow;
        varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir);
          float t = pow(max(d.y, 0.0), 0.5);
          vec3 col = mix(horizon, zenith, t);
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 2.0 + pow(s, 6.0) * 0.3) * sunGlow;
          gl_FragColor = vec4(col, 1.0); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.domeMat);
    scene.add(this.dome);

    this.cloudMat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false });
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(this.cloudMat.clone());
      s.userData.base = new THREE.Vector3((Math.random() - 0.5) * 900, 90 + Math.random() * 60, (Math.random() - 0.5) * 900);
      s.userData.w = 50 + Math.random() * 70;
      s.userData.h = 18 + Math.random() * 20;
      this.clouds.push(s);
      scene.add(s);
    }

    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
    this.moon.scale.set(50, 50, 1);
    scene.add(this.moon);

    this.rainPos = new Float32Array(RAIN_COUNT * 6);
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainPos[i * 6] = (Math.random() - 0.5) * 80;
      this.rainPos[i * 6 + 1] = Math.random() * 30;
      this.rainPos[i * 6 + 2] = (Math.random() - 0.5) * 80;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xbfc8d8, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    this.randomize();
  }

  randomize() {
    this.hour = pick(HOURS);
    this.weather = pick(WEATHERS);
    this.wind = (this.weather === 'rain' ? 5 : this.weather === 'overcast' ? 3.5 : 1.5) * (Math.random() < 0.5 ? -1 : 1);
    this.wetness = this.weather === 'rain' ? 1 : 0;
    this.moonPhase = Math.random();
    (this.moon.material as THREE.SpriteMaterial).map = moonTexture(this.moonPhase);
    this.apply();
  }

  get moonLight() {
    return 1 - Math.abs(this.moonPhase - 0.5) * 2;
  }

  get moonDir() {
    return new THREE.Vector3(-this.sunDir.x, Math.max(0.25, -this.sunDir.y * 0.8 + 0.3), -this.sunDir.z).normalize();
  }

  get isNight() {
    return this.daylight < 0.35;
  }

  get rainAmount() {
    return this.weather === 'rain' ? 1 : 0;
  }

  get period() {
    const h = this.hour;
    return h < 4 ? 'night' : h < 9 ? 'morning' : h < 17 ? 'day' : h < 22.5 ? 'evening' : 'night';
  }

  clock() {
    const hh = Math.floor(this.hour), mm = Math.floor((this.hour - hh) * 60);
    return `${hh}:${mm.toString().padStart(2, '0')}`;
  }

  private apply() {
    const el = 60 * Math.sin(((this.hour - 4) / 16) * Math.PI);
    this.elevation = el;
    const az = (this.hour / 24) * Math.PI * 2 + 0.6;
    const er = THREE.MathUtils.degToRad(el);
    this.sunDir.set(Math.cos(er) * Math.sin(az), Math.sin(er), Math.cos(er) * Math.cos(az)).normalize();
    const d = clamp01((el + 8) / 20);
    this.daylight = d;
    const clear = this.weather === 'sunny' ? 1 : this.weather === 'partly cloudy' ? 0.8 : this.weather === 'overcast' ? 0.25 : 0.15;
    const low = 1 - clamp01(el / 30);

    const sunCol = new THREE.Color(1, 0.55, 0.25).lerp(new THREE.Color(1, 0.97, 0.9), 1 - low);
    const zenithDay = new THREE.Color(0.3, 0.52, 0.92).lerp(new THREE.Color(0.5, 0.54, 0.6), 1 - clear);
    const horizonDay = new THREE.Color(0.72, 0.83, 0.95).lerp(new THREE.Color(0.66, 0.68, 0.71), 1 - clear);
    if (this.weather === 'rain') { zenithDay.setRGB(0.4, 0.43, 0.48); horizonDay.setRGB(0.55, 0.57, 0.6); }
    horizonDay.lerp(new THREE.Color(1, 0.6, 0.3), low * clear * 0.6);
    // Finnish summer nights never get properly dark: keep the night sky a deep but readable blue
    const zenithNight = new THREE.Color(0.14, 0.18, 0.32).lerp(new THREE.Color(0.16, 0.17, 0.2), 1 - clear);
    const horizonNight = new THREE.Color(0.38, 0.36, 0.46).lerp(new THREE.Color(0.28, 0.28, 0.3), 1 - clear);
    const zenith = zenithNight.lerp(zenithDay, d);
    const horizon = horizonNight.lerp(horizonDay, d);

    const u = this.domeMat.uniforms;
    (u.zenith.value as THREE.Color).copy(zenith);
    (u.horizon.value as THREE.Color).copy(horizon);
    (u.sunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.sunColor.value as THREE.Color).copy(sunCol).multiplyScalar(d);
    u.sunGlow.value = clear;

    if (el > 0) {
      this.sun.color.copy(sunCol);
      this.sun.intensity = d * (0.4 + 2.2 * clear);
    } else {
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = (0.18 + 0.3 * this.moonLight) * clear + 0.12;
    }
    const moonMat = this.moon.material as THREE.SpriteMaterial;
    moonMat.opacity = el < 5 ? clear * (1 - d) : 0;
    this.moon.visible = moonMat.opacity > 0.02;
    this.hemi.color.copy(zenith).multiplyScalar(1.3);
    this.hemi.intensity = 0.7 + 0.7 * d;
    this.fog.color.copy(horizon);
    this.fog.far = this.weather === 'rain' ? 200 : this.weather === 'overcast' ? 330 : 520;
    this.fog.near = this.fog.far * 0.12;
    (this.scene.background as THREE.Color).copy(horizon);

    const cloudCount = this.weather === 'sunny' ? 10 : this.weather === 'partly cloudy' ? 22 : 40;
    const cloudCol = new THREE.Color(1, 1, 1).lerp(new THREE.Color(0.5, 0.52, 0.56), 1 - clear);
    cloudCol.multiplyScalar(0.25 + 0.75 * d).lerp(sunCol.clone().multiplyScalar(0.9), low * clear * d * 0.5);
    this.clouds.forEach((s, i) => {
      s.visible = i < cloudCount;
      const mat = s.material as THREE.SpriteMaterial;
      mat.color.copy(cloudCol);
      mat.opacity = clear > 0.5 ? 0.8 : 0.95;
      const flat = clear > 0.5 ? 1 : 0.6;
      s.scale.set(s.userData.w * (clear > 0.5 ? 1 : 1.5), s.userData.h * flat, 1);
    });
    this.rain.visible = this.weather === 'rain';
  }

  update(dt: number, camPos: THREE.Vector3, focus: THREE.Vector3) {
    this.hour = (this.hour + dt / 240) % 24;
    this.apply();
    this.dome.position.copy(camPos);
    this.sun.target.position.copy(focus);
    const lightDir = this.elevation > 0 ? this.sunDir : this.moonDir;
    this.sun.position.copy(focus).addScaledVector(lightDir, 180);
    this.moon.position.copy(camPos).addScaledVector(this.moonDir, 800);

    for (const s of this.clouds) {
      const b = s.userData.base as THREE.Vector3;
      b.x += this.wind * 1.5 * dt;
      if (b.x > 450) b.x -= 900;
      if (b.x < -450) b.x += 900;
      s.position.set(camPos.x * 0.6 + b.x, b.y, camPos.z * 0.6 + b.z);
    }

    if (this.rain.visible) {
      const p = this.rainPos;
      const wx = this.wind * dt;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const o = i * 6;
        p[o + 1] -= 16 * dt;
        p[o] += wx;
        if (p[o + 1] < -2) { p[o + 1] += 30; p[o] = (Math.random() - 0.5) * 80; p[o + 2] = (Math.random() - 0.5) * 80; }
        if (p[o] > 40) p[o] -= 80;
        if (p[o] < -40) p[o] += 80;
        p[o + 3] = p[o] + this.wind * 0.03;
        p[o + 4] = p[o + 1] - 0.5;
        p[o + 5] = p[o + 2];
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.rain.position.set(camPos.x, camPos.y - 5, camPos.z);
    }
  }
}
