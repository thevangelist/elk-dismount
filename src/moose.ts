import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUP_MOOSE, GROUP_CAR, GROUP_STATIC, groups } from './terrain';

type Shape = { kind: 'capsule'; r: number; half: number } | { kind: 'box'; hx: number; hy: number; hz: number };

interface PartDef {
  name: string;
  shape: Shape;
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  mass: number;
  weight: number;
}

export interface Part extends PartDef {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
}

const zRot = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg));

function defs(): PartDef[] {
  const parts: PartDef[] = [
    { name: 'torso', shape: { kind: 'capsule', r: 0.42, half: 0.55 }, pos: new THREE.Vector3(0, 1.38, 0), rot: zRot(-90), mass: 320, weight: 1 },
    { name: 'neck', shape: { kind: 'box', hx: 0.34, hy: 0.17, hz: 0.15 }, pos: new THREE.Vector3(1.12, 1.78, 0), rot: zRot(38), mass: 35, weight: 2 },
    { name: 'head', shape: { kind: 'box', hx: 0.4, hy: 0.2, hz: 0.16 }, pos: new THREE.Vector3(1.66, 2.0, 0), rot: zRot(-18), mass: 30, weight: 2.5 },
  ];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const hx = sx * 0.62, hz = sz * 0.26;
      const tag = (sx > 0 ? 'F' : 'R') + (sz > 0 ? 'R' : 'L');
      parts.push(
        { name: 'thigh-' + tag, shape: { kind: 'capsule', r: 0.09, half: 0.26 }, pos: new THREE.Vector3(hx, 0.7, hz), rot: new THREE.Quaternion(), mass: 22, weight: 1.2 },
        { name: 'shin-' + tag, shape: { kind: 'capsule', r: 0.07, half: 0.27 }, pos: new THREE.Vector3(hx, 0.34, hz), rot: new THREE.Quaternion(), mass: 12, weight: 1.2 },
      );
    }
  }
  return parts;
}

function furTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6b4a2e';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  let seed = 3;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      const streak = Math.sin(x * 0.9 + Math.sin(y * 0.05) * 6) * 8;
      const n = (rnd() - 0.5) * 34 + streak;
      img.data[i] += n; img.data[i + 1] += n * 0.9; img.data[i + 2] += n * 0.7;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const furMat = new THREE.MeshStandardMaterial({ map: furTexture(), vertexColors: true, roughness: 0.95, metalness: 0 });
const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.1, 0.07), roughness: 0.9 });
const legMat = furMat;
const hoofMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.08, 0.06, 0.05), roughness: 0.5 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x120c08, roughness: 0.15, metalness: 0.1 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Ring of ellipses swept along the local `axis`; up/side radii per ring, `lift` shifts the ring along `up`.
interface Ring { t: number; up: number; side: number; lift?: number }
function loft(rings: Ring[], axis: THREE.Vector3, upDir: THREE.Vector3, shade: (t: number, upAmount: number) => number, radial = 14) {
  const sideDir = new THREE.Vector3().crossVectors(axis, upDir).normalize();
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const tmp = new THREE.Vector3();
  const first = rings[0], last = rings[rings.length - 1];
  // pinch both ends shut so the seams never show the hollow inside
  rings = [{ ...first, up: 0.002, side: 0.002 }, ...rings, { ...last, up: 0.002, side: 0.002 }];
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const cu = Math.cos(a), su = Math.sin(a);
      tmp.copy(axis).multiplyScalar(ring.t)
        .addScaledVector(upDir, cu * ring.up + (ring.lift ?? 0))
        .addScaledVector(sideDir, su * ring.side);
      pos.push(tmp.x, tmp.y, tmp.z);
      uv.push(i / radial * 3, ring.t * 2);
      const k = shade(ring.t, cu);
      col.push(k, k * 0.97, k * 0.92);
      if (r > 0 && i < radial) {
        const a0 = (r - 1) * (radial + 1) + i, b0 = r * (radial + 1) + i;
        idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), NX = new THREE.Vector3(-1, 0, 0);

function bodyGeometry(name: string, s: Shape) {
  const dark = (_t: number, u: number) => 0.85 - 0.35 * Math.max(0, u);
  if (name === 'torso') {
    // capsule frame: +y forward, -x up
    return loft([
      { t: 0.98, up: 0.08, side: 0.07, lift: -0.02 }, { t: 0.9, up: 0.3, side: 0.24, lift: -0.02 }, { t: 0.7, up: 0.44, side: 0.34 },
      { t: 0.45, up: 0.52, side: 0.4, lift: -0.09 }, { t: 0.2, up: 0.47, side: 0.39, lift: -0.02 }, { t: -0.15, up: 0.45, side: 0.38, lift: 0.03 },
      { t: -0.5, up: 0.43, side: 0.35, lift: 0.02 }, { t: -0.8, up: 0.34, side: 0.27, lift: -0.02 }, { t: -0.98, up: 0.06, side: 0.06, lift: -0.06 },
    ], Y, NX, (t, u) => dark(t, -u) * (1 + 0.15 * Math.max(0, u)));
  }
  if (name === 'neck') {
    const hx = (s as { hx: number }).hx;
    return loft([
      { t: -hx - 0.05, up: 0.12, side: 0.1 }, { t: -hx * 0.5, up: 0.24, side: 0.19, lift: 0.03 }, { t: 0, up: 0.22, side: 0.17, lift: 0.02 },
      { t: hx * 0.6, up: 0.19, side: 0.15 }, { t: hx + 0.05, up: 0.1, side: 0.09 },
    ], X, Y, (_t, u) => 0.8 - 0.3 * Math.max(0, u), 12);
  }
  if (name === 'head') {
    return loft([
      { t: -0.42, up: 0.06, side: 0.06, lift: 0.04 }, { t: -0.3, up: 0.19, side: 0.16, lift: 0.03 }, { t: -0.1, up: 0.2, side: 0.16, lift: 0.01 },
      { t: 0.1, up: 0.17, side: 0.14, lift: -0.03 }, { t: 0.3, up: 0.15, side: 0.125, lift: -0.09 }, { t: 0.46, up: 0.14, side: 0.12, lift: -0.16 },
      { t: 0.56, up: 0.1, side: 0.09, lift: -0.19 }, { t: 0.6, up: 0.03, side: 0.03, lift: -0.2 },
    ], X, Y, (t, u) => (t > 0.25 ? 0.55 : 0.8) - 0.25 * Math.max(0, u), 12);
  }
  if (name.startsWith('thigh')) {
    return loft([
      { t: 0.34, up: 0.1, side: 0.08 }, { t: 0.22, up: 0.15, side: 0.11 }, { t: 0, up: 0.11, side: 0.09 }, { t: -0.2, up: 0.085, side: 0.075 }, { t: -0.32, up: 0.075, side: 0.07 },
    ], Y, X, () => 0.8, 10);
  }
  if (name.startsWith('shin')) {
    return loft([
      { t: 0.32, up: 0.075, side: 0.07 }, { t: 0.2, up: 0.065, side: 0.06 }, { t: -0.1, up: 0.05, side: 0.045 }, { t: -0.26, up: 0.055, side: 0.05 }, { t: -0.34, up: 0.04, side: 0.04 },
    ], Y, X, (t) => 1.05 + 0.25 * Math.max(0, -t), 10);
  }
  return s.kind === 'capsule' ? new THREE.CapsuleGeometry(s.r, s.half * 2, 4, 10) : new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2);
}
const antlerMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.8, 0.72, 0.55) });

export class Moose {
  parts: Part[] = [];
  byCollider = new Map<number, Part>();
  nostrils: THREE.Mesh[] = [];
  headMat = furMat.clone();
  launched = false;
  health = 100;
  stamina = 70;
  stress = 0;
  shield = 0;
  injuredLegs = new Set<string>();
  root = new THREE.Vector3(0, 0, 7);
  yaw = Math.PI / 2;

  constructor(scene: THREE.Scene, private world: RAPIER.World) {
    for (const d of defs()) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(d.pos.x, d.pos.y, d.pos.z)
          .setRotation(d.rot).setAngularDamping(1.5).setLinearDamping(0.05).setCcdEnabled(true),
      );
      const s = d.shape;
      const desc = s.kind === 'capsule' ? RAPIER.ColliderDesc.capsule(s.half, s.r) : RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
      const col = world.createCollider(
        desc.setMass(d.mass).setFriction(0.7).setRestitution(0.05)
          .setCollisionGroups(groups(GROUP_MOOSE, GROUP_CAR | GROUP_STATIC))
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(2000),
        body,
      );
      const mesh = new THREE.Mesh(bodyGeometry(d.name, s), d.name === 'head' ? this.headMat : d.name.startsWith('shin') ? legMat : furMat);
      mesh.castShadow = true;
      this.decorate(d.name, mesh);
      scene.add(mesh);
      const part: Part = { ...d, body, mesh };
      this.parts.push(part);
      this.byCollider.set(col.handle, part);
    }
    this.buildJoints();
    this.setPose(this.root, this.yaw, true);
  }

  // visual-only details on top of the physics shapes
  private decorate(name: string, mesh: THREE.Mesh) {
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rot?: THREE.Euler) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (rot) m.rotation.copy(rot);
      m.castShadow = true;
      mesh.add(m);
      return m;
    };
    if (name === 'torso') {
      add(new THREE.SphereGeometry(0.05, 6, 6).scale(1, 1.8, 0.7), darkMat, 0.05, -0.98, 0);
    } else if (name === 'neck') {
      // dewlap ("kello") hanging under the throat
      add(new THREE.SphereGeometry(0.09, 8, 8).scale(1.2, 1.6, 0.7), darkMat, 0.08, -0.24, 0);
    } else if (name === 'head') {
      add(new THREE.SphereGeometry(0.075, 8, 8).scale(1, 0.8, 1.1), darkMat, 0.57, -0.2, 0);
      for (const s of [1, -1]) {
        this.nostrils.push(add(new THREE.SphereGeometry(0.02, 6, 6), hoofMat, 0.6, -0.18, s * 0.055));
        add(new THREE.SphereGeometry(0.036, 10, 8), eyeMat, -0.02, 0.09, s * 0.15);
        add(new THREE.SphereGeometry(0.009, 4, 4), glintMat, 0.005, 0.105, s * 0.178);
        add(new THREE.SphereGeometry(0.11, 8, 8).scale(0.35, 1, 0.55), darkMat, -0.32, 0.25, s * 0.19, new THREE.Euler(s * 0.55, 0, 0.35));
        mesh.add(this.antler(s));
      }
    } else if (name.startsWith('shin')) {
      add(new THREE.CylinderGeometry(0.06, 0.075, 0.09, 8), hoofMat, 0, -0.34, 0);
      add(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.3, 1), furMat, 0, 0.3, 0);
    }
  }

  // Palmate moose antler: a short beam, a forward brow palm with 3 tines and a broad main palm
  // whose outer rim carries the points. Built as a 2D outline (u = outward, v = forward) and extruded.
  private antler(side: number) {
    const pts: [number, number][] = [
      [0, -0.045], [0, 0.045], [0.07, 0.06], [0.13, 0.09],
      [0.16, 0.18], [0.17, 0.3],
    ];
    const brow: [number, number][] = [[0.185, 0.44], [0.25, 0.43], [0.32, 0.38]];
    const browBase: [number, number][] = [[0.215, 0.31], [0.28, 0.3], [0.335, 0.26]];
    for (let i = 0; i < brow.length; i++) pts.push(brow[i], browBase[i]);
    pts.push([0.4, 0.25], [0.47, 0.23]);
    const rim: [number, number][] = [[0.53, 0.21], [0.59, 0.13], [0.635, 0.03], [0.65, -0.07], [0.635, -0.17], [0.59, -0.26], [0.52, -0.32], [0.44, -0.35]];
    const centre = [0.36, -0.05];
    for (let i = 0; i < rim.length; i++) {
      pts.push(rim[i]);
      if (i === rim.length - 1) break;
      const mx = (rim[i][0] + rim[i + 1][0]) / 2, my = (rim[i][1] + rim[i + 1][1]) / 2;
      const nx = mx - centre[0], ny = my - centre[1];
      const nl = Math.hypot(nx, ny);
      const len = 0.1 + 0.05 * Math.sin(i * 1.7 + 0.4);
      pts.push([mx + (nx / nl) * len, my + (ny / nl) * len]);
    }
    pts.push([0.35, -0.34], [0.27, -0.29], [0.2, -0.21], [0.13, -0.12], [0.07, -0.07]);
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
    geo.translate(0, 0, -0.015);
    // shape x -> outward (head ±z), shape y -> forward (head +x); keep the basis right-handed so normals stay valid
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, side), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, side, 0));
    geo.applyMatrix4(basis);
    const mesh = new THREE.Mesh(geo, antlerMat);
    mesh.castShadow = true;
    // palm rises outward from the pedicle (~25°), brow lobe lifted, palms swept a little back
    mesh.rotation.set(side * -0.45, side * -0.15, 0.4, 'YXZ');
    mesh.position.set(-0.1, 0.22, side * 0.13);
    const burr = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), darkMat);
    burr.position.copy(mesh.position);
    const g = new THREE.Group();
    g.add(mesh, burr);
    return g;
  }

  private part(name: string) {
    return this.parts.find((p) => p.name === name)!;
  }

  private joint(a: Part, b: Part, world: THREE.Vector3, axis?: THREE.Vector3, limits?: [number, number]) {
    const la = world.clone().sub(a.pos).applyQuaternion(a.rot.clone().invert());
    const lb = world.clone().sub(b.pos).applyQuaternion(b.rot.clone().invert());
    const data = axis
      ? RAPIER.JointData.revolute(la, lb, axis.clone().applyQuaternion(a.rot.clone().invert()))
      : RAPIER.JointData.spherical(la, lb);
    const j = this.world.createImpulseJoint(data, a.body, b.body, true);
    if (limits) (j as RAPIER.RevoluteImpulseJoint).setLimits(limits[0], limits[1]);
  }

  private buildJoints() {
    const torso = this.part('torso');
    this.joint(torso, this.part('neck'), new THREE.Vector3(0.88, 1.62, 0));
    this.joint(this.part('neck'), this.part('head'), new THREE.Vector3(1.38, 1.95, 0));
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const tag = (sx > 0 ? 'F' : 'R') + (sz > 0 ? 'R' : 'L');
        const hx = sx * 0.62, hz = sz * 0.26;
        this.joint(torso, this.part('thigh-' + tag), new THREE.Vector3(hx, 1.0, hz));
        this.joint(this.part('thigh-' + tag), this.part('shin-' + tag), new THREE.Vector3(hx, 0.66, hz), new THREE.Vector3(0, 0, 1), [-1.3, 1.3]);
      }
    }
  }

  setPose(root: THREE.Vector3, yaw: number, teleport = false, gait = 0, phase = 0, lean = 0, tilt = 0, fold = 0) {
    this.root.copy(root);
    this.yaw = yaw;
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, 0, tilt)));
    const bob = new THREE.Vector3(0, gait * 0.1 * Math.abs(Math.sin(phase)), 0);
    for (const p of this.parts) {
      let local = p.pos.clone().add(bob);
      let lrot = p.rot.clone();
      const leg = p.name.match(/^(thigh|shin)-([FR])([LR])$/);
      if (leg) {
        const diagonal = (leg[2] === 'F') === (leg[3] === 'R') ? 0 : Math.PI;
        const front = leg[2] === 'F';
        if (leg[1] === 'shin' && fold > 0) {
          const knee = new THREE.Vector3(Math.sign(p.pos.x) * 0.62, 0.66, p.pos.z).add(bob);
          const bend = zRot((front ? -75 : 80) * fold);
          local = local.sub(knee).applyQuaternion(bend).add(knee);
          lrot = bend.multiply(lrot);
        }
        const hurt = this.injuredLegs.has(leg[2] + leg[3]);
        const swing = zRot(THREE.MathUtils.radToDeg(gait * (hurt ? 0.3 : 1) * Math.sin(phase + diagonal)) + (front ? 35 : -30) * fold + (hurt ? (front ? 18 : -14) : 0));
        const hip = new THREE.Vector3(Math.sign(p.pos.x) * 0.62, 1.0, p.pos.z).add(bob);
        local = local.sub(hip).applyQuaternion(swing).add(hip);
        lrot = swing.multiply(lrot);
      }
      const pos = local.applyQuaternion(qy).add(root);
      const rot = qy.clone().multiply(lrot);
      const from = this.rising > 0 ? this.restPose.get(p.name) : undefined;
      if (from) {
        const k = 1 - this.rising * this.rising;
        pos.lerpVectors(from.pos, pos, k);
        rot.copy(from.rot.clone().slerp(rot, k));
      }
      if (teleport) {
        p.body.setTranslation(pos, true);
        p.body.setRotation(rot, true);
      } else {
        p.body.setNextKinematicTranslation(pos);
        p.body.setNextKinematicRotation(rot);
      }
    }
  }

  release(vel: THREE.Vector3) {
    if (this.launched) return;
    this.launched = true;
    for (const p of this.parts) {
      p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      const v = vel.clone().multiplyScalar(0.95 + Math.random() * 0.1);
      p.body.setLinvel(v, true);
      p.body.setAngvel({ x: (Math.random() - 0.5) * 1.5, y: (Math.random() - 0.5) * 1.5, z: (Math.random() - 0.5) * 1.5 }, true);
    }
  }

  reset() {
    this.launched = false;
    this.rising = 0;
    this.health = 100;
    this.stamina = 70;
    this.stress = 0;
    this.shield = 0;
    this.injuredLegs.clear();
    for (const p of this.parts) {
      p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.setPose(this.root, this.yaw, true);
  }

  sync() {
    for (const p of this.parts) {
      const t = p.body.translation(), r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  get head() {
    return this.part('head');
  }

  get torso() {
    return this.part('torso');
  }

  breathe(phase: number) {
    const k = 1 + 0.5 * Math.max(0, Math.sin(phase));
    for (const n of this.nostrils) n.scale.set(k, k, k);
  }

  get torsoPos() {
    const t = this.part('torso').body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get velocity() {
    const v = this.part('torso').body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  get maxSpeed() {
    let m = 0;
    for (const p of this.parts) {
      const v = p.body.linvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z));
    }
    return m;
  }

  // momentum decides: small knocks barely register, a car hit hurts but is survivable,
  // a high-energy blow kills outright. Legs that take a heavy blow leave the moose limping.
  injure(part: Part, impulse: number, ground: boolean) {
    const e = impulse * part.weight * (ground ? 0.6 : 1) * (this.shield > 0 ? 0.5 : 1);
    if (e > 16000) { this.health = 0; return 100; }
    const leg = part.name.match(/^(thigh|shin)-(.+)$/);
    if (leg && e > 3500) this.injuredLegs.add(leg[2]);
    const dmg = e < 1500 ? e / 250 : 6 + (e - 1500) / 140;
    this.health = Math.max(0, this.health - dmg);
    return dmg;
  }

  // running ability: each bad leg costs a fifth, and an exhausted moose slows down
  get mobility() {
    const tired = THREE.MathUtils.clamp(this.stamina / 30, 0.55, 1);
    return Math.max(0.3, 1 - 0.2 * this.injuredLegs.size) * tired;
  }

  // back on its feet where the body came to rest: the parts are eased from the ragdoll pose into the stance
  rising = 0;
  private restPose = new Map<string, { pos: THREE.Vector3; rot: THREE.Quaternion }>();

  standUp() {
    const t = this.torso.body.translation();
    const fwd = new THREE.Vector3(0, 1, 0).applyQuaternion(this.torso.mesh.quaternion).setY(0);
    if (fwd.lengthSq() > 0.01) this.yaw = Math.atan2(-fwd.z, fwd.x);
    this.root.set(t.x, t.y, t.z);
    this.launched = false;
    this.rising = 1;
    for (const p of this.parts) {
      const tr = p.body.translation(), r = p.body.rotation();
      this.restPose.set(p.name, { pos: new THREE.Vector3(tr.x, tr.y, tr.z), rot: new THREE.Quaternion(r.x, r.y, r.z, r.w) });
      p.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
}
