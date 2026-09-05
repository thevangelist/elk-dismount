import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ROAD_HALF_LEN = 320;
export const ROAD_HALF_W = 3.8;
export const LANE_Z = 1.75;
export const WORLD_SIZE = 720;
export const START = { x: 138, z: 0 };

export const GROUP_CAR = 1;
export const GROUP_MOOSE = 2;
export const GROUP_STATIC = 4;
export const groups = (member: number, filter: number) => (member << 16) | filter;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smoothstep = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};

function roadProfile(x: number) {
  return 1.5 * Math.sin(x * 0.02) + 0.6 * Math.sin(x * 0.055 + 2) + 7 * smoothstep(ESKER_X0 - 15, ESKER_X0 + 35, x);
}

// the bridge deck is a flat slab, so the road is flattened to its level along the whole span
export function roadHeight(x: number) {
  const mid = roadProfile((BRIDGE_X0 + BRIDGE_X1) / 2);
  const onDeck = smoothstep(BRIDGE_X0 - 20, BRIDGE_X0 - 8, x) * (1 - smoothstep(BRIDGE_X1 + 8, BRIDGE_X1 + 20, x));
  return THREE.MathUtils.lerp(roadProfile(x), mid, onDeck);
}

// how much the ridge has narrowed at x: 0 = forest, 1 = full esker profile
function eskerAmount(x: number) {
  return smoothstep(ESKER_X0, ESKER_X0 + 40, x);
}

// the kiosk car park: a flat gravel apron on the lake side at the start of the esker
export const PARK = { x0: 58, x1: 88, off0: -(ROAD_HALF_W + 3), off1: -(ROAD_HALF_W + 16) };
function parkMask(x: number, off: number) {
  return smoothstep(PARK.x0 - 4, PARK.x0, x) * (1 - smoothstep(PARK.x1, PARK.x1 + 4, x))
    * smoothstep(PARK.off0 + 2, PARK.off0, off) * (1 - smoothstep(PARK.off1, PARK.off1 - 3, off));
}

// what the moose stands on: the bridge deck over the strait, the ground elsewhere
export function surfaceHeight(x: number, z: number) {
  if (x > BRIDGE_X0 - 8 && x < BRIDGE_X1 + 8 && Math.abs(roadOffset(x, z)) < BRIDGE_W / 2) return roadHeight(x);
  return groundHeight(x, z);
}

export function isStrait(x: number) {
  return x > BRIDGE_X0 + 2 && x < BRIDGE_X1 - 2;
}

// road centreline meanders as a function of x (gentle curves, no switchbacks)
export function roadZ(x: number) {
  return 18 * Math.sin(x * 0.011) + 7 * Math.sin(x * 0.027 + 1.7);
}

export function roadSlopeZ(x: number) {
  return roadZ(x + 0.5) - roadZ(x - 0.5);
}

// signed sideways distance from the road centreline (approximately perpendicular)
export function roadOffset(x: number, z: number) {
  const sz = roadSlopeZ(x);
  return (z - roadZ(x)) / Math.sqrt(1 + sz * sz);
}

export function laneZ(x: number, offset: number) {
  const sz = roadSlopeZ(x);
  return roadZ(x) + offset * Math.sqrt(1 + sz * sz);
}

const hash = (i: number, j: number) => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// smooth value noise in [-1, 1] with 1 m cells
function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const top = THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), ux);
  const bottom = THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), ux);
  return THREE.MathUtils.lerp(top, bottom, uz) * 2 - 1;
}

export function fbm(x: number, z: number, octaves: number) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * f + o * 17.3, z * f - o * 11.1);
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}

// rock outcrops and bogs: masks in [0, 1] from low-frequency noise
export function landforms(x: number, z: number) {
  const rock = smoothstep(0.3, 0.48, fbm(x * 0.03 + 40, z * 0.03 - 20, 2));
  const bog = smoothstep(-0.3, -0.48, fbm(x * 0.02 - 70, z * 0.02 + 30, 2)) * (1 - rock);
  return { rock, bog };
}

// fine bumps: hummocks, roots and hollows at the scale of a moose's stride
function micro(x: number, z: number) {
  return 0.3 * fbm(x * 0.35, z * 0.35, 2);
}

function hills(x: number, z: number) {
  const big = 4.5 * fbm(x * 0.012, z * 0.012, 3);
  const mid = 1.6 * fbm(x * 0.045 + 5, z * 0.045, 2);
  const lf = landforms(x, z);
  const outcrop = lf.rock * (2.4 + 0.9 * fbm(x * 0.15 + 9, z * 0.15, 2));
  const h = THREE.MathUtils.lerp(big + mid + outcrop, big - 1.6, lf.bog);
  return h + 0.025 * Math.abs(z);
}

// sand slumps down the esker flank
function gully(x: number, az: number) {
  return smoothstep(0.3, 0.55, fbm(x * 0.06 + 3, 0, 2)) * clamp01((az - 9) / 4);
}

export function groundHeight(x: number, z: number) {
  const az = Math.abs(roadOffset(x, z));
  const ditch = -0.7 * Math.exp(-(((az - 5.8) / 1.0) ** 2));
  const forest = roadHeight(x) + smoothstep(6, 24, az) * hills(x, z) + smoothstep(5.5, 9, az) * micro(x, z) + ditch;
  const e = eskerAmount(x);
  if (e <= 0) return az < ROAD_HALF_W + 0.6 ? Math.min(forest, roadHeight(x) - 0.02) : forest;
  // steep esker flanks: crest 9 m wide, then down 0.6 m per metre into the lake bed
  const crest = roadHeight(x) - Math.max(0, az - 9) * 0.6 + 0.4 * Math.sin(x * 0.3) * Math.sin(az * 0.5)
    - 1.2 * gully(x, az) + smoothstep(7.5, 10, az) * micro(x, z);
  let h = THREE.MathUtils.lerp(forest, Math.max(crest, WATER_Y - 7), e);
  // the strait: the ridge dips under water beneath the bridge
  const strait = smoothstep(BRIDGE_X0 - 6, BRIDGE_X0 + 4, x) * (1 - smoothstep(BRIDGE_X1 - 4, BRIDGE_X1 + 6, x));
  h = THREE.MathUtils.lerp(h, WATER_Y - 6, strait);
  const off = roadOffset(x, z);
  h = THREE.MathUtils.lerp(h, roadHeight(x) - 0.25, parkMask(x, off));
  // the asphalt is always the highest surface: nothing pokes through the road
  if (Math.abs(off) < ROAD_HALF_W + 0.6) h = Math.min(h, roadHeight(x) - 0.02);
  return h;
}

const moss = new THREE.Color(0.2, 0.31, 0.11);
const blueberry = new THREE.Color(0.14, 0.27, 0.11);
const heather = new THREE.Color(0.3, 0.3, 0.15);
const litter = new THREE.Color(0.34, 0.26, 0.15);
const lichen = new THREE.Color(0.48, 0.52, 0.36);
const rock = new THREE.Color(0.36, 0.37, 0.35);
const sedge = new THREE.Color(0.6, 0.52, 0.24);
const sand = new THREE.Color(0.6, 0.53, 0.4);
const gravel = new THREE.Color(0.46, 0.43, 0.37);
const path = new THREE.Color(0.5, 0.47, 0.4);
const shoreSand = new THREE.Color(0.72, 0.66, 0.5);
const lakeBed = new THREE.Color(0.25, 0.3, 0.25);
const wet = new THREE.Color(0.14, 0.18, 0.09);

// ground colour at (x, z) with height h and surface normal y component ny
export function groundColor(c: THREE.Color, x: number, z: number, h: number, ny: number) {
  const off = roadOffset(x, z), az = Math.abs(off);
  const lf = landforms(x, z), e = 1 - eskerAmount(x);
  const patch = fbm(x * 0.08 + 21, z * 0.08 + 8, 2);
  c.copy(moss).lerp(blueberry, clamp01(patch * 2)).lerp(heather, clamp01(-patch * 2) * 0.7);
  // needle litter under the roadside pines, lichen on the high dry ground
  c.lerp(litter, smoothstep(8, 12, az) * (1 - smoothstep(18, 26, az)) * clamp01(0.5 + fbm(x * 0.2, z * 0.2, 1)));
  c.lerp(lichen, clamp01((h - roadHeight(x) - 2) / 5) * 0.8);
  c.lerp(rock, lf.rock * e).lerp(lichen, lf.rock * e * clamp01(fbm(x * 0.5, z * 0.5, 1) * 3) * 0.6);
  c.lerp(sedge, lf.bog * e);
  c.lerp(sand, smoothstep(0.72, 0.55, ny));
  c.lerp(wet, smoothstep(7.5, 5.5, az) * 0.9);
  c.lerp(gravel, smoothstep(5.2, 4.2, az));
  c.lerp(gravel, parkMask(x, off));
  // the nature trail: a gravel path beside the road along the esker
  c.lerp(path, smoothstep(5.2, 5.8, az) * (1 - smoothstep(7.2, 7.8, az)) * (1 - e));
  c.lerp(sand, gully(x, az) * (1 - e));
  c.lerp(shoreSand, smoothstep(WATER_Y + 2.5, WATER_Y + 0.3, h) * (1 - e));
  c.lerp(lakeBed, smoothstep(WATER_Y, WATER_Y - 3, h));
  return c;
}

export function roadSlope(x: number) {
  return (roadHeight(x + 0.5) - roadHeight(x - 0.5));
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function asphaltTexture(yellowCentre = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rand = rng(7);
  g.fillStyle = '#4a4a48';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 34;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n - 3;
  }
  g.putImageData(img, 0, 0);
  // wheel tracks: u along x (512 px = 8 m), v across road
  g.fillStyle = 'rgba(30,30,30,0.25)';
  for (const v of [0.22, 0.32, 0.68, 0.78]) g.fillRect(0, v * 512 - 12, 512, 24);
  if (yellowCentre) {
    // no-overtaking stretch: double solid yellow line
    g.fillStyle = 'rgba(225,190,40,0.8)';
    g.fillRect(0, 246, 512, 6);
    g.fillRect(0, 260, 512, 6);
  } else {
    g.fillStyle = 'rgba(200,200,190,0.55)';
    g.fillRect(0, 252, 130, 8);
  }
  g.fillStyle = 'rgba(210,210,200,0.5)';
  g.fillRect(0, 22, 512, 6);
  g.fillRect(0, 484, 512, 6);
  g.strokeStyle = 'rgba(20,20,20,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    let x = rand() * 512, y = rand() * 512;
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 60; y += (rand() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// neutral grey forest floor tile (5 m): moss cushions, needle litter, pebbles. Doubles as the bump map
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rand = rng(11);
  g.fillStyle = '#cbcbc8';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 40;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 90; i++) {
    const x = rand() * 512, y = rand() * 512, r = 14 + rand() * 40;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() < 0.5 ? 225 : 180;
    grad.addColorStop(0, `rgba(${tone},${tone},${tone},0.4)`);
    grad.addColorStop(1, `rgba(${tone},${tone},${tone},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.lineWidth = 1.5;
  for (let i = 0; i < 900; i++) {
    const x = rand() * 512, y = rand() * 512, a = rand() * Math.PI, l = 4 + rand() * 9;
    g.strokeStyle = `rgba(${rand() < 0.5 ? 120 : 220},${110 + rand() * 60},90,0.35)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 300; i++) {
    const x = rand() * 512, y = rand() * 512, r = 1 + rand() * 3;
    g.fillStyle = `rgba(${60 + rand() * 60},${60 + rand() * 50},50,0.5)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// sedge tuft: a fan of blades on transparent ground, for crossed alpha-tested planes
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rand = rng(23);
  g.clearRect(0, 0, 128, 128);
  g.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const x0 = 44 + rand() * 40, x1 = x0 + (rand() - 0.5) * 110, top = 10 + rand() * 50;
    const v = 120 + rand() * 90;
    g.strokeStyle = `rgba(${v * 0.85},${v},${v * 0.45},0.95)`;
    g.lineWidth = 1.5 + rand() * 2.5;
    g.beginPath(); g.moveTo(x0, 128); g.quadraticCurveTo(x0 + (x1 - x0) * 0.3, 70, x1, top); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTextures(url: string) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 450;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { c, tex };
  };
  const front = make(), back = make();
  const img = new Image();
  img.onload = () => {
    front.c.getContext('2d')!.drawImage(img, 0, 0, 512, 450);
    const g = back.c.getContext('2d')!;
    g.drawImage(img, 0, 0, 512, 450);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#7d7f82';
    g.fillRect(0, 0, 512, 450);
    front.tex.needsUpdate = back.tex.needsUpdate = true;
  };
  img.src = url;
  return { front: front.tex, back: back.tex };
}

function fenceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(150,150,150,0.9)';
  g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 64); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(64, i); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export const FENCE_Z = 9.5;
export const FENCE_GAP = 2.5;
export const START_OFFSET = 6;
// esker (harju) section: the road climbs a narrow ridge with lake on both sides, then bridges a strait
export const WATER_Y = -6;
export const ESKER_X0 = 40;
export const BRIDGE_X0 = 150;
export const BRIDGE_X1 = 178;
export const BRIDGE_W = ROAD_HALF_W * 2 + 3;

export interface Terrain {
  groundHandle: number;
  setWet(w: number): void;
  treesNearRoad: THREE.Vector3[];
}

export function buildTerrain(scene: THREE.Scene, world: RAPIER.World): Terrain {
  const rand = rng(42);
  const startZ = laneZ(START.x, START_OFFSET);

  // ground mesh
  const seg = 520;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    groundColor(c, pos.getX(i), pos.getZ(i), pos.getY(i), nrm.getY(i));
    const n = (rand() - 0.5) * 0.12;
    colors[i * 3] = c.r + n; colors[i * 3 + 1] = c.g + n; colors[i * 3 + 2] = c.b + n;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const groundTex = groundTexture();
  groundTex.repeat.set(WORLD_SIZE / 5, WORLD_SIZE / 5);
  // the tile averages ~0.8 grey, so the material colour compensates
  const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex, bumpMap: groundTex, bumpScale: 0.4 });
  groundMat.color.setScalar(0.7);
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // heightfield collider: heights[j * n + i], j along x, i along z
  const n = 361;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -WORLD_SIZE / 2 + (j * WORLD_SIZE) / (n - 1);
      const z = -WORLD_SIZE / 2 + (i * WORLD_SIZE) / (n - 1);
      heights[j * n + i] = groundHeight(x, z);
    }
  }
  const groundCol = world.createCollider(
    RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE })
      .setFriction(0.9)
      .setCollisionGroups(groups(GROUP_STATIC, 0xffff)),
  );

  // road strip following the centreline
  const segs = 440;
  const rpos: number[] = [], ruv: number[] = [], ridx: number[] = [];
  let arc = 0;
  for (let i = 0; i <= segs; i++) {
    const x = -ROAD_HALF_LEN + (i / segs) * ROAD_HALF_LEN * 2;
    if (i > 0) arc += Math.hypot(ROAD_HALF_LEN * 2 / segs, roadSlopeZ(x) * ROAD_HALF_LEN * 2 / segs);
    const y = roadHeight(x) + 0.03;
    for (const side of [-1, 1]) {
      rpos.push(x, y, laneZ(x, side * ROAD_HALF_W));
      ruv.push(arc / 8, side > 0 ? 1 : 0);
    }
    if (i > 0) {
      const b = i * 2;
      ridx.push(b - 2, b - 1, b, b - 1, b + 1, b);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(rpos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  roadGeo.setIndex(ridx);
  roadGeo.computeVertexNormals();
  // the bridge approach is a no-overtaking stretch with a double yellow line
  const segX = (i: number) => -ROAD_HALF_LEN + (i / segs) * ROAD_HALF_LEN * 2;
  const y0 = Math.max(0, Math.floor(((BRIDGE_X0 - 70) + ROAD_HALF_LEN) / (ROAD_HALF_LEN * 2) * segs));
  const y1 = Math.min(segs, Math.ceil(((BRIDGE_X1 + 45) + ROAD_HALF_LEN) / (ROAD_HALF_LEN * 2) * segs));
  void segX;
  roadGeo.addGroup(0, y0 * 6, 0);
  roadGeo.addGroup(y0 * 6, (y1 - y0) * 6, 1);
  roadGeo.addGroup(y1 * 6, (segs - y1) * 6, 0);
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.92, metalness: 0 });
  const roadMatYellow = new THREE.MeshStandardMaterial({ map: asphaltTexture(true), roughness: 0.92, metalness: 0 });
  const road = new THREE.Mesh(roadGeo, [roadMat, roadMatYellow]);
  road.receiveShadow = true;
  scene.add(road);

  // trees
  const pineTrunk = new THREE.CylinderGeometry(0.14, 0.3, 9, 6).translate(0, 4.5, 0);
  const pineCrown = mergeGeometries([
    new THREE.ConeGeometry(1.6, 3.2, 7).translate(0, 7.2, 0),
    new THREE.ConeGeometry(1.2, 2.6, 7).translate(0, 9.2, 0),
    new THREE.ConeGeometry(0.7, 2.0, 7).translate(0, 10.8, 0),
  ]);
  // the esker's old pines: tall bare trunks with a small umbrella crown high up
  const tallPineTrunk = new THREE.CylinderGeometry(0.12, 0.34, 15, 6).translate(0, 7.5, 0);
  const tallPineCrown = mergeGeometries([
    new THREE.ConeGeometry(2.6, 2.6, 7).translate(0, 15.2, 0),
    new THREE.ConeGeometry(2.0, 2.2, 7).translate(0.8, 16.6, 0.4),
    new THREE.ConeGeometry(1.4, 2.0, 7).translate(-0.6, 17.6, -0.3),
  ]);
  const spruceTrunk = new THREE.CylinderGeometry(0.1, 0.25, 4, 6).translate(0, 2, 0);
  const spruceCrown = mergeGeometries([
    new THREE.ConeGeometry(2.0, 4.5, 7).translate(0, 3.5, 0),
    new THREE.ConeGeometry(1.5, 4.0, 7).translate(0, 6.2, 0),
    new THREE.ConeGeometry(1.0, 3.5, 7).translate(0, 8.6, 0),
    new THREE.ConeGeometry(0.5, 2.5, 7).translate(0, 10.6, 0),
  ]);
  const birchTrunk = new THREE.CylinderGeometry(0.08, 0.16, 7, 6).translate(0, 3.5, 0);
  const birchCrown = new THREE.SphereGeometry(1.8, 7, 6).scale(1, 1.6, 1).translate(0, 7.6, 0);
  // dead silver pine (kelo): bare trunk with a couple of stubs. Juniper: low dark cone
  const keloTrunk = mergeGeometries([
    new THREE.CylinderGeometry(0.08, 0.32, 11, 6).translate(0, 5.5, 0),
    new THREE.CylinderGeometry(0.03, 0.08, 1.6, 5).rotateZ(1.1).translate(0.5, 7.5, 0),
    new THREE.CylinderGeometry(0.03, 0.07, 1.3, 5).rotateZ(-1.3).translate(-0.4, 8.6, 0.2),
  ]);
  const keloCrown = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const juniperTrunk = new THREE.CylinderGeometry(0.04, 0.06, 0.4, 5).translate(0, 0.2, 0);
  const juniperCrown = mergeGeometries([
    new THREE.ConeGeometry(0.7, 2.2, 6).translate(0, 1.3, 0),
    new THREE.ConeGeometry(0.5, 1.6, 6).translate(0.35, 1.0, 0.2),
  ]);

  const mat = (r: number, g: number, b: number) => new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b) });
  const kinds = [
    { trunk: pineTrunk, crown: pineCrown, tm: mat(0.55, 0.36, 0.18), cm: mat(0.12, 0.3, 0.13), count: 1800 },
    { trunk: spruceTrunk, crown: spruceCrown, tm: mat(0.3, 0.2, 0.12), cm: mat(0.08, 0.2, 0.1), count: 1300 },
    { trunk: birchTrunk, crown: birchCrown, tm: mat(0.9, 0.9, 0.86), cm: mat(0.42, 0.62, 0.22), count: 260 },
    { trunk: keloTrunk, crown: keloCrown, tm: mat(0.62, 0.6, 0.55), cm: mat(0.5, 0.5, 0.5), count: 140 },
    { trunk: tallPineTrunk, crown: tallPineCrown, tm: mat(0.62, 0.4, 0.2), cm: mat(0.13, 0.32, 0.14), count: 520, esker: true },
    { trunk: juniperTrunk, crown: juniperCrown, tm: mat(0.3, 0.2, 0.12), cm: mat(0.1, 0.22, 0.12), count: 500 },
  ];
  const treesNearRoad: THREE.Vector3[] = [];
  // bogs and bare rock carry only the odd stunted tree
  const sparse = (x: number, z: number) => {
    const lf = landforms(x, z);
    return rand() < Math.max(lf.bog * 0.93, lf.rock * 0.7);
  };
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const k of kinds) {
    const trunk = new THREE.InstancedMesh(k.trunk, k.tm, k.count);
    const crown = new THREE.InstancedMesh(k.crown, k.cm, k.count);
    trunk.castShadow = crown.castShadow = true;
    crown.receiveShadow = true;
    for (let i = 0; i < k.count; i++) {
      let x = 0, z = 0;
      const nearRoad = i < k.count * 0.45;
      const border = !('esker' in k) && i >= k.count * 0.45 && i < k.count * 0.55;
      do {
        if ('esker' in k) {
          x = ESKER_X0 - 20 + rand() * (ROAD_HALF_LEN - ESKER_X0 + 20);
          z = laneZ(x, (5.5 + rand() * 30) * (rand() < 0.5 ? -1 : 1));
        } else if (border) {
          // the only impenetrable stand: right behind the gap the moose comes from
          x = (rand() - 0.5) * 90;
          z = laneZ(x, Math.sign(START_OFFSET) * (START_OFFSET + 3 + rand() * 24));
        } else {
          x = (rand() - 0.5) * (nearRoad ? ROAD_HALF_LEN * 2 : WORLD_SIZE - 20);
          z = nearRoad ? laneZ(x, (9 + rand() * 36) * (rand() < 0.5 ? -1 : 1)) : (rand() - 0.5) * (WORLD_SIZE - 20);
        }
      } while (Math.abs(roadOffset(x, z)) < ('esker' in k ? 5.5 : 8.5 + rand() * 3) || Math.hypot(x - START.x, z - startZ) < 3 || (Math.abs(x) < FENCE_GAP + 1 && roadOffset(x, z) > 8 && roadOffset(x, z) < START_OFFSET) || groundHeight(x, z) < WATER_Y + 0.8 || parkMask(x, roadOffset(x, z)) > 0.05 || sparse(x, z));
      const y = groundHeight(x, z);
      // wide size spread: seedlings to old giants, with a slight lean now and then
      const sc = 0.45 + rand() * rand() * 1.5;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08));
      s.set(sc, sc * (0.8 + rand() * 0.6), sc);
      m.compose(new THREE.Vector3(x, y - 0.2, z), q, s);
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      if (Math.abs(roadOffset(x, z)) < 32 && Math.abs(x) < ROAD_HALF_LEN + 10) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + 4, z));
        world.createCollider(
          RAPIER.ColliderDesc.cylinder(4, 0.22 * sc).setCollisionGroups(groups(GROUP_STATIC, 0xffff)),
          body,
        );
        treesNearRoad.push(new THREE.Vector3(x, y, z));
      }
    }
    scene.add(trunk, crown);
  }

  // rocks: grey boulders, mossy rounded stones, flat slabs
  const rockKinds = [
    { geo: new THREE.DodecahedronGeometry(1, 0), m: mat(0.4, 0.4, 0.38), count: 140, flat: 0.7 },
    { geo: new THREE.IcosahedronGeometry(1, 1), m: mat(0.32, 0.4, 0.26), count: 160, flat: 0.6 },
    { geo: new THREE.BoxGeometry(2, 0.5, 1.4), m: mat(0.45, 0.44, 0.42), count: 60, flat: 1 },
    { geo: new THREE.DodecahedronGeometry(1, 0), m: mat(0.42, 0.42, 0.4), count: 220, flat: 0.8, onRock: true },
  ];
  for (const k of rockKinds) {
    const rocks = new THREE.InstancedMesh(k.geo, k.m, k.count);
    rocks.castShadow = rocks.receiveShadow = true;
    for (let i = 0; i < k.count; i++) {
      let x = 0, z = 0;
      do { x = (rand() - 0.5) * 480; z = (rand() - 0.5) * 480; } while (Math.abs(roadOffset(x, z)) < 9 || groundHeight(x, z) < WATER_Y + 0.3 || ('onRock' in k && landforms(x, z).rock < 0.6));
      const sc = 0.3 + rand() * rand() * 1.8;
      q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * 6, rand() * 0.4));
      s.set(sc * (1 + rand()), sc * k.flat, sc * (0.8 + rand() * 0.5));
      m.compose(new THREE.Vector3(x, groundHeight(x, z) - sc * 0.25, z), q, s);
      rocks.setMatrixAt(i, m);
    }
    scene.add(rocks);
  }

  // the far shores of Päijänne: a dark forested band on the horizon, softened by fog
  const shoreRing = new THREE.Mesh(new THREE.CylinderGeometry(760, 760, 14, 48, 1, true), new THREE.MeshLambertMaterial({ color: new THREE.Color(0.14, 0.22, 0.15), side: THREE.BackSide }));
  shoreRing.position.set(0, WATER_Y + 5, 0);
  scene.add(shoreRing);

  // distant islands out on Päijänne: low forested mounds with a rim of shore rock
  const islandMat = mat(0.16, 0.3, 0.16);
  for (let i = 0; i < 16; i++) {
    const ix = ESKER_X0 + 60 + (rand() - 0.5) * 520, side = rand() < 0.5 ? -1 : 1;
    const iz = laneZ(ix, side * (110 + rand() * 160));
    const g = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6).scale(18 + rand() * 30, 4 + rand() * 3, 10 + rand() * 14), islandMat);
    g.add(mound);
    for (let k = 0; k < 14; k++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 5), mat(0.12, 0.3, 0.13));
      t.position.set((rand() - 0.5) * mound.scale.x * 1.4, 4.5, (rand() - 0.5) * mound.scale.z * 1.4);
      g.add(t);
    }
    g.position.set(ix, WATER_Y - 1.5, iz);
    g.rotation.y = rand() * Math.PI;
    scene.add(g);
  }

  // shore rocks along the esker waterline
  const shoreRocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat(0.55, 0.55, 0.52), 260);
  let sr = 0;
  for (let x = ESKER_X0 + 30; x < ROAD_HALF_LEN && sr < 260; x += 3) {
    for (const side of [-1, 1]) {
      if (isStrait(x) || sr >= 260) continue;
      // walk outwards until the flank reaches the waterline
      let off = 10;
      while (off < 60 && groundHeight(x, laneZ(x, side * off)) > WATER_Y + 0.4) off += 1;
      if (off >= 60) continue;
      const z = laneZ(x, side * (off + (rand() - 0.5) * 2));
      const sc = 0.4 + rand() * 1.0;
      q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand()));
      s.set(sc * 1.4, sc * 0.7, sc);
      m.compose(new THREE.Vector3(x, WATER_Y + 0.1 + rand() * 0.4, z), q, s);
      shoreRocks.setMatrixAt(sr++, m);
    }
  }
  shoreRocks.count = sr;
  scene.add(shoreRocks);

  // stumps: bark cylinder with a pale sawn top
  const stumpBark = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.4, 0.5, 7).translate(0, 0.25, 0), mat(0.35, 0.25, 0.15), 320);
  const stumpTop = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 7).translate(0, 0.5, 0), mat(0.8, 0.7, 0.5), 320);
  stumpBark.castShadow = true;
  for (let i = 0; i < 320; i++) {
    let x = 0, z = 0;
    do { x = (rand() - 0.5) * 460; z = (rand() - 0.5) * 460; } while (Math.abs(roadOffset(x, z)) < 8 || groundHeight(x, z) < WATER_Y + 0.5);
    const sc = 0.6 + rand() * 1.2;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6);
    s.set(sc, 0.5 + rand() * 1.2, sc);
    m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05, z), q, s);
    stumpBark.setMatrixAt(i, m);
    stumpTop.setMatrixAt(i, m);
  }
  scene.add(stumpBark, stumpTop);

  // undergrowth: shrubs, sedge tufts and fallen logs, densest where the moose actually runs
  const shrubGeo = mergeGeometries([
    new THREE.IcosahedronGeometry(0.5, 0).scale(1, 0.55, 1),
    new THREE.IcosahedronGeometry(0.4, 0).scale(1, 0.5, 1).translate(0.4, -0.05, 0.2),
    new THREE.IcosahedronGeometry(0.35, 0).scale(1, 0.5, 1).translate(-0.35, -0.08, -0.25),
  ]).translate(0, 0.22, 0);
  const tuftGeo = mergeGeometries([
    new THREE.PlaneGeometry(1.1, 0.8).translate(0, 0.4, 0),
    new THREE.PlaneGeometry(1.1, 0.8).translate(0, 0.4, 0).rotateY(Math.PI / 2),
  ]);
  const logGeo = new THREE.CylinderGeometry(0.16, 0.3, 6, 7).rotateZ(Math.PI / 2);
  const shrubs = new THREE.InstancedMesh(shrubGeo, new THREE.MeshLambertMaterial(), 3000);
  const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshLambertMaterial({ map: grassTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), 5200);
  const logs = new THREE.InstancedMesh(logGeo, new THREE.MeshLambertMaterial(), 150);
  shrubs.castShadow = logs.castShadow = true;
  shrubs.receiveShadow = tufts.receiveShadow = logs.receiveShadow = true;
  const side = () => (rand() < 0.5 ? -1 : 1);
  const nearBand = (): [number, number] => { const x = (rand() - 0.5) * ROAD_HALF_LEN * 2; return [x, laneZ(x, side() * (6 + rand() * 40))]; };
  const ditchBand = (): [number, number] => { const x = (rand() - 0.5) * ROAD_HALF_LEN * 2; return [x, laneZ(x, side() * (4.6 + 3.5 * eskerAmount(x) + rand() * 4))]; };
  const anywhere = (): [number, number] => [(rand() - 0.5) * 460, (rand() - 0.5) * 460];
  const okSpot = (x: number, z: number) => {
    const off = roadOffset(x, z);
    return Math.abs(off) > 4.6 + 3.5 * eskerAmount(x) && groundHeight(x, z) > WATER_Y + 0.4 && parkMask(x, off) < 0.05 && Math.hypot(x - START.x, z - startZ) > 2;
  };
  const scatter = (mesh: THREE.InstancedMesh, i0: number, i1: number, pick: () => [number, number], accept: (x: number, z: number) => boolean,
    build: (x: number, z: number, y: number) => void) => {
    for (let i = i0; i < i1; i++) {
      let x = 0, z = 0, tries = 0;
      do { [x, z] = pick(); } while (++tries < 40 && !(okSpot(x, z) && accept(x, z)));
      if (tries >= 40) { m.makeScale(0, 0, 0); mesh.setMatrixAt(i, m); continue; }
      build(x, z, groundHeight(x, z));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c);
    }
  };
  const yaw = (extraTilt = 0) => q.setFromEuler(new THREE.Euler((rand() - 0.5) * extraTilt, rand() * Math.PI * 2, (rand() - 0.5) * extraTilt));
  scatter(shrubs, 0, shrubs.count, () => (rand() < 0.7 ? nearBand() : anywhere()), (x, z) => {
    const lf = landforms(x, z);
    return rand() > Math.max(lf.bog * 0.8, lf.rock * 0.6);
  }, (x, z, y) => {
    const sc = 0.5 + rand() * 1.0;
    const patch = fbm(x * 0.08 + 21, z * 0.08 + 8, 2);
    c.set(0.17, 0.16, 0.09).lerp(new THREE.Color(0.08, 0.19, 0.07), clamp01(0.5 + patch * 2)).lerp(new THREE.Color(0.12, 0.24, 0.09), rand() * 0.4);
    m.compose(new THREE.Vector3(x, y - 0.1, z), yaw(0.2), s.set(sc, sc * (0.7 + rand() * 0.6), sc));
  });
  const tuft = (x: number, z: number, y: number, r: number, g: number, b: number) => {
    const sc = 0.5 + rand() * 0.8;
    c.set(r + rand() * 0.15, g + rand() * 0.15, b);
    m.compose(new THREE.Vector3(x, y - 0.03, z), yaw(), s.set(sc, sc * (0.8 + rand() * 0.5), sc));
  };
  scatter(tufts, 0, 1800, ditchBand, () => true, (x, z, y) => tuft(x, z, y, 0.45, 0.5, 0.2));
  scatter(tufts, 1800, 4400, anywhere, (x, z) => landforms(x, z).bog > 0.5, (x, z, y) => tuft(x, z, y, 0.62, 0.55, 0.25));
  scatter(tufts, 4400, tufts.count, nearBand, () => true, (x, z, y) => tuft(x, z, y, 0.4, 0.5, 0.22));
  scatter(logs, 0, logs.count, nearBand, (x, z) => Math.abs(roadOffset(x, z)) > 9, (x, z, y) => {
    const sc = 0.6 + rand() * 0.9;
    c.set(0.28 + rand() * 0.1, 0.25 + rand() * 0.06, 0.15);
    m.compose(new THREE.Vector3(x, y + 0.02 * sc, z), yaw(0.15), s.set(sc, sc, sc));
  });
  scene.add(shrubs, tufts, logs);

  // reflector posts along the road edge
  const postGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6).translate(0, 0.55, 0),
    new THREE.BoxGeometry(0.11, 0.08, 0.11).translate(0, 0.95, 0),
  ]);
  const postCount = Math.floor((ROAD_HALF_LEN * 2) / 50) * 2;
  const posts = new THREE.InstancedMesh(postGeo, mat(0.95, 0.95, 0.9), postCount);
  let pi = 0;
  for (let x = -ROAD_HALF_LEN + 25; x < ROAD_HALF_LEN; x += 50) {
    for (const side of [-1, 1]) {
      const z = laneZ(x, side * (ROAD_HALF_W + 0.7));
      if (isStrait(x)) continue;
      m.compose(new THREE.Vector3(x, Math.max(groundHeight(x, z), roadHeight(x) - 0.3), z), q.identity(), s.set(1, 1, 1));
      posts.setMatrixAt(pi++, m);
    }
  }
  posts.count = pi;
  scene.add(posts);

  // the road number painted on the asphalt every so often
  const numCanvas = document.createElement('canvas');
  numCanvas.width = 128; numCanvas.height = 256;
  const ng = numCanvas.getContext('2d')!;
  ng.clearRect(0, 0, 128, 256);
  ng.fillStyle = 'rgba(235,235,225,0.85)';
  ng.font = 'bold 150px Helvetica, Arial';
  ng.textAlign = 'center';
  ng.save(); ng.translate(64, 128); ng.rotate(Math.PI / 2); ng.scale(1, 2.2); ng.fillText('314', 0, 50); ng.restore();
  const numTex = new THREE.CanvasTexture(numCanvas);
  numTex.colorSpace = THREE.SRGBColorSpace;
  const numMat = new THREE.MeshLambertMaterial({ map: numTex, transparent: true, depthWrite: false });
  for (let nx = -ROAD_HALF_LEN + 60; nx < ROAD_HALF_LEN; nx += 120) {
    for (const side of [-1, 1]) {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.6).rotateX(-Math.PI / 2), numMat);
      const nz = laneZ(nx, side * LANE_Z);
      decal.position.set(nx, roadHeight(nx) + 0.045, nz);
      decal.rotation.y = -Math.atan(roadSlopeZ(nx)) + (side > 0 ? 0 : Math.PI);
      scene.add(decal);
    }
  }

  // one moose warning sign per direction, ahead of the fence gap; grey back, pole behind
  const signTex = signTextures('/liikennemerkit/hirvivaara.svg');
  const frontMat = new THREE.MeshLambertMaterial({ map: signTex.front, transparent: true, alphaTest: 0.4 });
  const backMat = new THREE.MeshLambertMaterial({ map: signTex.back, transparent: true, alphaTest: 0.4 });
  const poleMat = mat(0.6, 0.6, 0.62);
  for (const side of [1, -1]) {
    const sign = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), poleMat);
    pole.position.y = 1.3;
    const plateGeo = new THREE.PlaneGeometry(1.0, 0.88);
    const front = new THREE.Mesh(plateGeo, frontMat);
    front.position.set(0, 2.2, 0.06);
    const back = new THREE.Mesh(plateGeo, backMat);
    back.position.set(0, 2.2, 0.055);
    back.rotation.y = Math.PI;
    sign.add(pole, front, back);
    const sx = -side * 80, sz = laneZ(sx, side * (ROAD_HALF_W + 1.4));
    sign.position.set(sx, groundHeight(sx, sz), sz);
    sign.rotation.y = (side > 0 ? -Math.PI / 2 : Math.PI / 2) - Math.atan(roadSlopeZ(sx));
    pole.castShadow = true;
    scene.add(sign);
  }

  // moose fence along both sides, with one gap the moose has to use
  const fenceMat = new THREE.MeshLambertMaterial({ map: fenceTexture(), transparent: true, side: THREE.DoubleSide, alphaTest: 0.3 });
  const postGeo2 = new THREE.CylinderGeometry(0.05, 0.06, 2.3, 5).translate(0, 1.15, 0);
  const fencePosts = new THREE.InstancedMesh(postGeo2, mat(0.35, 0.3, 0.25), Math.ceil((ROAD_HALF_LEN * 2) / 4) * 2 + 4);
  let fp = 0;
  const fenceSegment = (x0: number, x1: number, offset: number) => {
    const n = Math.max(1, Math.round((x1 - x0) / 8));
    const fpos: number[] = [], fuv: number[] = [], fidx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const z = laneZ(x, offset);
      const y = groundHeight(x, z);
      fpos.push(x, y, z, x, y + 2.2, z);
      fuv.push(x / 2, 0, x / 2, 1.1);
      if (i > 0) { const b = i * 2; fidx.push(b - 2, b, b - 1, b - 1, b, b + 1); }
      if (i < n) {
        const cx = x + (x1 - x0) / n / 2, cz = laneZ(cx, offset), cy = groundHeight(cx, cz);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy + 1.1, cz)
          .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan(roadSlopeZ(cx)))));
        world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / n / 2 + 0.2, 1.1, 0.05).setCollisionGroups(groups(GROUP_STATIC, 0xffff)), body);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    geo.setIndex(fidx);
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, fenceMat));
    for (let x = x0; x <= x1; x += 4) {
      const z = laneZ(x, offset);
      m.compose(new THREE.Vector3(x, groundHeight(x, z), z), q.identity(), s.set(1, 1, 1));
      fencePosts.setMatrixAt(fp++, m);
    }
  };
  fenceSegment(-ROAD_HALF_LEN, ESKER_X0, -FENCE_Z);
  fenceSegment(-ROAD_HALF_LEN, -FENCE_GAP, FENCE_Z);
  fenceSegment(FENCE_GAP, ESKER_X0, FENCE_Z);
  fencePosts.count = fp;
  fencePosts.castShadow = true;
  scene.add(fencePosts);

  // lake (Päijänne): still water with a low-roughness surface for sun glitter
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x24506e, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.88 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 1.6, WORLD_SIZE * 1.6).rotateX(-Math.PI / 2), waterMat);
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);

  // Karisalmi bridge: suspension bridge. Concrete deck, two portal pylons, main cables with hangers, railings
  const concrete = mat(0.62, 0.62, 0.6);
  const steel = mat(0.6, 0.72, 0.68);
  const bx = (BRIDGE_X0 + BRIDGE_X1) / 2, blen = BRIDGE_X1 - BRIDGE_X0;
  const deckY = roadHeight(bx) - 0.56;
  const bridgeYaw = -Math.atan(roadSlopeZ(bx));
  const bridge = new THREE.Group();
  bridge.position.set(bx, deckY, laneZ(bx, 0));
  bridge.rotation.y = bridgeYaw;
  // abutments: the deck runs 8 m past the strait on both banks so the road never hangs over a gap
  const deck = new THREE.Mesh(new THREE.BoxGeometry(blen + 16, 1.1, BRIDGE_W), concrete);
  bridge.add(deck);
  // steel box girder beneath the deck, the dark green seen from the lake
  const girder = new THREE.Mesh(new THREE.BoxGeometry(blen + 12, 1.6, BRIDGE_W - 2.2), mat(0.22, 0.34, 0.3));
  girder.position.y = -1.3;
  bridge.add(girder);
  const deckBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bridge.position.x, bridge.position.y, bridge.position.z)
    .setRotation(new THREE.Quaternion().setFromEuler(bridge.rotation)));
  world.createCollider(RAPIER.ColliderDesc.cuboid(blen / 2 + 8, 0.55, BRIDGE_W / 2).setCollisionGroups(groups(GROUP_STATIC, 0xffff)), deckBody);
  const pylonH = 11, pylonXs = [-blen * 0.28, blen * 0.28];
  const bottom = WATER_Y - 7;
  for (const px of pylonXs) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, pylonH, 0.9), steel);
      post.position.set(px, pylonH / 2, side * (BRIDGE_W / 2 - 0.5));
      bridge.add(post);
    }
    // concrete pier: one wide pillar per pylon with a broad footing on the lake bed
    const pier = new THREE.Mesh(new THREE.BoxGeometry(2.4, deckY - bottom, BRIDGE_W - 3), concrete);
    pier.position.set(px, -(deckY - bottom) / 2, 0);
    const footing = new THREE.Mesh(new THREE.BoxGeometry(4.5, 2.5, BRIDGE_W), concrete);
    footing.position.set(px, bottom - deckY + 1.2, 0);
    bridge.add(pier, footing);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, BRIDGE_W), steel);
    beam.position.set(px, pylonH - 0.45, 0);
    bridge.add(beam);
  }
  // main cable: parabola between the pylon tops, straight back-stays to anchors beyond the abutments
  const cableY = (x: number) => {
    const [p0, p1] = pylonXs;
    const top = pylonH - 0.2, low = 1.6;
    if (x < p0) return THREE.MathUtils.lerp(0.4, top, (x + blen / 2 + 4) / (p0 + blen / 2 + 4));
    if (x > p1) return THREE.MathUtils.lerp(top, 0.4, (x - p1) / (blen / 2 + 4 - p1));
    const u = (x - (p0 + p1) / 2) / ((p1 - p0) / 2);
    return low + (top - low) * u * u;
  };
  for (const side of [-1, 1]) {
    const z = side * (BRIDGE_W / 2 - 0.5);
    const pts: THREE.Vector3[] = [];
    for (let x = -blen / 2 - 4; x <= blen / 2 + 4; x += 1.5) pts.push(new THREE.Vector3(x, cableY(x), z));
    const cable = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.09, 6, false), steel);
    bridge.add(cable);
    for (let x = -blen / 2 + 2; x <= blen / 2 - 2; x += 3) {
      const top = cableY(x), h = top - 0.6;
      if (h < 0.8) continue;
      const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h, 5), steel);
      hanger.position.set(x, 0.6 + h / 2, z);
      bridge.add(hanger);
    }
  }
  const railGeo = mergeGeometries([
    new THREE.BoxGeometry(blen + 4, 0.08, 0.08).translate(0, 1.1, 0),
    new THREE.BoxGeometry(blen + 4, 0.06, 0.06).translate(0, 0.6, 0),
    ...Array.from({ length: Math.floor((blen + 4) / 2.5) }, (_, i) => new THREE.BoxGeometry(0.08, 1.15, 0.08).translate(-blen / 2 - 2 + 1 + i * 2.5, 0.575, 0)),
  ]);
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(railGeo, mat(0.75, 0.75, 0.72));
    rail.position.set(0, 0.55, side * (BRIDGE_W / 2 - 0.2));
    bridge.add(rail);
  }
  bridge.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  scene.add(bridge);

  // steel guard rails along the esker road where the flanks fall away to the lake
  const railMat = mat(0.7, 0.72, 0.7);
  const railPostGeo = new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0, 0.375, 0);
  const railPosts = new THREE.InstancedMesh(railPostGeo, railMat, 400);
  let rp = 0;
  for (const side of [-1, 1]) {
    const off = side * (ROAD_HALF_W + 0.5);
    const gpos: number[] = [], gidx: number[] = [];
    let n = 0;
    for (let x = ESKER_X0 + 25; x <= ROAD_HALF_LEN; x += 4) {
      if (isStrait(x)) continue;
      const z = laneZ(x, off), y = Math.max(groundHeight(x, z), roadHeight(x) - 0.4) + 0.45;
      if (x % 8 === 0 || x === ESKER_X0 + 25) {
        m.compose(new THREE.Vector3(x, y - 0.45, z), q.identity(), s.set(1, 1, 1));
        if (rp < 400) railPosts.setMatrixAt(rp++, m);
      }
      gpos.push(x, y, z, x, y + 0.3, z);
      if (n > 0) { const b2 = n * 2; gidx.push(b2 - 2, b2 - 1, b2, b2 - 1, b2 + 1, b2); }
      n++;
      if (x % 8 === 0 && x + 8 <= ROAD_HALF_LEN && !isStrait(x + 4)) {
        const cx = x + 4, cz = laneZ(cx, off), cy = Math.max(groundHeight(cx, cz), roadHeight(cx) - 0.4) + 0.5;
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz)
          .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan(roadSlopeZ(cx)))));
        world.createCollider(RAPIER.ColliderDesc.cuboid(4.2, 0.35, 0.08).setCollisionGroups(groups(GROUP_STATIC, 0xffff)), body);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    g.setIndex(gidx);
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: railMat.color, side: THREE.DoubleSide })));
  }
  railPosts.count = rp;
  scene.add(railPosts);

  // lakeside kiosk (Kansallispuiston Helmi) at the start of the esker
  const kiosk = new THREE.Group();
  const kx = PARK.x1 - 5, koff = PARK.off1 + 4, kz = laneZ(kx, koff), ky = groundHeight(kx, kz);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 5), mat(0.75, 0.2, 0.15));
  walls.position.y = 1.4;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), mat(0.25, 0.25, 0.28));
  roof.position.y = 3.7;
  roof.rotation.y = Math.PI / 4;
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 0.1), mat(0.95, 0.9, 0.7));
  signBoard.position.set(0, 2.2, 2.55);
  kiosk.add(walls, roof, signBoard);
  kiosk.position.set(kx, ky, kz);
  kiosk.rotation.y = -Math.atan(roadSlopeZ(kx)) + Math.PI;
  kiosk.traverse((o) => { o.castShadow = true; });
  scene.add(kiosk);

  // the landing under the bridge: gravel apron, concrete ramp, wooden jetty and the striped water gauge
  {
    const lx = BRIDGE_X1 + 14, loff = 9, lz = laneZ(lx, loff);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(18, 14).rotateX(-Math.PI / 2), mat(0.62, 0.58, 0.5));
    apron.position.set(lx, WATER_Y + 0.6, lz + 6);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 9), concrete);
    ramp.position.set(lx - 4, WATER_Y + 0.2, lz + 9);
    ramp.rotation.x = 0.12;
    const jetty = new THREE.Group();
    const planks = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, 9), mat(0.5, 0.4, 0.28));
    planks.position.set(0, 0, 4.5);
    jetty.add(planks);
    for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.5, 6), mat(0.35, 0.28, 0.2));
      pile.position.set(sd * 0.9, -1.1, 1 + i * 2.5);
      jetty.add(pile);
    }
    jetty.position.set(lx + 3, WATER_Y + 0.5, lz + 8);
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), new THREE.MeshLambertMaterial({ color: 0xd02020 }));
    gauge.position.set(lx - 7, WATER_Y + 1.5, lz + 10);
    for (const y of [-1.2, -0.4, 0.4, 1.2]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0xf5d020 }));
      band.position.y = y;
      gauge.add(band);
    }
    scene.add(apron, ramp, jetty, gauge);
  }

  // parked cars in a row, plus the P sign and the brown national park sign
  const parkedColors = [0xf2f2f2, 0xc8cacc, 0x1c1c1e, 0x1f2f55, 0x9b1b1b, 0x6e7073, 0xd6c66a, 0x2b4c8c, 0xf2f2f2];
  parkedColors.forEach((color, i) => {
    const px = PARK.x0 + 4 + i * 3.1, poff = PARK.off1 + 9, pz = laneZ(px, poff), py = groundHeight(px, pz);
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.55, 4.3), new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 }));
    body.position.y = 0.6;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.2), body.material);
    cab.position.set(0, 1.12, -0.2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.26, 2.24), new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.2, metalness: 0.6 }));
    glass.position.set(0, 1.18, -0.2);
    car.add(body, cab, glass);
    for (const [wx, wz] of [[0.85, 1.4], [-0.85, 1.4], [0.85, -1.4], [-0.85, -1.4]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 10).rotateZ(Math.PI / 2), mat(0.1, 0.1, 0.1));
      w.position.set(wx, 0.32, wz);
      car.add(w);
    }
    car.position.set(px, py, pz);
    car.rotation.y = -Math.atan(roadSlopeZ(px)) + (rand() - 0.5) * 0.1;
    car.traverse((o) => { o.castShadow = true; });
    scene.add(car);
    const pb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(px, py + 0.7, pz)
      .setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.rotation.y)));
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.7, 2.15).setCollisionGroups(groups(GROUP_STATIC, 0xffff)), pb);
  });
  const signAt = (x: number, off: number, w: number, h: number, color: number, text: string) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 6), poleMat);
    pole.position.y = 1.2;
    const c = document.createElement('canvas');
    c.width = 256; c.height = Math.round(256 * h / w);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 64px Helvetica, Arial';
    ctx.textAlign = 'center';
    text.split('\n').forEach((line, i) => ctx.fillText(line, 128, 80 + i * 60));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    plate.position.set(0, 2.4 + h / 2, 0);
    g.add(pole, plate);
    const z = laneZ(x, off);
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = -Math.PI / 2 - Math.atan(roadSlopeZ(x));
    scene.add(g);
  };
  signAt(PARK.x0 - 3, PARK.off0 + 1, 0.8, 0.8, 0x1f5fbf, 'P');
  signAt(PARK.x0 - 3, PARK.off0 + 1, 1.6, 0.7, 0x6b4a2a, 'Päijänne\nNational Park');

  return {
    groundHandle: groundCol.handle,
    treesNearRoad,
    setWet(w) {
      groundMat.color.setScalar(0.7 * (1 - 0.3 * w));
      for (const mtl of [roadMat, roadMatYellow]) {
        mtl.roughness = 0.92 - 0.55 * w;
        mtl.color.setScalar(1 - 0.35 * w);
      }
    },
  };
}
