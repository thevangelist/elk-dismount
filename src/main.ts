import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Input } from './input';
import { buildTerrain, groundHeight, surfaceHeight, START, START_OFFSET, FENCE_Z, FENCE_GAP, WATER_Y, roadOffset, laneZ } from './terrain';
import { Sky, type Weather } from './sky';
import { Traffic, carMaterials } from './cars';
import { Moose } from './moose';
import { GameAudio } from './audio';
import { compose, classifieds, pageFiller, conditions, MASTHEAD, type VehicleIncident, type Incident } from './report';
import type { Vehicle } from './cars';

const FIXED_DT = 1 / 60;
const RUN_SPEED = 15;
const WALK_SPEED = 2.6;
const ROUND_TIME = 60;
const FOLLOW_TIME = 10;
// playable area: the road runs far in both directions; only the stand behind the gap is a wall
const AREA_X = 300;
const AREA_BACK = 30;
const AREA_FRONT = -30;
const $ = (id: string) => document.getElementById(id)!;
const euro = (n: number) => `${Math.round(n).toLocaleString('fi-FI')} €`;
const deg = THREE.MathUtils.degToRad;

async function main() {
  await RAPIER.init();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1200);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  const events = new RAPIER.EventQueue(true);

  const terrain = buildTerrain(scene, world);
  const sky = new Sky(scene);
  // ?cam=2&hour=13&weather=sunny&pitch=25: fixed view for screenshots
  const params = new URLSearchParams(location.search);
  if (params.has('hour')) sky.hour = Number(params.get('hour'));
  if (params.has('weather')) sky.weather = params.get('weather') as Weather;
  const audio = new GameAudio();
  const traffic = new Traffic(scene, world, audio);
  const moose = new Moose(scene, world);
  const input = new Input(renderer.domElement);

  // compile every material up front so spawns and first rain do not stall
  const warmup = new THREE.Group();
  warmup.position.y = -300;
  for (const m of carMaterials) warmup.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m));
  scene.add(warmup);
  scene.traverse((o) => { if (!o.visible) { o.visible = true; o.userData.wasHidden = true; } });
  await renderer.compileAsync(scene, camera);
  scene.traverse((o) => { if (o.userData.wasHidden) { o.visible = false; delete o.userData.wasHidden; } });

  let state: 'run' | 'flight' | 'done' = 'run';
  let runSpeed = 0;
  let wasted = false;
  let frozen = false;
  let yawRate = 0;
  let airVy = 0;
  let airborne = false;
  const runVel = new THREE.Vector3();
  let gaitPhase = 0;
  let jumpHold = -1;
  let camYaw = 0;
  let camPitch = deg(Number(params.get('pitch') ?? 10));
  let score = 0;
  let best = Number(localStorage.getItem('hirviturvat-best') ?? 0);
  let flightTime = 0;
  let slowmo = 0;
  let cameraMode = Number(params.get('cam')) % 3 || 0; // 0 = back-mounted, 1 = eyes, 2 = distant
  let breathPhase = 0;
  let pulsePhase = 0;
  let lastBeat = -1;
  let bulletTime = false;
  let gimbal = 0;
  let roundTime = ROUND_TIME;
  let capturePending = false;
  let chaos = false;
  const behaviour = { jumps: 0, sprintTime: 0, swam: false, bridgeDive: false, sisuUsed: 0, standUps: 0, limping: false, timeOnRoad: 0 };
  const pressPos = new THREE.Vector3();
  let calmTime = 0;
  let scoreSeen = 0;
  const bugCount = 150;
  const swarms = Array.from({ length: 6 }, () => new THREE.Vector3());
  let swarmTimer = 0;
  const bugPos = new Float32Array(bugCount * 3);
  const bugGeo = new THREE.BufferGeometry();
  bugGeo.setAttribute('position', new THREE.BufferAttribute(bugPos, 3));
  const bugs = new THREE.Points(bugGeo, new THREE.PointsMaterial({ color: 0x1a1a1a, size: 0.025, transparent: true, opacity: 0 }));
  bugs.frustumCulled = false;
  scene.add(bugs);
  let started = false;
  let hintTime = 0;
  const incidents = new Map<Vehicle, VehicleIncident>();
  let acc = 0;
  let step = 0;
  const contacts = new Map<string, { start: number; last: number }>();

  const hud = {
    damage: $('damage'), best: $('best'), speed: $('speed'), ads: $('ads'), events: $('events'),
    briefs: $('briefs'), small: $('small'), notices: $('notices'), paperWeather: $('paperWeather'), paperLotto: $('paperLotto'),
    power: $('power'), powerBar: $('power').querySelector('i') as HTMLElement,
    timerLabel: $('timerLabel'), timerValue: $('timerValue'), timerBar: $('timerBar'), start: $('start'), root: $('hud'),
    menuWeather: $('menuWeatherVal'), menuCamera: $('menuCameraVal'), menuBest: $('menuBest'), wasted: $('wasted'), pulse: $('pulse'),
    photo: $('photo') as HTMLImageElement, deck: $('deck'), facts: $('facts'), hint: $('hint'), blood: $('blood'), timer: $('timer'),
    hpFill: $('hpFill'), hpText: $('hpText'), sisuFill: $('sisuFill'), sisuText: $('sisuText'), sisuOrb: $('sisuOrb'), tunnel: $('tunnel'),
    paper: $('paper'), masthead: $('masthead'), headline: $('headline'), story: $('story'), paperDate: $('paperDate'), paperSub: $('paperSub'),
  };
  const begin = () => {
    if (started) return;
    started = true;
    audio.start();
    hud.start.classList.add('hidden');
    hud.root.classList.remove('menu');
    input.lock();
  };
  $('menuStart').addEventListener('click', begin);
  $('menuWeather').addEventListener('click', () => sky.randomize());
  $('menuCamera').addEventListener('click', () => { cameraMode = (cameraMode + 1) % 3; });
  window.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') begin(); });
  renderer.domElement.addEventListener('click', () => { if (started) input.lock(); });
  const CAMERA_NAMES = ['Back mount', 'Eyes', 'Orbit'];

  const heading = () => new THREE.Vector3(Math.cos(moose.yaw), 0, -Math.sin(moose.yaw));

  const reset = () => {
    traffic.reset();
    const sx = Number(params.get('x') ?? START.x), sz = laneZ(sx, Number(params.get('off') ?? START_OFFSET));
    moose.root.set(sx, groundHeight(sx, sz), sz);
    moose.yaw = Math.PI / 2;
    moose.reset();
    contacts.clear();
    incidents.clear();
    roundTime = ROUND_TIME;
    scoreSeen = 0;
    calmTime = 0;
    Object.assign(behaviour, { jumps: 0, sprintTime: 0, swam: false, bridgeDive: false, sisuUsed: 0, standUps: 0, limping: false, timeOnRoad: 0 });
    state = 'run';
    runSpeed = 0;
    runVel.set(0, 0, 0);
    airborne = false;
    jumpHold = -1;
    score = 0;
    slowmo = 0;
    wasted = frozen = false;
    camYaw = moose.yaw + Math.PI;
    gimbal = moose.yaw;
    hud.wasted.classList.add('hidden');
    hud.paper.classList.add('hidden');
    hud.blood.replaceChildren();
    hud.timer.classList.remove('urgent');
    renderer.domElement.classList.remove('wasted', 'hit');
  };

  const endRound = (outcome: Incident['outcome']) => {
    state = 'done';
    frozen = true;
    traffic.mute();
    const alive = moose.health > 0;
    if (alive && score > best) {
      best = score;
      localStorage.setItem('hirviturvat-best', String(best));
    }
    for (const [car, inc] of incidents) { inc.damage = car.damage; inc.wheelsLost = car.wheelsLost; }
    behaviour.limping = moose.injuredLegs.size > 0;
    const paper = compose({
      outcome, vehicles: [...incidents.values()], score, mooseHealth: moose.health, period: sky.period, weather: sky.weather, moose: behaviour,
    });
    hud.paper.className = `${paper.tone} tier-${paper.tier}`;
    // the press photo: a random angle on the moose, a little above, from 7 to 13 metres
    const a = Math.random() * Math.PI * 2, d = 7 + Math.random() * 6;
    pressPos.set(moose.torsoPos.x + Math.cos(a) * d, 0, moose.torsoPos.z + Math.sin(a) * d);
    pressPos.y = Math.max(surfaceHeight(pressPos.x, pressPos.z) + 1.2, moose.torsoPos.y + 1 + Math.random() * 3);
    hud.masthead.textContent = MASTHEAD[paper.tone];
    hud.headline.textContent = paper.headline;
    hud.deck.textContent = paper.deck;
    hud.story.innerHTML = paper.body.map((p) => `<p>${p}</p>`).join('');
    hud.paperDate.textContent = `${new Date().toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Irtonumero 2 mk.`;
    hud.facts.innerHTML = [
      ['Vahingot', euro(score)], ['Ajoneuvoja', String(incidents.size)], ['Hirvi', alive ? `selvisi, kunto ${Math.round(moose.health)} %` : 'kuoli'],
      ['Olosuhteet', conditions(sky.clock(), sky.period, sky.weather)],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const cls = classifieds();
    hud.ads.innerHTML = cls.ads.map(([t, b], i) => `<div class="ad${i % 2 ? ' box2' : ''}"><b>${t}</b>${b}</div>`).join('');
    hud.events.innerHTML = cls.events.map((e) => `<li>${e}</li>`).join('');
    const fill = pageFiller(sky.period, sky.weather, paper.tier);
    hud.paperWeather.textContent = fill.weather;
    hud.paperLotto.textContent = fill.lotto;
    hud.briefs.innerHTML = fill.briefs.map(([t, b]) => `<h4>${t}</h4><p>${b}</p>`).join('');
    hud.small.innerHTML = fill.small.map((t) => `<p>${t}</p>`).join('');
    hud.notices.innerHTML = fill.notices.map(([t, items]) => `<b>${t}</b>${items.map((i) => `<p>${i}</p>`).join('')}`).join('');
    hud.paperSub.textContent = alive
      ? `Tulos ${euro(score)}. Ennätys ${euro(best)}. Paina R.`
      : `Hirvi kuoli. Tulos ei kirjaudu. Ennätys ${euro(best)}. Paina R.`;
    capturePending = true;
    hud.paper.classList.remove('hidden');
    hud.wasted.classList.add('hidden');
    capturePending = false;
    setTimeout(() => { capturePending = true; }, 120);
    renderer.domElement.classList.remove('wasted', 'hit');
  };

  const triggerWasted = () => {
    if (wasted) return;
    wasted = true;
    slowmo = 1.6;
    renderer.domElement.classList.add('wasted');
    hud.wasted.classList.remove('hidden');
    splatter(6 + Math.floor(Math.random() * 6));
  };

  // blood on the lens: a handful of drops, more with each hard hit
  const splatter = (n: number) => {
    for (let i = 0; i < n; i++) {
      const d = document.createElement('i');
      const size = 30 + Math.random() * 160;
      d.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size * (0.6 + Math.random() * 0.8)}px;animation-delay:${Math.random() * 0.3}s`;
      hud.blood.appendChild(d);
    }
  };

  const partName = (v: Vehicle, p: THREE.Vector3) => {
    const l = v.group.worldToLocal(p.clone());
    const t = v.type;
    if (l.x > t.len / 2 - 1) return 'head-on';
    if (l.x < -t.len / 2 + 1) return 'from behind';
    if (l.y > t.bodyH / 2 + 0.2) return 'on the windscreen and roof';
    return 'in the side';
  };

  const record = (v: Vehicle, p: THREE.Vector3, viaMoose: boolean) => {
    if (incidents.has(v)) return;
    incidents.set(v, {
      name: v.type.name, speed: v.vel.length(), part: viaMoose ? partName(v, p) : '', driver: v.driver.kind,
      braked: v.driver.braked, swerved: v.driver.swerved, secondary: !viaMoose, damage: 0, wheelsLost: 0, boat: !('skill' in v),
    });
  };

  const takeOff = (vel: THREE.Vector3) => {
    moose.release(vel);
    moose.stress = 1;
    state = 'flight';
    flightTime = 0;
  };

  // release the ragdoll just before a car reaches the running moose, so the car meets real mass
  const nearCar = () => {
    const probe = [moose.torsoPos, moose.parts[2].mesh.position];
    const local = new THREE.Vector3();
    for (const car of traffic.vehicles) {
      const t = car.type;
      // release only when contact is really imminent: a small skin plus one step of closing speed
      const closing = car.vel.clone().sub(state === 'run' ? runVel : moose.velocity).length();
      const margin = 0.3 + closing * FIXED_DT * 1.5;
      for (const p of probe) {
        car.group.worldToLocal(local.copy(p));
        if (Math.abs(local.x) < t.len / 2 + margin && Math.abs(local.z) < t.w / 2 + margin && local.y > -1 && local.y < 3.5) return true;
      }
    }
    return false;
  };

  const handleContacts = (dt: number) => {
    step++;
    events.drainContactForceEvents((ev) => {
      const h1 = ev.collider1(), h2 = ev.collider2();
      const key = h1 < h2 ? `${h1}:${h2}` : `${h2}:${h1}`;
      let c = contacts.get(key);
      if (!c || c.last < step - 2) { c = { start: step, last: step }; contacts.set(key, c); }
      c.last = step;
      if (step - c.start > 24) return;
      const impulse = ev.maxForceMagnitude() * dt;
      for (const [a, b] of [[h1, h2], [h2, h1]]) {
        const ground = b === terrain.groundHandle;
        const car = traffic.byCollider.get(a);
        const otherCar = traffic.byCollider.get(b);
        const part = moose.byCollider.get(a);
        const otherPart = moose.byCollider.get(b);
        if (part && otherCar && !moose.launched) takeOff(runVel.clone().setY(airVy));
        const otherStatic = !otherCar && !otherPart;
        // a driving vehicle touching something static (bridge deck, rails, piers) is not a crash.
        // Damage also needs the moose close to the action, or a vehicle that has already crashed.
        const mooseNear = moose.torsoPos.distanceTo(car ? car.pos : new THREE.Vector3()) < 70;
        if (car && !ground && impulse > 60 && !(otherStatic && car.driving) && (mooseNear || !car.driving)) {
          const point = otherCar?.pos ?? otherPart?.mesh.position ?? world.getCollider(b)?.translation();
          const p = point ? new THREE.Vector3(point.x, point.y, point.z) : car.pos;
          const dmg = traffic.impact(car, p, impulse, otherCar, chaos);
          if (dmg === 0) continue;
          if (!otherCar || a < b) score += dmg;
          if (impulse > 250) record(car, p, !!otherPart);
          audio.crash(p, impulse / 6000);
          if (otherPart && impulse > 400) triggerWasted();
        }
        if (part && impulse > 40) {
          moose.injure(part, impulse, ground);
          if (impulse > 1200 && wasted) splatter(1 + Math.floor(impulse / 2500));
          if (ground || (!otherCar && !otherPart)) audio.thud(part.mesh.position, impulse / 2500);
        }
      }
    });
  };

  // speed tags floating above cars
  const tags = new Map<object, HTMLElement>();
  const tagLayer = $('tags');
  const ndc = new THREE.Vector3();
  const updateCarTags = () => {
    const alive = new Set<object>();
    for (const car of traffic.vehicles) {
      const p = car.pos;
      p.y += car.type.bodyH + (car.type.boxes[0].h) + 0.9;
      ndc.copy(p).project(camera);
      const dist = p.distanceTo(camera.position);
      let visible = ndc.z < 1 && Math.abs(ndc.x) < 0.85 && Math.abs(ndc.y) < 0.85 && dist < 130;
      // hidden behind the terrain, or tucked behind a closer vehicle on screen
      if (visible) {
        for (let k = 1; k < 9 && visible; k++) {
          const q = camera.position.clone().lerp(p, k / 9);
          if (q.y < surfaceHeight(q.x, q.z) + 0.4) visible = false;
        }
      }
      if (visible) {
        for (const o of traffic.vehicles) {
          if (o === car || o.pos.distanceTo(camera.position) >= dist) continue;
          const on = o.pos.clone().project(camera);
          if (Math.hypot(on.x - ndc.x, (on.y - ndc.y) * 0.6) < 0.05) { visible = false; break; }
        }
      }
      let el = tags.get(car);
      if (!visible) { el?.remove(); tags.delete(car); continue; }
      if (!el) {
        el = document.createElement('div');
        el.className = 'carTag';
        el.innerHTML = '<span class="arr">➜</span><span class="txt"></span>';
        tagLayer.appendChild(el);
        tags.set(car, el);
      }
      alive.add(car);
      const ahead = ndc.clone();
      ndc.copy(p).addScaledVector(car.forward, 3).project(camera);
      const angle = Math.atan2(-(ndc.y - ahead.y), ndc.x - ahead.x);
      el.style.left = `${((ahead.x + 1) / 2) * innerWidth}px`;
      el.style.top = `${((1 - ahead.y) / 2) * innerHeight}px`;
      (el.firstElementChild as HTMLElement).style.transform = `rotate(${angle}rad)`;
      (el.lastElementChild as HTMLElement).textContent = `${Math.round(car.vel.length() * 3.6)} km/h ${car.type.name}`;
      el.classList.toggle('crashed', !car.driving);
    }
    for (const [car, el] of tags) if (!alive.has(car)) { el.remove(); tags.delete(car); }
  };

  const focus = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const timer = new THREE.Timer();

  const frame = () => {
    requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    // bullet time, Max Payne style: Tab toggles it, stamina pays for it, the moose keeps its own pace
    if (input.justPressed('Tab')) bulletTime = !bulletTime;
    if (bulletTime && (moose.stamina < 3 || state === 'done')) bulletTime = false;
    if (bulletTime) moose.stamina = Math.max(0, moose.stamina - 9 * dt);
    renderer.domElement.classList.toggle('bullet', bulletTime && slowmo <= 0);
    const timeScale = slowmo > 0 ? 0.18 : bulletTime ? 0.3 : 1;
    slowmo = Math.max(0, slowmo - dt);
    const sdt = dt * timeScale;

    if (input.justPressed('KeyR')) { bulletTime = false; reset(); }
    if (input.justPressed('KeyT')) sky.randomize();
    if (input.justPressed('KeyQ') && moose.stamina >= 40 && moose.shield <= 0 && state !== 'done') {
      moose.stamina -= 40;
      moose.shield = 6;
      moose.stress = Math.min(1, moose.stress + 0.3);
      behaviour.sisuUsed++;
      audio.grunt(moose.torsoPos);
    }
    moose.shield = Math.max(0, moose.shield - dt);
    if (score > scoreSeen) { moose.stamina = Math.min(100, moose.stamina + (score - scoreSeen) / 80); scoreSeen = score; }
    // stress: traffic nearby and standing on the road wind the moose up, the forest calms it down.
    // Stamina drains at a gallop and under stress, and recovers at a walk.
    {
      const off = Math.abs(roadOffset(moose.torsoPos.x, moose.torsoPos.z));
      const carsNear = traffic.cars.filter((c) => c.driving && c.pos.distanceTo(moose.torsoPos) < 45).length;
      const up = carsNear * 0.12 + (off < 5 ? 0.2 : 0) + (state === 'flight' ? 0.5 : 0);
      const down = off > 9 && carsNear === 0 ? 0.15 : 0.06;
      moose.stress = THREE.MathUtils.clamp(moose.stress + (up - down) * dt, 0, 1);
      const sprinting = state === 'run' && runSpeed > WALK_SPEED + 1;
      moose.stamina = THREE.MathUtils.clamp(moose.stamina + (sprinting ? -4 : state === 'run' && runSpeed < 0.5 ? 3 : 1.5) * dt - moose.stress * 1.2 * dt, 0, 100);
    }
    if (input.justPressed('F1')) cameraMode = 0;
    if (input.justPressed('F2')) cameraMode = 1;
    if (input.justPressed('F3')) cameraMode = 2;
    if (input.justPressed('KeyC')) cameraMode = (cameraMode + 1) % 3;
    const m = input.consumeMouse();
    camYaw -= m.x * 0.003;
    camPitch = THREE.MathUtils.clamp(camPitch + m.y * 0.002, deg(-8), deg(60));

    moose.rising = Math.max(0, moose.rising - dt / 1.1);
    if (state === 'run' && started) {
      const cf = new THREE.Vector3(-Math.cos(camYaw), 0, Math.sin(camYaw));
      const cr = new THREE.Vector3(-cf.z, 0, cf.x);
      const mv = new THREE.Vector3();
      if (input.down('KeyW')) mv.add(cf);
      if (input.down('KeyS')) mv.sub(cf);
      if (input.down('KeyD')) mv.add(cr);
      if (input.down('KeyA')) mv.sub(cr);
      const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
      const boost = moose.shield > 0 ? 1.2 : 1;
      if (moose.rising > 0) mv.set(0, 0, 0);
      const wanted = mv.lengthSq() > 0 ? mv.normalize().multiplyScalar((sprint ? RUN_SPEED : WALK_SPEED) * moose.mobility * boost) : mv;
      const control = airborne ? 1.2 : wanted.lengthSq() > 0 ? 5 : 9;
      runVel.lerp(wanted, 1 - Math.exp(-control * dt));
      runSpeed = runVel.length();
      const prev = moose.root.clone();
      moose.root.addScaledVector(runVel, dt);
      const prevOff = roadOffset(prev.x, prev.z), off = roadOffset(moose.root.x, moose.root.z);
      for (const fz of [FENCE_Z, -FENCE_Z]) {
        const crosses = (prevOff - fz) * (off - fz) <= 0 && prevOff !== off;
        const inGap = fz > 0 && Math.abs(moose.root.x) < FENCE_GAP;
        if (crosses && !inGap) { moose.root.copy(prev); runVel.set(0, 0, 0); }
      }
      const side = Math.sign(START_OFFSET);
      const minOff = side > 0 ? AREA_FRONT : -AREA_BACK, maxOff = side > 0 ? AREA_BACK : -AREA_FRONT;
      const clampedX = THREE.MathUtils.clamp(moose.root.x, -AREA_X, AREA_X);
      const clampedZ = THREE.MathUtils.clamp(moose.root.z, laneZ(moose.root.x, minOff), laneZ(moose.root.x, maxOff));
      if (clampedX !== moose.root.x || clampedZ !== moose.root.z) {
        if (clampedZ !== moose.root.z && Math.abs(moose.root.x) < 45) hintTime = 1.5;
        runVel.multiplyScalar(0.5);
      }
      moose.root.set(clampedX, moose.root.y, clampedZ);
      // swimming: the body floats a metre under the surface and crawls along
      const bottom = surfaceHeight(moose.root.x, moose.root.z);
      const swimming = bottom < WATER_Y - 1.2;
      const ground = swimming ? WATER_Y - 1.1 : bottom;
      if (swimming && !airborne) runVel.multiplyScalar(Math.exp(-3 * dt));
      if (swimming) { behaviour.swam = true; if (airborne) behaviour.bridgeDive = true; }
      if (runSpeed > WALK_SPEED + 1) behaviour.sprintTime += dt;
      if (Math.abs(roadOffset(moose.root.x, moose.root.z)) < 5) behaviour.timeOnRoad += dt;
      if (airborne) {
        airVy -= 9.81 * dt;
        moose.root.y += airVy * dt;
        if (moose.root.y <= ground) {
          airborne = false;
          audio.thud(moose.root, Math.min(1, -airVy / 8));
          runVel.multiplyScalar(0.8);
        }
      }
      if (!airborne) moose.root.y = ground;
      // from the eyes the mouse turns the moose itself; otherwise it turns toward where it runs
      if ((runSpeed > 0.4 || cameraMode === 1) && !airborne) {
        const targetYaw = cameraMode === 1 && runSpeed <= 0.4 ? camYaw + Math.PI : Math.atan2(-runVel.z, runVel.x);
        let d = targetYaw - moose.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const turn = d * (1 - Math.exp(-9 * dt));
        yawRate = THREE.MathUtils.lerp(yawRate, turn / Math.max(dt, 1e-3), 1 - Math.exp(-10 * dt));
        moose.yaw += turn;
      } else {
        yawRate *= Math.exp(-10 * dt);
      }
      if (!airborne) gaitPhase += (2 + runSpeed * 0.55) * Math.min(1, runSpeed / 1.5) * dt;
      const lean = THREE.MathUtils.clamp(yawRate * runSpeed * 0.012, -0.3, 0.3);
      const tilt = airborne ? THREE.MathUtils.clamp(-airVy * 0.04, -0.35, 0.3) : -0.06 * (runSpeed / RUN_SPEED);
      const fold = airborne ? Math.min(1, (moose.root.y - ground) / 0.6) : 0;
      const gait = airborne ? 0 : Math.min(1, runSpeed / 1.5) * (0.3 + 0.28 * Math.min(1, runSpeed / RUN_SPEED));
      moose.setPose(moose.root, moose.yaw, false, gait, gaitPhase, lean, tilt, fold);
      if (!airborne && input.down('Space')) {
        jumpHold = jumpHold < 0 ? 0 : jumpHold + dt;
      } else if (jumpHold >= 0) {
        const power = THREE.MathUtils.clamp(jumpHold / 0.5, 0.15, 1);
        airVy = 2.5 + 4.5 * power;
        behaviour.jumps++;
        runVel.addScaledVector(heading(), 1 + 2.5 * power);
        airborne = true;
        if (power > 0.5) audio.grunt(moose.root);
        jumpHold = -1;
      }
      if (nearCar()) takeOff(runVel.clone().setY(airVy));
    }

    acc += frozen ? 0 : dt;
    while (acc >= FIXED_DT) {
      acc -= FIXED_DT;
      world.timestep = FIXED_DT * timeScale;
      world.step(events);
      handleContacts(world.timestep);
    }
    moose.sync();
    const torso = moose.torsoPos;
    const visible = Math.abs(roadOffset(torso.x, torso.z)) < FENCE_Z;
    // only the moose may stir up traffic: on the road, or already flying
    chaos = moose.launched || (visible && Math.abs(roadOffset(torso.x, torso.z)) < 9);
    const mooseVel = state === 'run' ? runVel.clone().setY(airVy) : moose.velocity;
    if (!frozen) traffic.update(sdt, { pos: torso, vel: mooseVel, visible }, sky.isNight, sky.wetness, sky.wind, camera.position, sky.hour);

    if (wasted && slowmo <= 0 && !hud.wasted.classList.contains('hidden')) {
      hud.wasted.classList.add('hidden');
      renderer.domElement.classList.remove('wasted');
      renderer.domElement.classList.add('hit');
    }
    if (state === 'run' && started) {
      roundTime -= dt;
      if (roundTime <= 0) endRound('none');
    } else if (state === 'flight') {
      flightTime += dt;
      // a surviving moose gets back up once everything has settled and carries on, limping or not
      calmTime = moose.maxSpeed < 0.6 && flightTime > 1.5 ? calmTime + dt : 0;
      const followTotal = FOLLOW_TIME + (wasted ? 1.6 : 0);
      if (moose.health > 0 && calmTime > 1.2 && roundTime > 3) {
        moose.standUp();
        audio.grunt(moose.torsoPos);
        behaviour.standUps++;
        behaviour.limping = moose.injuredLegs.size > 0;
        runVel.set(0, 0, 0);
        airborne = false;
        calmTime = 0;
        camYaw = moose.yaw + Math.PI;
        gimbal = moose.yaw;
        state = 'run';
      } else if (flightTime > followTotal) {
        endRound(incidents.size ? 'crash' : 'nearmiss');
      }
    }

    // camera orbits the moose; mouse turns it
    // cameras: 0 rides the back and only lets go gradually after the hit, 1 looks out of the eyes, 2 follows from afar
    const orbit = new THREE.Vector3(Math.cos(camYaw) * Math.cos(camPitch), Math.sin(camPitch), -Math.sin(camYaw) * Math.cos(camPitch));
    const release = state === 'run' ? 0 : THREE.MathUtils.smoothstep(flightTime, 0.4, 4);
    moose.headMat.visible = cameraMode !== 1;
    let snap = 1 - Math.exp(-14 * dt);
    if (cameraMode === 1) {
      const head = moose.head.mesh;
      const q = head.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.3)));
      if (state === 'run') q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -camPitch * 0.5)));
      desired.copy(head.localToWorld(new THREE.Vector3(0.02, 0.14, 0)));
      desired.y += 0.012 * Math.sin(breathPhase);
      focus.copy(desired).add(new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(5));
      snap = 1;
    } else if (cameraMode === 2) {
      const anchor = state === 'run' ? moose.root.clone().setY(moose.root.y + 1.9) : torso;
      focus.copy(anchor);
      desired.copy(anchor).addScaledVector(orbit, state === 'run' ? 6.5 + 2 * (runSpeed / RUN_SPEED) : 9);
      snap = state === 'run' ? snap : 1 - Math.exp(-4 * dt);
    } else {
      // F1: action camera strapped to the back. The mount rides the body rigidly, the gimbal keeps the
      // horizon level and pans smoothly. After a hit it stays mounted, then slowly lets go into an orbit.
      const t = moose.torso.mesh;
      const mount = t.localToWorld(new THREE.Vector3(-1.05, -0.55, 0));
      const heading = state === 'run' ? moose.yaw : Math.atan2(-moose.velocity.z, moose.velocity.x);
      let pan = camYaw + Math.PI - heading;
      pan = Math.atan2(Math.sin(pan), Math.cos(pan));
      pan = THREE.MathUtils.clamp(pan, -deg(100), deg(100));
      const gimbalYaw = heading + pan;
      const dy = Math.atan2(Math.sin(gimbalYaw - gimbal), Math.cos(gimbalYaw - gimbal));
      gimbal += dy * (1 - Math.exp(-6 * dt));
      const tilt = -camPitch * 0.6 - deg(4);
      const look = new THREE.Vector3(Math.cos(gimbal) * Math.cos(tilt), Math.sin(tilt), -Math.sin(gimbal) * Math.cos(tilt));
      const orbitPos = torso.clone().addScaledVector(orbit, 7);
      desired.copy(mount).lerp(orbitPos, release);
      focus.copy(mount).addScaledVector(look, 6).lerp(torso, release);
      snap = THREE.MathUtils.lerp(1, 1 - Math.exp(-4 * dt), release);
    }
    if (state === 'done') { desired.copy(pressPos); focus.copy(torso); snap = 1; }
    if (cameraMode === 2 || (cameraMode === 0 && release > 0.5)) desired.y = Math.max(desired.y, Math.max(surfaceHeight(desired.x, desired.z), WATER_Y) + 0.7);
    camera.position.lerp(desired, started ? snap : 1);
    camTarget.lerp(focus, cameraMode !== 2 ? 1 : Math.max(snap, 1 - Math.exp(-20 * dt)));
    camera.lookAt(camTarget);
    const wantFov = cameraMode === 1 ? 75 : cameraMode === 0 ? THREE.MathUtils.lerp(95, 60, release) : 60 + 8 * Math.min(1, runSpeed / RUN_SPEED);
    if (Math.abs(camera.fov - wantFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, wantFov, 1 - Math.exp(-5 * dt));
      camera.updateProjectionMatrix();
    }

    // body: breathing and pulse follow effort, audible only from the eyes
    const effort = state === 'run' ? runSpeed / RUN_SPEED : 1;
    const breathRate = 0.35 + 0.9 * effort + 0.6 * moose.stress;
    breathPhase += dt * breathRate * Math.PI * 2;
    moose.breathe(breathPhase);
    const bpm = 40 + 60 * effort + 100 * moose.stress;
    const eyes = cameraMode === 1;
    // the moose's own body is the loudest thing it knows; the camera only decides how close we sit to it
    // a dead moose has no heartbeat, no breath, no rustle; the body simply goes quiet
    const dead = moose.health <= 0;
    const self = dead ? 0 : moose.launched ? 0.3 : eyes ? 1 : cameraMode === 0 ? 0.7 : 0.5;
    const gait = state === 'run' && !airborne ? Math.min(1, runSpeed / RUN_SPEED) : 0;
    audio.setBody({
      breathRate, breathLevel: self * (0.3 + 0.5 * effort) + (dead ? 0 : 0.1 * moose.stress), bpm,
      pulseLevel: dead ? 0 : 0.1 + 0.3 * self + 0.5 * moose.stress, self, gait, gaitPhase,
    });
    pulsePhase = (pulsePhase + (dt * bpm) / 60) % 1;
    hud.pulse.style.opacity = `${(eyes ? 0.15 : 0) + 0.45 * moose.stress * Math.pow(Math.max(0, Math.sin(pulsePhase * Math.PI * 2)), 6)}`;
    // hoofbeats: two per gait cycle, louder at speed, voiced by the surface underfoot
    if (state === 'run' && !airborne && runSpeed > 0.5) {
      const beat = Math.floor(gaitPhase / Math.PI);
      if (beat !== lastBeat) {
        lastBeat = beat;
        const off = Math.abs(roadOffset(moose.root.x, moose.root.z));
        const onDeck = moose.root.x > 142 && moose.root.x < 186 && off < 6;
        audio.hoof(moose.root, 0.3 + 0.7 * gait, onDeck ? 'deck' : off < 4.4 ? 'asphalt' : 'forest');
        audio.step(0.4 + 0.6 * gait);
      }
    }

    sky.update(dt, camera.position, focus);
    // crude buoyancy for a ragdoll that ends up in the lake
    if (moose.launched) {
      for (const part of moose.parts) {
        const t = part.body.translation();
        if (t.y < WATER_Y) {
          part.body.applyImpulse({ x: 0, y: part.mass * 9.81 * 1.25 * FIXED_DT, z: 0 }, true);
          const v = part.body.linvel();
          part.body.setLinvel({ x: v.x * 0.97, y: v.y * 0.95, z: v.z * 0.97 }, true);
        }
      }
    }
    terrain.setWet(sky.wetness);
    audio.setListener(camera.position, camTarget.clone().sub(camera.position));
    const day = sky.daylight;
    const clear = sky.weather === 'sunny' || sky.weather === 'partly cloudy';
    audio.setEnvironment({
      wind: Math.abs(sky.wind) / 5,
      rain: sky.rainAmount,
      birds: day * (sky.weather === 'rain' ? 0.15 : 0.8),
      cuckoo: clear && (sky.period === 'evening' || sky.period === 'morning') ? 0.7 : 0.1 * day,
    });
    audio.update(dt);

    // small mosquito swarms drift about at random; the whine comes only when one passes the head
    swarmTimer -= dt;
    if (swarmTimer <= 0) {
      swarmTimer = 4 + Math.random() * 6;
      const k = swarms[Math.floor(Math.random() * swarms.length)];
      const r = 3 + Math.random() * 14, a = Math.random() * Math.PI * 2;
      k.set(moose.root.x + Math.cos(a) * r, 0, moose.root.z + Math.sin(a) * r);
      k.y = surfaceHeight(k.x, k.z) + 0.6 + Math.random() * 1.6;
    }
    const density = sky.period === 'evening' || sky.period === 'night' ? 1 : 0.5;
    (bugs.material as THREE.PointsMaterial).opacity = 0.7 * density;
    const tt = performance.now() * 0.001;
    const per = bugCount / swarms.length;
    let near = 0;
    const head = moose.head.mesh.position;
    swarms.forEach((k, si) => {
      k.x += Math.sin(tt * 0.3 + si) * 0.4 * dt;
      k.z += Math.cos(tt * 0.25 + si * 2) * 0.4 * dt;
      near = Math.max(near, 1 - k.distanceTo(head) / 2.5);
      for (let j = 0; j < per; j++) {
        const i = si * per + j, o = i * 3;
        bugPos[o] = k.x + Math.sin(tt * 3.1 + i) * 0.4 + Math.sin(tt * 0.7 + j) * 0.3;
        bugPos[o + 1] = k.y + Math.sin(tt * 2.3 + i * 2) * 0.3;
        bugPos[o + 2] = k.z + Math.cos(tt * 2.7 + i) * 0.4 + Math.cos(tt * 0.9 + j) * 0.3;
      }
    });
    (bugGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    audio.setMosquito(Math.max(0, near) * density, density > 0.5 ? 1 : 0);
    hintTime = Math.max(0, hintTime - dt);
    hud.hint.style.opacity = hintTime > 0 ? '1' : '0';
    if (!started) {
      hud.menuWeather.textContent = `${sky.weather}, ${sky.period}`;
      hud.menuCamera.textContent = CAMERA_NAMES[cameraMode];
      hud.menuBest.textContent = euro(best);
    }
    hud.damage.textContent = euro(score);
    hud.damage.classList.toggle('dead', moose.health <= 0);
    hud.best.textContent = euro(best);
    hud.hpFill.style.height = `${moose.health}%`;
    hud.hpText.textContent = `${Math.round(moose.health)}`;
    hud.sisuFill.style.height = `${moose.stamina}%`;
    hud.sisuText.textContent = `${Math.round(moose.stamina)}`;
    hud.sisuOrb.classList.toggle('active', moose.shield > 0);
    hud.sisuOrb.classList.toggle('ready', moose.stamina >= 40 && moose.shield <= 0);
    // low stamina closes the view into a tunnel, high stamina makes the world crisp and bright
    hud.tunnel.style.opacity = `${THREE.MathUtils.clamp((30 - moose.stamina) / 30, 0, 1) * 0.9}`;
    const canvasEl = renderer.domElement;
    if (!canvasEl.classList.contains('wasted') && !canvasEl.classList.contains('hit') && !canvasEl.classList.contains('bullet')) {
      const k = THREE.MathUtils.clamp((moose.stamina - 50) / 50, -1, 1);
      canvasEl.style.filter = `saturate(${(1 + 0.2 * k).toFixed(2)}) brightness(${(1 + 0.08 * k).toFixed(2)}) contrast(${(1 + 0.05 * k).toFixed(2)})`;
    } else canvasEl.style.filter = '';
    hud.speed.textContent = `${Math.round((state === 'run' ? runSpeed : moose.velocity.length()) * 3.6)} km/h`;
    updateCarTags();
    const followTotal = FOLLOW_TIME + (wasted ? 1.6 : 0);
    hud.timerLabel.textContent = state === 'run' ? 'Time' : state === 'flight' ? 'Damage window' : 'Round over';
    const left = state === 'run' ? roundTime : state === 'flight' ? Math.max(0, followTotal - flightTime) : 0;
    hud.timer.classList.toggle('urgent', state === 'flight' && left < 4);
    hud.timerValue.textContent = state === 'done' ? '0 s' : `${Math.ceil(left)} s`;
    hud.timerBar.style.width = `${(left / (state === 'run' ? ROUND_TIME : followTotal)) * 100}%`;
    hud.power.style.display = jumpHold >= 0 ? 'block' : 'none';
    if (jumpHold >= 0) hud.powerBar.style.width = `${Math.min(100, (jumpHold / 0.5) * 100).toFixed(1)}%`;

    renderer.render(scene, camera);
    if (capturePending) {
      capturePending = false;
      hud.photo.src = renderer.domElement.toDataURL('image/jpeg', 0.7);
    }
  };
  reset();
  frame();
}

main().catch((e) => {
  console.error(e);
  document.getElementById('start')!.textContent = 'Virhe: ' + e;
});
