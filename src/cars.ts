import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EngineSound, GameAudio } from './audio';
import type { DriverKind } from './report';
import { ROAD_HALF_LEN, LANE_Z, roadHeight, roadSlope, roadSlopeZ, laneZ, roadOffset, GROUP_CAR, groups, BRIDGE_X0, BRIDGE_X1, WATER_Y } from './terrain';

interface Box { x0: number; x1: number; h: number; y0?: number; w?: number; taper?: [number, number] }
interface CarType {
  name: string; len: number; w: number; bodyH: number; boxes: Box[]; wheelXs: number[]; wheelR: number; track?: number;
  mass: number; value: number; speed: [number, number]; restitution: number; pitch: number; weight: number; colors: number[];
}
const MODERN = [0xf2f2f2, 0xc8cacc, 0x6e7073, 0x1c1c1e, 0x1f2f55, 0x9b1b1b];
const TYPES: CarType[] = [
  { name: 'Hatchback', len: 3.9, w: 1.7, bodyH: 0.55, boxes: [{ x0: -1.75, x1: 0.55, h: 0.62, taper: [0.55, 0.15] }], wheelXs: [1.25, -1.25], wheelR: 0.3,
    mass: 1100, value: 0.8, speed: [20, 24], restitution: 0.15, pitch: 1.25, weight: 3, colors: [...MODERN, 0x2a6fbf, 0xf0d040] },
  { name: 'Sedan', len: 4.7, w: 1.8, bodyH: 0.55, boxes: [{ x0: -1.6, x1: 0.9, h: 0.5, taper: [0.65, 0.45] }], wheelXs: [1.45, -1.45], wheelR: 0.33,
    mass: 1450, value: 1, speed: [20, 25], restitution: 0.15, pitch: 1, weight: 3, colors: MODERN },
  { name: 'Estate', len: 4.9, w: 1.85, bodyH: 0.58, boxes: [{ x0: -2.3, x1: 0.8, h: 0.55, taper: [0.6, 0.12] }], wheelXs: [1.6, -1.55], wheelR: 0.33,
    mass: 1650, value: 1.1, speed: [20, 24], restitution: 0.15, pitch: 0.95, weight: 3, colors: MODERN },
  { name: 'SUV', len: 4.7, w: 1.9, bodyH: 0.75, boxes: [{ x0: -2.1, x1: 0.7, h: 0.62, taper: [0.45, 0.12] }], wheelXs: [1.45, -1.45], wheelR: 0.38,
    mass: 2100, value: 1.4, speed: [20, 24], restitution: 0.12, pitch: 0.85, weight: 3, colors: MODERN },
  { name: 'Van', len: 5.3, w: 1.95, bodyH: 0.8, boxes: [{ x0: -2.6, x1: 1.9, h: 0.95, taper: [0.35, 0.05] }], wheelXs: [1.7, -1.7], wheelR: 0.34,
    mass: 2200, value: 1.3, speed: [19, 23], restitution: 0.1, pitch: 0.8, weight: 2, colors: [0xececec, 0x2b4c8c, 0xd6c66a, 0x9a9a9a] },
  { name: 'Sports car', len: 4.4, w: 1.85, bodyH: 0.38, boxes: [{ x0: -1.5, x1: 0.1, h: 0.45, taper: [0.6, 0.35] }], wheelXs: [1.35, -1.35], wheelR: 0.31,
    mass: 1500, value: 2.6, speed: [23, 31], restitution: 0.55, pitch: 1.7, weight: 1.2, colors: [0xd01818, 0xffc21a, 0x101010, 0xf4f4f4, 0x1f6fd0] },
  { name: 'Motorcycle', len: 2.2, w: 0.7, bodyH: 0.45, boxes: [{ x0: -0.7, x1: 0.1, h: 0.9, w: 0.5 }], wheelXs: [0.75, -0.75], wheelR: 0.32, track: 0.3,
    mass: 280, value: 1.2, speed: [22, 28], restitution: 0.2, pitch: 2.2, weight: 1.2, colors: [0x101010, 0xd01818, 0xe8e8e8, 0x2a6fbf] },
  { name: 'Bus', len: 12.5, w: 2.55, bodyH: 0.6, boxes: [{ x0: -6.2, x1: 6.2, h: 2.6, taper: [0.15, 0.05] }], wheelXs: [4.2, -3.8], wheelR: 0.5,
    mass: 14000, value: 2, speed: [19, 23], restitution: 0.05, pitch: 0.5, weight: 0.8, colors: [0x2255aa, 0xf4f4f4, 0x2e7d32, 0xd8b400] },
  { name: 'Semi truck', len: 15, w: 2.5, bodyH: 0.7, boxes: [{ x0: 5.2, x1: 7.4, h: 2.4, taper: [0.25, 0] }, { x0: -7.4, x1: 4.6, h: 2.9, y0: 0.4 }], wheelXs: [6.2, 2.6, -4.6, -6.0], wheelR: 0.5,
    mass: 30000, value: 1.6, speed: [20, 23], restitution: 0.05, pitch: 0.45, weight: 1, colors: [0x2255aa, 0xcc2222, 0xeeeeee, 0x2e7d32] },
  { name: 'Full trailer truck', len: 24, w: 2.55, bodyH: 0.7,
    boxes: [{ x0: 9.6, x1: 12, h: 2.5, taper: [0.25, 0] }, { x0: 2.2, x1: 9.2, h: 2.9, y0: 0.4 }, { x0: -12, x1: -0.2, h: 2.9, y0: 0.4 }],
    wheelXs: [11, 6.8, 3.8, -1.6, -8.8, -11], wheelR: 0.5,
    mass: 60000, value: 1.8, speed: [19, 22], restitution: 0.05, pitch: 0.4, weight: 0.6, colors: [0x2255aa, 0xcc2222, 0xeeeeee, 0xf0a020] },
];
const HEADLIGHTS = 4;
const CLEARANCE = 0.3;
const MAX_CARS = 10;

const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.2, metalness: 0.6, transparent: true, opacity: 0.62 });
const phoneGlowMat = new THREE.SpriteMaterial({ color: 0x9fd0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
// lamp glows: additive sprites that read as distant points of light long before the spotlights matter
const headGlowMat = new THREE.SpriteMaterial({ color: 0xfff1c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
const tailGlowMat = new THREE.SpriteMaterial({ color: 0xff3020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
const crackedMat = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, roughness: 0.8, transparent: true, opacity: 0.85 });
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
const lampOnMat = new THREE.MeshLambertMaterial({ color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 1.5 });
const lampOffMat = new THREE.MeshLambertMaterial({ color: 0xd8d4b8 });
const tailMat = new THREE.MeshLambertMaterial({ color: 0xaa1010, emissive: 0x660000 });
const brakeMat = new THREE.MeshLambertMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2 });

export const carMaterials = [glassMat, crackedMat, wheelMat, trimMat, lampOnMat, lampOffMat, tailMat, new THREE.MeshStandardMaterial({ color: MODERN[0], roughness: 0.45, metalness: 0.3 })];

function pickType() {
  const total = TYPES.reduce((a, t) => a + t.weight, 0);
  let r = Math.random() * total;
  for (const t of TYPES) { r -= t.weight; if (r <= 0) return t; }
  return TYPES[0];
}

function taperTop(geo: THREE.BufferGeometry, h: number, front: number, back: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) + h / 2) / h;
    const x = pos.getX(i);
    pos.setX(i, x > 0 ? x - front * k : x + back * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function dentable(geo: THREE.BufferGeometry, offset: THREE.Vector3) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  return { geo, offset, orig: pos.array.slice() as Float32Array, dent: new Float32Array(pos.count) };
}
type Dentable = ReturnType<typeof dentable>;

export class Car {
  body: RigidBodyT;
  group = new THREE.Group();
  driving = true;
  damage = 0;
  honked = false;
  wheelsLost = 0;
  cracked = false;
  smokeAcc = 0;
  colliders: number[] = [];
  private panels: Dentable[] = [];
  private wheels: THREE.Mesh[] = [];
  private glass: THREE.Mesh;
  private lamps: THREE.Mesh[] = [];
  private glows: THREE.Sprite[] = [];
  private engine: EngineSound;
  private wheelR: number;
  private rideHeight: number;
  readonly type: CarType;

  constructor(
    private world: RAPIER.World, scene: THREE.Scene, audio: GameAudio,
    public dir: 1 | -1, x: number, type?: CarType, speedScale = 1,
  ) {
    const t = type ?? pickType();
    this.type = t;
    const r = Math.random();
    const bike = t.name === 'Motorcycle';
    // riders keep their eyes on the road and react fast
    const kind: DriverKind = bike ? 'alert' : r < 0.2 ? 'phone' : r < 0.5 ? 'alert' : 'average';
    // log-normal reaction time: median 0.9 s, mostly 0.3 to 3 s, rare 4 to 5 s; never under 0.09 s
    const gauss = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    const median = bike ? 0.45 : kind === 'alert' ? 0.6 : 0.9;
    let reaction = median * Math.exp(0.55 * gauss);
    if (kind === 'phone') reaction += 1.5 + Math.random() * 2;
    reaction = THREE.MathUtils.clamp(reaction, 0.09, 5.5);
    // driving skill: how hard they dare to brake and how cleanly they place the car
    this.skill = 0.5 + Math.random() * 0.5;
    this.agility = (bike ? 3.5 : 1) * (0.7 + 0.6 * this.skill);
    this.honks = Math.random() < 0.5;
    this.driver = { kind, reaction, noticed: 0, braked: false, swerved: false, plan: null };
    this.wheelR = t.wheelR;
    const speed = (t.speed[0] + Math.random() * (t.speed[1] - t.speed[0])) * speedScale;
    this.speed = this.baseSpeed = speed;
    const color = t.colors[Math.floor(Math.random() * t.colors.length)];
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 });
    const cy = CLEARANCE + t.bodyH / 2;
    this.rideHeight = cy + 0.02;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.targetYaw(x));

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, roadHeight(x) + cy + 0.05, laneZ(x, dir * LANE_Z))
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setAngularDamping(1.5).setCcdEnabled(true),
    );
    this.body.userData = this;
    const cg = groups(GROUP_CAR, 0xffff);
    const add = (desc: RAPIER.ColliderDesc, mass: number, restitution = t.restitution) => {
      const c = world.createCollider(desc.setMass(mass).setRestitution(restitution).setCollisionGroups(cg)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(3000), this.body);
      this.colliders.push(c.handle);
    };
    add(RAPIER.ColliderDesc.cuboid(t.len / 2, t.bodyH / 2, t.w / 2).setFriction(0.5), t.mass * 0.65);
    const wheelPos: [number, number, number][] = [];
    const wy = t.wheelR - cy;
    const track = t.track ?? t.w / 2;
    for (const wx of t.wheelXs) track > 0 ? wheelPos.push([wx, wy, track], [wx, wy, -track]) : wheelPos.push([wx, wy, 0]);
    for (const [wx, wyy, wz] of wheelPos) {
      add(RAPIER.ColliderDesc.ball(t.wheelR).setTranslation(wx, wyy, wz).setFriction(1.1), (t.mass * 0.15) / wheelPos.length, 0);
    }

    if (bike) {
      this.buildMotorcycle(paint, cy);
    } else {
      const bodyGeo = new THREE.BoxGeometry(t.len, t.bodyH, t.w, 8, 2, 4);
      this.group.add(new THREE.Mesh(bodyGeo, paint));
      this.panels.push(dentable(bodyGeo, new THREE.Vector3()));
    }
    const cab = t.boxes[0];
    const cabLen = cab.x1 - cab.x0, cabX = (cab.x0 + cab.x1) / 2, cabY = t.bodyH / 2 + cab.h / 2;
    for (const b of t.boxes) {
      const len = b.x1 - b.x0, bx = (b.x0 + b.x1) / 2, by = t.bodyH / 2 + (b.y0 ?? 0) + b.h / 2, bw = b.w ?? t.w - 0.15;
      add(RAPIER.ColliderDesc.cuboid(len / 2, b.h / 2, bw / 2).setTranslation(bx, by, 0), (t.mass * 0.2) / t.boxes.length);
      if (bike) continue;
      const geo = new THREE.BoxGeometry(len, b.h, bw, 6, 2, 3);
      if (b.taper) taperTop(geo, b.h, b.taper[0], b.taper[1]);
      const mesh = new THREE.Mesh(geo, paint);
      mesh.position.set(bx, by, 0);
      this.group.add(mesh);
      this.panels.push(dentable(geo, mesh.position));
    }
    const glassGeo = new THREE.BoxGeometry(cabLen + 0.04, cab.h * 0.5, (cab.w ?? t.w - 0.15) + 0.04);
    if (cab.taper) taperTop(glassGeo, cab.h * 0.5, cab.taper[0] * 0.5, cab.taper[1] * 0.5);
    this.glass = new THREE.Mesh(glassGeo, glassMat);
    this.glass.position.set(cabX + (cab.taper ? (cab.taper[1] - cab.taper[0]) * 0.3 : 0), cabY + cab.h * 0.08, 0);
    this.glass.visible = !bike;
    if (kind === 'phone' && !bike) {
      // the tell-tale phone glow on the driver's face (left seat), bright in the dark
      this.phone = new THREE.Sprite(phoneGlowMat.clone());
      this.phone.position.set(cab.x1 - 0.7, cabY + 0.05, -Math.min(0.45, t.w / 2 - 0.45));
      this.phone.scale.set(0.45, 0.35, 1);
      this.group.add(this.phone);
    }
    const bumper = new THREE.BoxGeometry(0.15, 0.18, t.w + 0.05);
    const bf = new THREE.Mesh(bumper, trimMat); bf.position.set(t.len / 2, -t.bodyH / 2 + 0.15, 0);
    const bb = new THREE.Mesh(bumper, trimMat); bb.position.set(-t.len / 2, -t.bodyH / 2 + 0.15, 0);
    this.group.add(this.glass);
    if (!bike) this.group.add(bf, bb);
    const lampGeo = bike ? new THREE.BoxGeometry(0.08, 0.16, 0.16) : new THREE.BoxGeometry(0.08, 0.16, 0.3);
    for (const z of bike ? [0] : [-1, 1]) {
      const h = new THREE.Mesh(lampGeo, lampOffMat); h.position.set(t.len / 2 + 0.02, bike ? 0.35 : 0.05, z * (t.w / 2 - 0.3));
      const r = new THREE.Mesh(lampGeo, tailMat); r.position.set(-t.len / 2 - 0.02, bike ? 0.25 : 0.05, z * (t.w / 2 - 0.3));
      this.lamps.push(h);
      this.tails.push(r);
      const hg = new THREE.Sprite(headGlowMat.clone()), tg = new THREE.Sprite(tailGlowMat.clone());
      hg.position.copy(h.position).x += 0.15;
      hg.scale.set(2.2, 1.4, 1);
      tg.position.copy(r.position).x -= 0.15;
      tg.scale.set(1.2, 0.8, 1);
      // a fixed-size point on top, so the lamp is a visible dot even hundreds of metres away
      const far = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff6d8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, sizeAttenuation: false }));
      far.position.copy(hg.position);
      far.scale.set(0.012, 0.012, 1);
      const farT = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff4030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, sizeAttenuation: false }));
      farT.position.copy(tg.position);
      farT.scale.set(0.008, 0.008, 1);
      this.glows.push(hg, tg, far, farT);
      this.group.add(hg, tg, far, farT);
      this.group.add(h, r);
    }
    const wheelGeo = new THREE.CylinderGeometry(t.wheelR, t.wheelR, bike ? 0.12 : 0.22, 14).rotateX(Math.PI / 2);
    // single-track vehicles show one wheel per axle even though two hidden colliders keep them stable
    const visualWheels = bike ? t.wheelXs.map((wx) => [wx, wy, 0] as const) : wheelPos;
    for (const [wx, wyy, wz] of visualWheels) {
      const wm = new THREE.Mesh(wheelGeo, wheelMat);
      wm.position.set(wx, wyy, wz);
      this.wheels.push(wm);
      this.group.add(wm);
    }
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    scene.add(this.group);
    this.engine = audio.engine(t.pitch, Math.sqrt(t.mass / 1250));
    this.sync();
  }

  speed: number;
  baseSpeed: number;
  lit = false;
  laneShift = 0;
  braking = false;
  agility = 1;
  skill = 1;
  honks = false;
  driver: { kind: DriverKind; reaction: number; noticed: number; braked: boolean; swerved: boolean; plan: 'brake' | 'own' | 'opposite' | 'ditch' | null };
  private tails: THREE.Mesh[] = [];
  private phone?: THREE.Sprite;

  get pos() {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  get vel() {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  private sync() {
    const p = this.body.translation(), r = this.body.rotation();
    this.group.position.set(p.x, p.y, p.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
  }

  // forward = (cos yaw, 0, -sin yaw); follow the road tangent in the driving direction
  private targetYaw(x: number) {
    return Math.atan2(-this.dir * roadSlopeZ(x), this.dir);
  }

  private buildMotorcycle(paint: THREE.Material, cy: number) {
    const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xbfc4c8, roughness: 0.25, metalness: 0.8 });
    const suit = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.8 });
    const helmet = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      this.group.add(m);
    };
    const ground = -cy;
    add(new THREE.BoxGeometry(0.75, 0.3, 0.32), paint, 0.15, ground + 0.72, 0);
    add(new THREE.BoxGeometry(0.55, 0.36, 0.42), black, -0.05, ground + 0.42, 0);
    add(new THREE.BoxGeometry(0.6, 0.09, 0.3), black, -0.45, ground + 0.82, 0);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.16), black, 0.0, ground + 0.25, 0);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), chrome, 0.62, ground + 0.55, 0, -0.45);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8).rotateX(Math.PI / 2), chrome, 0.5, ground + 0.95, 0);
    add(new THREE.CylinderGeometry(0.04, 0.05, 0.8, 8), chrome, -0.35, ground + 0.4, 0.22, Math.PI / 2);
    // rider leaning forward
    add(new THREE.BoxGeometry(0.4, 0.55, 0.36), suit, -0.2, ground + 1.15, 0, -0.35);
    add(new THREE.SphereGeometry(0.15, 10, 8), helmet, 0.02, ground + 1.5, 0);
    for (const z of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.045, 0.04, 0.55, 6), suit, 0.15, ground + 1.15, z * 0.22, 1.1);
      add(new THREE.BoxGeometry(0.16, 0.45, 0.14), suit, -0.2, ground + 0.62, z * 0.24, 0.5);
    }
  }

  get front() {
    return this.group.localToWorld(new THREE.Vector3(this.type.len / 2, 0.2, 0));
  }

  get forward() {
    return new THREE.Vector3(1, 0, 0).applyQuaternion(this.group.quaternion);
  }

  update(night: boolean, wet: number) {
    if (this.driving) {
      const v = this.body.linvel();
      const p = this.body.translation();
      if (Math.abs(roadOffset(p.x, p.z)) > 4.4) { this.driving = false; return this.finishUpdate(night, wet); }
      const want = this.targetYaw(p.x);
      const tx = Math.cos(want), tz = -Math.sin(want);
      // driving cars ride on rails along the road surface; physics takes over after a crash
      this.body.setLinvel({
        x: THREE.MathUtils.lerp(v.x, tx * this.speed, 0.15),
        y: (roadHeight(p.x) + this.rideHeight - p.y) * 8,
        z: THREE.MathUtils.lerp(v.z, tz * this.speed + (laneZ(p.x, this.dir * LANE_Z + this.laneShift) - p.z) * 1.5 * this.agility, 0.2),
      }, true);
      // orientation is locked to the road while driving: nothing tips over unless it has crashed
      const r = this.body.rotation();
      const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan(roadSlope(p.x)))
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), want));
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).slerp(target, 0.35);
      this.body.setRotation(q, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.finishUpdate(night, wet);
  }

  private finishUpdate(night: boolean, wet: number) {
    this.sync();
    this.lit = night && this.damage < 12000;
    for (const l of this.lamps) l.material = this.lit ? lampOnMat : lampOffMat;
    for (const l of this.tails) l.material = this.braking && this.driving ? brakeMat : tailMat;
    this.glows.forEach((g, i) => { (g.material as THREE.SpriteMaterial).opacity = this.lit ? (i % 2 === 0 ? 0.9 : 0.5) : 0; });
    if (this.phone) (this.phone.material as THREE.SpriteMaterial).opacity = this.driving ? (night ? 0.95 : 0.3) : 0;
    this.engine.update(this.pos, this.vel, this.driving, wet);
  }

  hit(worldPoint: THREE.Vector3, impulse: number, scene: THREE.Scene, loose: Loose[]) {
    this.damage += impulse;
    if (impulse > 250 * Math.sqrt(this.type.mass / 1250)) this.driving = false;
    this.dent(worldPoint, impulse / 3000);
    if (!this.cracked && this.damage > 2500) {
      this.cracked = true;
      this.glass.material = crackedMat;
    }
    const stiffness = this.type.mass / 1250;
    while (this.wheelsLost < this.wheels.length && this.damage > (5000 + 4500 * this.wheelsLost) * stiffness) this.detachWheel(scene, loose);
  }

  private dent(worldPoint: THREE.Vector3, strength: number) {
    const local = this.group.worldToLocal(worldPoint.clone());
    const v = new THREE.Vector3();
    for (const panel of this.panels) {
      const pos = panel.geo.attributes.position as THREE.BufferAttribute;
      let changed = false;
      for (let i = 0; i < pos.count; i++) {
        v.set(panel.orig[i * 3], panel.orig[i * 3 + 1], panel.orig[i * 3 + 2]).add(panel.offset);
        const d = v.distanceTo(local);
        if (d > 1.3) continue;
        panel.dent[i] = Math.min(0.55, panel.dent[i] + strength * (1 - d / 1.3) * 0.4);
        const k = 1 - panel.dent[i];
        pos.setXYZ(i, panel.orig[i * 3] * k, panel.orig[i * 3 + 1] * k, panel.orig[i * 3 + 2] * k);
        changed = true;
      }
      if (changed) {
        pos.needsUpdate = true;
        panel.geo.computeVertexNormals();
      }
    }
  }

  private detachWheel(scene: THREE.Scene, loose: Loose[]) {
    const wm = this.wheels[this.wheelsLost++];
    const wp = wm.getWorldPosition(new THREE.Vector3());
    const wq = wm.getWorldQuaternion(new THREE.Quaternion());
    this.group.remove(wm);
    scene.add(wm);
    const v = this.vel;
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(wp.x, wp.y + 0.1, wp.z).setRotation(wq)
        .setLinvel(v.x + (Math.random() - 0.5) * 4, v.y + 2 + Math.random() * 3, v.z + (Math.random() - 0.5) * 4)
        .setAngvel({ x: 0, y: 0, z: (Math.random() - 0.5) * 20 }),
    );
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.11, this.wheelR).setRotation(rot).setMass(20).setFriction(0.9).setCollisionGroups(groups(GROUP_CAR, 0xffff)),
      body,
    );
    loose.push({ body, mesh: wm });
  }

  mute() {
    this.engine.stop();
    this.engine = { update() {}, stop() {} };
  }

  dispose(scene: THREE.Scene) {
    this.engine.stop();
    scene.remove(this.group);
    this.world.removeRigidBody(this.body);
  }
}

type RigidBodyT = RAPIER.RigidBody;
interface Loose { body: RAPIER.RigidBody; mesh: THREE.Mesh }

const SMOKE_MAX = 400;

class Smoke {
  points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;

  constructor(scene: THREE.Scene) {
    this.pos = new Float32Array(SMOKE_MAX * 3);
    this.vel = new Float32Array(SMOKE_MAX * 3);
    this.life = new Float32Array(SMOKE_MAX);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x777777, size: 1.6, transparent: true, opacity: 0.3, depthWrite: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(p: THREE.Vector3) {
    const i = this.next++ % SMOKE_MAX;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([(Math.random() - 0.5) * 0.6, 1 + Math.random(), (Math.random() - 0.5) * 0.6], i * 3);
    this.life[i] = 2.5 + Math.random() * 2;
  }

  clear() {
    this.life.fill(0);
  }

  update(dt: number, wind: number) {
    for (let i = 0; i < SMOKE_MAX; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -100; continue; }
      this.life[i] -= dt;
      this.pos[i * 3] += (this.vel[i * 3] + wind * 0.4) * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Pending { dir: 1 | -1; delay: number; speedScale: number; type?: CarType }

interface BoatType { name: string; len: number; w: number; h: number; value: number; speed: number; color: number; cabin: [number, number, number] | null }
const BOATS: BoatType[] = [
  { name: 'Motorboat', len: 4.6, w: 1.6, h: 0.7, value: 1.5, speed: 3.5, color: 0xe8e8e8, cabin: null },
  { name: 'Fishing boat', len: 5.5, w: 2.0, h: 0.8, value: 1.2, speed: 2.5, color: 0x2b4c8c, cabin: [1.4, 1.2, 1.6] },
  // the prize: a big yacht, by far the most expensive thing to land on
  { name: 'Yacht', len: 14, w: 4.2, h: 1.6, value: 12, speed: 3, color: 0xf6f6f2, cabin: [6, 2.2, 3.2] },
];

// boats are kinematic: they follow their course until something lands on them, then drift
export class Boat {
  body: RAPIER.RigidBody;
  group = new THREE.Group();
  driving = true;
  damage = 0;
  honked = false;
  wheelsLost = 0;
  lit = false;
  colliders: number[] = [];
  driver = { kind: 'average' as DriverKind, reaction: 1, noticed: 0, braked: false, swerved: false, plan: null as null };
  readonly type: { name: string; len: number; w: number; bodyH: number; boxes: { h: number }[]; value: number };
  private t = 0;

  constructor(private world: RAPIER.World, scene: THREE.Scene, private spec: BoatType, private x: number, private z0: number, private dir: 1 | -1, private waterY: number) {
    this.type = { name: spec.name, len: spec.len, w: spec.w, bodyH: spec.h, boxes: [{ h: spec.cabin ? spec.cabin[1] : 0.3 }], value: spec.value };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, waterY + spec.h / 2, z0).setRotation(q));
    this.body.userData = this;
    const add = (desc: RAPIER.ColliderDesc) => {
      const c = world.createCollider(desc.setCollisionGroups(groups(GROUP_CAR, 0xffff)).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2000), this.body);
      this.colliders.push(c.handle);
    };
    add(RAPIER.ColliderDesc.cuboid(spec.len / 2, spec.h / 2, spec.w / 2).setMass(spec.len * spec.w * 120));
    const hullMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.4, metalness: 0.1 });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(spec.len, spec.h, spec.w, 6, 1, 2), hullMat);
    taperTop(hull.geometry, spec.h, -0.4, 0.2);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(spec.len * 0.9, 0.08, spec.w + 0.04), new THREE.MeshLambertMaterial({ color: 0x1f3d5a }));
    stripe.position.y = spec.h * 0.25;
    this.group.add(hull, stripe);
    if (spec.cabin) {
      add(RAPIER.ColliderDesc.cuboid(spec.cabin[0] / 2, spec.cabin[1] / 2, spec.cabin[2] / 2).setTranslation(-spec.len * 0.05, spec.h / 2 + spec.cabin[1] / 2, 0).setMass(300));
      const cab = new THREE.Mesh(new THREE.BoxGeometry(spec.cabin[0], spec.cabin[1], spec.cabin[2], 4, 1, 2), hullMat);
      taperTop(cab.geometry, spec.cabin[1], 0.5, 0.2);
      cab.position.set(-spec.len * 0.05, spec.h / 2 + spec.cabin[1] / 2, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(spec.cabin[0] * 0.9, spec.cabin[1] * 0.35, spec.cabin[2] + 0.04), glassMat);
      glass.position.set(-spec.len * 0.05, spec.h / 2 + spec.cabin[1] * 0.65, 0);
      this.group.add(cab, glass);
    } else {
      const skipper = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 3, 6), new THREE.MeshLambertMaterial({ color: 0xe0902a }));
      skipper.position.set(-spec.len * 0.3, spec.h / 2 + 0.45, 0);
      this.group.add(skipper);
    }
    this.group.traverse((o) => { o.castShadow = true; });
    scene.add(this.group);
  }

  get pos() {
    const p = this.body.translation();
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  get vel() {
    return this.driving ? new THREE.Vector3(0, 0, this.dir * this.spec.speed) : new THREE.Vector3();
  }

  get forward() {
    return new THREE.Vector3(0, 0, this.dir);
  }

  update(dt: number, daytime: boolean) {
    this.group.visible = daytime;
    if (!this.driving) return;
    this.t += dt;
    const span = 140;
    const z = this.z0 + ((this.dir * this.spec.speed * this.t + span) % (2 * span) + 2 * span) % (2 * span) - span;
    const bob = Math.sin(this.t * 1.3) * 0.06;
    this.body.setNextKinematicTranslation({ x: this.x + Math.sin(this.t * 0.2) * 1.5, y: this.waterY + this.spec.h / 2 + bob, z });
    const r = this.body.translation(), rot = this.body.rotation();
    this.group.position.set(r.x, r.y, r.z);
    this.group.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  // a moose landing on deck stops the boat and, for the yacht, is very expensive
  hit(_point: THREE.Vector3, impulse: number) {
    this.damage += impulse;
    if (impulse > 300) this.driving = false;
  }

  mute() {}

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    this.world.removeRigidBody(this.body);
  }
}

export type Vehicle = Car | Boat;

export class Traffic {
  cars: Car[] = [];
  boats: Boat[] = [];
  byCollider = new Map<number, Vehicle>();
  private loose: Loose[] = [];
  private smoke: Smoke;
  private timers = { 1: 1, '-1': 4 } as Record<string, number>;
  private pending: Pending[] = [];
  private headlights: THREE.SpotLight[] = [];

  constructor(private scene: THREE.Scene, private world: RAPIER.World, private audio: GameAudio) {
    this.smoke = new Smoke(scene);
    this.spawnBoats();
    // fixed pool so the scene's light count never changes (avoids shader recompiles)
    for (let i = 0; i < HEADLIGHTS; i++) {
      const spot = new THREE.SpotLight(0xfff2cc, 0, 80, 0.5, 0.5, 1);
      scene.add(spot, spot.target);
      this.headlights.push(spot);
    }
  }

  get vehicles(): Vehicle[] {
    return [...this.cars, ...this.boats];
  }

  private spawnBoats() {
    const x = (BRIDGE_X0 + BRIDGE_X1) / 2 + 3, zc = laneZ(x, 0);
    BOATS.forEach((spec, i) => {
      // all boats pass between the two piers, spaced out along the strait
      const boat = new Boat(this.world, this.scene, spec, x - 3, zc + (i - 1) * 55, i % 2 === 0 ? 1 : -1, WATER_Y);
      this.boats.push(boat);
      for (const h of boat.colliders) this.byCollider.set(h, boat);
    });
  }

  // Finnish traffic: platoons behind a slow leader, lone slow drivers, the odd biker
  private plan(dir: 1 | -1) {
    const r = Math.random();
    if (r < 0.45) {
      this.pending.push({ dir, delay: 0, speedScale: 0.85 + Math.random() * 0.15 });
    } else if (r < 0.7) {
      const n = 2 + Math.floor(Math.random() * 4);
      const scale = 0.85 + Math.random() * 0.1;
      let delay = 0;
      for (let i = 0; i < n; i++) {
        this.pending.push({ dir, delay, speedScale: scale * (i === 0 ? 1 : 0.97), type: i === 0 ? undefined : pickType() });
        delay += 1.6 + Math.random() * 1.2;
      }
    } else {
      const bike = TYPES.find((t) => t.name === 'Motorcycle');
      const pair = Math.random() < 0.4;
      this.pending.push({ dir, delay: 0, speedScale: 1, type: Math.random() < 0.35 ? bike : undefined });
      if (pair) this.pending.push({ dir, delay: 1, speedScale: 1, type: bike });
    }
  }

  update(dt: number, threat: { pos: THREE.Vector3; vel: THREE.Vector3; visible: boolean }, night: boolean, wet: number, wind: number, viewer: THREE.Vector3, hour: number) {
    for (const b of this.boats) b.update(dt, hour > 6 && hour < 22);
    for (const dir of [1, -1] as const) {
      this.timers[dir] -= dt;
      if (this.timers[dir] <= 0) {
        this.timers[dir] = 25 + Math.random() * 30;
        this.plan(dir);
      }
    }
    for (const p of [...this.pending]) {
      p.delay -= dt;
      if (p.delay > 0) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      if (this.cars.length < MAX_CARS) this.spawn(p);
    }
    for (const car of this.cars) {
      if (!car.driving) continue;
      // keep distance to the car ahead in the same lane; brake hard for wrecks
      let target = car.baseSpeed;
      const p = car.pos;
      let hazardBrake = false;
      const ahead = (threat.pos.x - p.x) * car.dir;
      const mooseOff = roadOffset(threat.pos.x, threat.pos.z);
      const carOff = roadOffset(p.x, p.z);
      // drivers only watch the road ahead: inside a ±45° cone in front of the car
      const hazard = threat.visible && ahead > 0 && ahead < 110 && Math.abs(mooseOff) < 9.5 && Math.abs(mooseOff - carOff) < ahead + 1;
      const d = car.driver;
      if (hazard) {
        // conspicuity: far, near the fence, slow, or coming straight at the car is harder to notice
        const toCar = new THREE.Vector3(p.x - threat.pos.x, 0, p.z - threat.pos.z).normalize();
        const mooseSpeed = threat.vel.length();
        const headOn = mooseSpeed > 1 && threat.vel.clone().setY(0).normalize().dot(toCar) > 0.85 ? 0.55 : 1;
        const conspicuity = (1 - ahead / 110) * (0.3 + 0.7 * THREE.MathUtils.clamp(1 - (Math.abs(mooseOff) - 2) / 7.5, 0, 1))
          * (0.35 + 0.65 * Math.min(1, mooseSpeed / 8)) * headOn * (night ? 0.6 : 1) * (wet > 0.5 ? 0.8 : 1);
        d.noticed += dt * Math.max(0.05, conspicuity) * 1.6;
      } else {
        d.noticed = Math.max(0, d.noticed - dt * 2);
      }
      if (hazard && d.noticed > d.reaction) {
        hazardBrake = true;
        d.braked = true;
        if (car.honks && !car.honked && ahead < 45) { car.honked = true; this.audio.honk(p); }
        // slow down to be able to stop 15 m short of the moose at a comfortable 4 m/s²; off the road only ease off
        const onRoad = Math.abs(mooseOff) < 5;
        target = Math.min(target, onRoad ? Math.sqrt(2 * 4 * Math.max(0, ahead - 15)) : car.baseSpeed * 0.6);
        const inMyLane = Math.abs(mooseOff - carOff) < 2.6;
        const oncomingNear = this.cars.some((o) => o !== car && o.dir !== car.dir && Math.abs(o.pos.x - p.x) < 80);
        const canStop = (car.speed * car.speed) / (2 * 6) < ahead - 8;
        if (!d.plan && inMyLane && ahead < 45) {
          // own lane is the safe place: brake there if the distance allows. If not, go round via the
          // oncoming lane when it is clear; some freeze, some take the ditch
          const r = Math.random();
          if (canStop || d.kind === 'phone') d.plan = 'brake';
          else if (r < 0.15) d.plan = 'brake';
          else if (!oncomingNear || r < 0.6) d.plan = 'opposite';
          else d.plan = r < 0.8 ? 'ditch' : 'own';
        }
        if (d.plan === 'opposite' && oncomingNear && Math.abs(car.laneShift) < 1) d.plan = 'brake';
        if (d.plan && d.plan !== 'brake') {
          d.swerved = true;
          const away = Math.sign(carOff - mooseOff) || car.dir;
          const dodge = car.agility > 1 ? 2.6 : 1.4;
          car.laneShift = d.plan === 'opposite' ? -2 * car.dir * LANE_Z
            : d.plan === 'ditch' ? car.dir * 3.2 : THREE.MathUtils.clamp(away * dodge, -3, 3);
        } else {
          car.laneShift *= Math.exp(-1.5 * dt);
        }
      } else if (!hazard) {
        car.laneShift *= Math.exp(-dt);
        if (Math.abs(car.laneShift) < 0.05) d.plan = null;
      }
      for (const o of this.cars) {
        if (o === car) continue;
        const op = o.pos;
        if (Math.abs(roadOffset(op.x, op.z) - roadOffset(p.x, p.z)) > 2.5) continue;
        const gap = (op.x - p.x) * car.dir - (car.type.len + o.type.len) / 2;
        if (gap < 0 || gap > 40) continue;
        const ov = o.vel.length();
        if (!o.driving || ov < 3) target = Math.min(target, gap < 12 ? 0 : (gap - 12) * 1.2);
        else if (gap < 14) target = Math.min(target, ov * 0.97);
      }
      const decel = (hazardBrake ? 8 : 5) * (0.7 + 0.6 * car.skill);
      car.braking = target < car.speed - 0.5;
      car.speed = car.braking ? Math.max(target, car.speed - decel * dt) : Math.min(target, car.speed + 2 * dt);
    }
    for (const car of [...this.cars]) {
      car.update(night, wet);
      const p = car.pos;
      if (car.driving && Math.abs(p.x) > ROAD_HALF_LEN + 6) { this.remove(car); continue; }
      if (car.damage > 7000) {
        car.smokeAcc += dt * Math.min(3, car.damage / 7000);
        while (car.smokeAcc > 0.08) {
          car.smokeAcc -= 0.08;
          const hood = new THREE.Vector3(car.type.len / 2 - 0.6, car.type.bodyH / 2, (Math.random() - 0.5) * 0.8);
          this.smoke.emit(car.group.localToWorld(hood));
        }
      }
    }
    for (const l of this.loose) {
      const p = l.body.translation(), r = l.body.rotation();
      l.mesh.position.set(p.x, p.y, p.z);
      l.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.smoke.update(dt, wind);

    const lit = this.cars.filter((c) => c.lit).sort((a, b) => a.pos.distanceTo(viewer) - b.pos.distanceTo(viewer));
    this.headlights.forEach((spot, i) => {
      const car = lit[i];
      spot.intensity = car ? 60 : 0;
      if (!car) return;
      spot.position.copy(car.front);
      spot.target.position.copy(car.front).addScaledVector(car.forward, 30).y -= 2;
    });
  }

  private spawn(p: Pending) {
    const car = new Car(this.world, this.scene, this.audio, p.dir, -p.dir * ROAD_HALF_LEN, p.type, p.speedScale);
    this.cars.push(car);
    for (const h of car.colliders) this.byCollider.set(h, car);
  }

  private remove(car: Car) {
    car.dispose(this.scene);
    for (const h of car.colliders) this.byCollider.delete(h);
    this.cars.splice(this.cars.indexOf(car), 1);
  }

  // two driving cars only wreck each other once the moose has stirred things up
  impact(v: Vehicle, worldPoint: THREE.Vector3, impulse: number, other: Vehicle | undefined, chaos: boolean) {
    if (other && v.driving && other.driving && !chaos) return 0;
    if (v instanceof Boat) v.hit(worldPoint, impulse);
    else v.hit(worldPoint, impulse, this.scene, this.loose);
    return impulse * v.type.value;
  }

  mute() {
    for (const car of this.cars) car.mute();
  }

  reset() {
    for (const car of [...this.cars]) this.remove(car);
    for (const b of this.boats) { b.dispose(this.scene); for (const h of b.colliders) this.byCollider.delete(h); }
    this.boats = [];
    this.spawnBoats();
    for (const l of this.loose) {
      this.scene.remove(l.mesh);
      this.world.removeRigidBody(l.body);
    }
    this.loose = [];
    this.pending = [];
    this.smoke.clear();
    this.timers = { 1: 1, '-1': 4 };
  }
}
