"use client";

// Brain Cosmos — the twin's memory graph as a living 3D brain.
//
// three.js renders a particle brain (two hemispheres + cerebellum) with the
// twin's knowledge files as neurons inside it and links as light synapses.
// anime.js choreographs everything that happens *because the twin thinks*:
// the brain assembling on load, impulses travelling hub → file when a file
// is read, the neuron blooming, a shockwave when a file is cited, and quiet
// spontaneous firing in between. Same props as ObsidianGraph, so it is a
// drop-in; callers fall back to ObsidianGraph without WebGL or with reduced
// motion (see `canRenderCosmos`).

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { animate, createTimeline } from "animejs";
import type { EmployeeGraph, RealNode } from "@/lib/profile-graph-real";
import type { GraphHighlightState } from "@/components/ex/obsidian-graph";
import { useT } from "@/components/ex/i18n-context";

type Props = {
  graph: EmployeeGraph | null;
  state: GraphHighlightState;
  onOpenFile: (name: string) => void;
  loading?: boolean;
};

// ─── Palette (the stage is always dark: a window into the brain) ────────────

const C = {
  bgInner: "#140d08",
  bgOuter: "#030202",
  matterA: "#5a3a24",
  matterB: "#ffcf8a",
  wave: "#9fe3ff",
  file: "#e0ad78",
  fileHigh: "#ffd27a",
  memory: "#fde36b",
  cited: "#fff3d6",
  touched: "#c9a27e",
  synapse: "#ff9d4d",
  impulse: "#b8ecff",
};

/** True when WebGL2 is available and the user hasn't asked for reduced motion. */
export function canRenderCosmos(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2"));
  } catch {
    return false;
  }
}

// ─── Deterministic random ───────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Brain geometry ─────────────────────────────────────────────────────────

const HEMI_OFFSET = 0.44;
const HEMI_RADII = new THREE.Vector3(0.72, 0.9, 1.28);

/** A point on (or inside, `depth` < 1) one hemisphere, with cortical folds. */
function hemispherePoint(side: 1 | -1, u: number, v: number, depth: number, fold: number): THREE.Vector3 {
  const theta = u * Math.PI * 2;
  const phi = Math.acos(1 - 2 * v);
  const dir = new THREE.Vector3(
    Math.abs(Math.sin(phi) * Math.cos(theta)) * side,
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
  // Flatten the medial wall a little so the two hemispheres read as separate.
  if (Math.sign(dir.x) !== side) dir.x = 0;
  const gyri = 1 + fold * Math.sin(theta * 11 + phi * 7) * Math.sin(phi * 9 - theta * 3);
  return new THREE.Vector3(
    side * HEMI_OFFSET + dir.x * HEMI_RADII.x * gyri * depth,
    dir.y * HEMI_RADII.y * gyri * depth - 0.05,
    dir.z * HEMI_RADII.z * gyri * depth,
  );
}

function buildMatter(count: number) {
  const rand = mulberry32(7);
  const target = new Float32Array(count * 3);
  const scatter = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let p: THREE.Vector3;
    const r = rand();
    if (r < 0.09) {
      // Cerebellum: a folded blob under the back of the brain.
      const a = rand() * Math.PI * 2;
      const b = Math.acos(1 - 2 * rand());
      const k = 0.85 + 0.15 * Math.sin(b * 22);
      p = new THREE.Vector3(
        Math.sin(b) * Math.cos(a) * 0.62 * k,
        -0.62 + Math.cos(b) * 0.26 * k,
        -0.82 + Math.sin(b) * Math.sin(a) * 0.36 * k,
      );
    } else if (r < 0.12) {
      // Brain stem.
      const h = rand();
      const a = rand() * Math.PI * 2;
      p = new THREE.Vector3(Math.cos(a) * 0.13, -0.55 - h * 0.65, -0.32 + Math.sin(a) * 0.13 - h * 0.12);
    } else {
      const side: 1 | -1 = rand() < 0.5 ? 1 : -1;
      const inside = rand() < 0.22;
      const depth = inside ? 0.35 + Math.cbrt(rand()) * 0.55 : 0.97 + rand() * 0.06;
      p = hemispherePoint(side, rand(), rand(), depth, inside ? 0.02 : 0.07);
    }
    target.set([p.x, p.y, p.z], i * 3);
    const s = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(4 + rand() * 5);
    scatter.set([s.x, s.y, s.z], i * 3);
    seed[i] = rand();
  }
  return { target, scatter, seed };
}

const MATTER_VERT = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uPixelRatio;
uniform float uSize;
uniform vec4 uWaves[4];
attribute vec3 aScatter;
attribute float aSeed;
varying float vGlow;
varying float vSeed;
void main() {
  float p = clamp(uProgress * 1.3 - aSeed * 0.3, 0.0, 1.0);
  p = 1.0 - pow(1.0 - p, 3.0);
  vec3 pos = mix(aScatter, position, p);
  pos += normalize(position + vec3(0.0001)) * sin(uTime * 0.7 + aSeed * 6.2831) * 0.012;
  float glow = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.w < 0.0) continue;
    float age = uTime - w.w;
    if (age < 0.0 || age > 2.6) continue;
    float d = distance(position, w.xyz);
    glow += exp(-pow((d - age * 1.25) * 6.0, 2.0)) * (1.0 - age / 2.6);
  }
  vGlow = glow;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.7 + 0.3 * sin(uTime * 1.7 + aSeed * 40.0);
  gl_PointSize = uSize * (0.55 + aSeed * 0.9) * twinkle * (1.0 + glow * 2.2) * uPixelRatio / -mv.z;
}
`;

const MATTER_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uWaveColor;
varying float vGlow;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(uColorA, uColorB, vSeed * vSeed);
  col = mix(col, uWaveColor, clamp(vGlow, 0.0, 1.0));
  gl_FragColor = vec4(col, a * (0.32 + vSeed * 0.25 + vGlow * 0.9));
}
`;

// ─── Node layout ────────────────────────────────────────────────────────────

type CosmosNode = RealNode & {
  pos: THREE.Vector3;
  degree: number;
  size: number;
  kind: "hub" | "file" | "memory";
};

function isMemory(n: RealNode): boolean {
  return n.name.startsWith("memory:") || n.name.startsWith("scratch:") || n.tags?.[0] === "memory" || n.tags?.[0] === "scratch";
}

function layoutCosmos(graph: EmployeeGraph): CosmosNode[] {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const files = graph.nodes.filter((n) => !isMemory(n)).sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0));
  const memories = graph.nodes.filter(isMemory);
  const out: CosmosNode[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));

  files.forEach((n, i) => {
    const deg = degree.get(n.name) ?? 0;
    const size = 0.16 + Math.min(n.tokens / 9000, 0.12) + Math.min(deg * 0.012, 0.06);
    if (i === 0) {
      out.push({ ...n, pos: new THREE.Vector3(0, 0.05, 0.1), degree: deg, size: size * 1.35, kind: "hub" });
      return;
    }
    const k = i - 1;
    const m = Math.max(files.length - 1, 1);
    const side: 1 | -1 = k % 2 === 0 ? 1 : -1;
    const t = (Math.floor(k / 2) + 0.5) / Math.ceil(m / 2);
    out.push({
      ...n,
      pos: hemispherePoint(side, (golden * k) / (Math.PI * 2), 0.12 + t * 0.76, 0.74, 0),
      degree: deg,
      size,
      kind: "file",
    });
  });

  // Memories cluster in a deep inner shell (think hippocampus), lower and central.
  memories.forEach((n, i) => {
    const m = Math.max(memories.length, 1);
    const v = (i + 0.5) / m;
    const phi = Math.acos(1 - 2 * v);
    const theta = golden * i;
    out.push({
      ...n,
      pos: new THREE.Vector3(Math.sin(phi) * Math.cos(theta) * 0.62, -0.18 + Math.cos(phi) * 0.32, Math.sin(phi) * Math.sin(theta) * 0.72),
      degree: degree.get(n.name) ?? 0,
      size: 0.1,
      kind: "memory",
    });
  });
  return out;
}

function labelFor(n: CosmosNode, memoryFallback: string): string {
  if (n.kind === "memory") {
    const preview = n.tags?.[1] ?? memoryFallback;
    return preview.length > 28 ? preview.slice(0, 28) + "…" : preview;
  }
  return n.name.replace(/\.md$/, "");
}

/** Shortest hop path hub → target along graph edges (undirected), or null. */
function synapsePath(edges: EmployeeGraph["edges"], from: string, to: string): string[] | null {
  if (from === to) return [from];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from);
  }
  const prev = new Map<string, string>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nx of adj.get(cur) ?? []) {
      if (seen.has(nx)) continue;
      seen.add(nx);
      prev.set(nx, cur);
      if (nx === to) {
        const path = [to];
        let p = to;
        while (prev.has(p)) {
          p = prev.get(p)!;
          path.unshift(p);
        }
        return path.length <= 5 ? path : null;
      }
      queue.push(nx);
    }
  }
  return null;
}

/** An arcing synapse between two points (bows away from the brain's center). */
function synapseCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const bow = mid.length() < 0.05 ? new THREE.Vector3(0, 0.3, 0) : mid.clone().normalize().multiplyScalar(0.22 + a.distanceTo(b) * 0.18);
  return new THREE.QuadraticBezierCurve3(a.clone(), mid.add(bow), b.clone());
}

function glowTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.75)");
  g.addColorStop(0.35, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ─── Scene controller (imperative; React only feeds it graph + state) ───────

type NodeVis = {
  node: CosmosNode;
  halo: THREE.Sprite;
  core: THREE.Mesh;
  pulse: { s: number; heat: number };
  color: THREE.Color;
  label: HTMLDivElement | null;
};

type Controller = {
  setGraph: (graph: EmployeeGraph, layout: CosmosNode[]) => void;
  setState: (state: GraphHighlightState) => void;
  setLabel: (name: string, el: HTMLDivElement | null) => void;
  dispose: () => void;
};

function createController(
  container: HTMLDivElement,
  onOpenFile: (name: string) => void,
  onHover: (name: string | null) => void,
): Controller {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030202, 0.08);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 60);
  camera.position.set(0, 1.4, 9.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 2.2;
  controls.maxDistance = 8;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.22);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const brain = new THREE.Group();
  scene.add(brain);

  // Particle brain matter.
  const MATTER = 7000;
  const matter = buildMatter(MATTER);
  const matterGeo = new THREE.BufferGeometry();
  matterGeo.setAttribute("position", new THREE.BufferAttribute(matter.target, 3));
  matterGeo.setAttribute("aScatter", new THREE.BufferAttribute(matter.scatter, 3));
  matterGeo.setAttribute("aSeed", new THREE.BufferAttribute(matter.seed, 1));
  const waves = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1));
  let waveSlot = 0;
  const matterMat = new THREE.ShaderMaterial({
    vertexShader: MATTER_VERT,
    fragmentShader: MATTER_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uSize: { value: 26 },
      uWaves: { value: waves },
      uColorA: { value: new THREE.Color(C.matterA) },
      uColorB: { value: new THREE.Color(C.matterB) },
      uWaveColor: { value: new THREE.Color(C.wave) },
    },
  });
  brain.add(new THREE.Points(matterGeo, matterMat));

  const tex = glowTexture();
  const disposables: { dispose: () => void }[] = [matterGeo, matterMat, tex];
  const coreGeo = new THREE.SphereGeometry(1, 16, 16);
  disposables.push(coreGeo);

  let nodes = new Map<string, NodeVis>();
  let edgeLines = new Map<string, { line: THREE.Line; mat: THREE.LineBasicMaterial; curve: THREE.QuadraticBezierCurve3 }>();
  let currentGraph: EmployeeGraph = { nodes: [], edges: [] };
  let hubName: string | null = null;
  let prev: GraphHighlightState = { reading: new Set(), cited: new Set(), recentlyTouched: new Set() };
  let current: GraphHighlightState = prev;
  const labels = new Map<string, HTMLDivElement>();
  const transient: THREE.Object3D[] = [];
  const running: { pause: () => unknown }[] = [];
  let hovered: string | null = null;
  let disposed = false;
  const clock = new THREE.Clock();

  function track<T extends { pause: () => unknown }>(a: T): T {
    running.push(a);
    if (running.length > 200) running.splice(0, running.length - 200);
    return a;
  }

  function fireWave(origin: THREE.Vector3) {
    waves[waveSlot].set(origin.x, origin.y, origin.z, matterMat.uniforms.uTime.value as number);
    waveSlot = (waveSlot + 1) % waves.length;
  }

  function edgeKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function clearGraph() {
    for (const v of nodes.values()) {
      brain.remove(v.halo, v.core);
      (v.halo.material as THREE.SpriteMaterial).dispose();
      (v.core.material as THREE.MeshBasicMaterial).dispose();
    }
    for (const e of edgeLines.values()) {
      brain.remove(e.line);
      e.line.geometry.dispose();
      e.mat.dispose();
    }
    nodes = new Map();
    edgeLines = new Map();
  }

  function setGraph(graph: EmployeeGraph, layout: CosmosNode[]) {
    clearGraph();
    currentGraph = graph;
    hubName = layout.find((n) => n.kind === "hub")?.name ?? null;
    layout.forEach((n, i) => {
      const color = new THREE.Color(n.kind === "memory" ? C.memory : C.file);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
      );
      halo.position.copy(n.pos);
      halo.userData.name = n.name;
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xfff6e8, transparent: true, opacity: 0 }));
      core.position.copy(n.pos);
      core.scale.setScalar(n.size * 0.16);
      brain.add(halo, core);
      const vis: NodeVis = { node: n, halo, core, pulse: { s: 0, heat: 0 }, color, label: labels.get(n.name) ?? null };
      nodes.set(n.name, vis);
      // Neurons ignite one after another as the brain assembles.
      track(
        animate(vis.pulse, {
          s: [0, 1],
          duration: 1400,
          delay: 900 + i * 55,
          ease: "outElastic(1, .6)",
        }),
      );
      track(animate(halo.material, { opacity: [0, 1], duration: 900, delay: 900 + i * 55, ease: "outQuad" }));
      track(animate(core.material, { opacity: [0, 0.95], duration: 900, delay: 900 + i * 55, ease: "outQuad" }));
    });
    for (const e of graph.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b) continue;
      const key = edgeKey(e.from, e.to);
      if (edgeLines.has(key)) continue;
      const curve = synapseCurve(a.node.pos, b.node.pos);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
      const mat = new THREE.LineBasicMaterial({ color: C.synapse, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      brain.add(line);
      edgeLines.set(key, { line, mat, curve });
      track(animate(mat, { opacity: [0, 0.16], duration: 1600, delay: 1500, ease: "inOutSine" }));
    }
  }

  /** An impulse running along one synapse; resolves when it lands. */
  function impulse(from: THREE.Vector3, to: THREE.Vector3, key: string | null, opts: { duration: number; strength: number }) {
    return new Promise<void>((resolve) => {
      if (disposed) return resolve();
      const curve = (key && edgeLines.get(key)?.curve) || synapseCurve(from, to);
      const reversed = key ? curve.v0.distanceTo(from) > curve.v2.distanceTo(from) : false;
      const TRAIL = 7;
      const sprites = Array.from({ length: TRAIL }, (_, i) => {
        const s = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: tex,
            color: new THREE.Color(i === 0 ? C.impulse : C.synapse),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: opts.strength * (1 - i / TRAIL),
          }),
        );
        s.scale.setScalar((i === 0 ? 0.22 : 0.15) * (1 - i / (TRAIL + 2)));
        brain.add(s);
        transient.push(s);
        return s;
      });
      const edge = key ? edgeLines.get(key) : undefined;
      if (edge) {
        track(createTimeline().add(edge.mat, { opacity: 0.75 * opts.strength, duration: opts.duration * 0.35, ease: "outQuad" }).add(edge.mat, { opacity: 0.16, duration: 1400, ease: "inOutSine" }));
      }
      const head = { t: 0 };
      track(
        animate(head, {
          t: 1,
          duration: opts.duration,
          ease: "inOutSine",
          onUpdate: () => {
            sprites.forEach((s, i) => {
              const t = Math.min(Math.max(head.t - i * 0.03, 0), 1);
              s.position.copy(curve.getPoint(reversed ? 1 - t : t));
            });
          },
          onComplete: () => {
            for (const s of sprites) {
              brain.remove(s);
              (s.material as THREE.SpriteMaterial).dispose();
              const idx = transient.indexOf(s);
              if (idx >= 0) transient.splice(idx, 1);
            }
            resolve();
          },
        }),
      );
    });
  }

  function bloomNode(vis: NodeVis, strength: number) {
    vis.pulse.heat = Math.max(vis.pulse.heat, strength);
    track(
      createTimeline()
        .add(vis.pulse, { s: 1 + 1.6 * strength, duration: 200, ease: "outQuad" })
        .add(vis.pulse, { s: 1, duration: 1300, ease: "outElastic(1, .4)" }),
    );
    track(animate(vis.pulse, { heat: 0, duration: 2600, delay: 400, ease: "outQuad" }));
  }

  async function thinkTowards(name: string) {
    const target = nodes.get(name);
    if (!target) return;
    const hub = hubName ? nodes.get(hubName) : undefined;
    fireWave(target.node.pos);
    // Draw the camera's attention to the thought, then let it drift again.
    controls.autoRotate = false;
    track(animate(controls.target, { x: target.node.pos.x * 0.35, y: target.node.pos.y * 0.35, z: target.node.pos.z * 0.35, duration: 1600, ease: "outExpo" }));
    window.setTimeout(() => {
      if (!disposed) controls.autoRotate = true;
    }, 4500);
    if (!hub || hub === target) {
      bloomNode(target, 1);
      return;
    }
    const path = synapsePath(currentGraph.edges, hub.node.name, name);
    if (path) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = nodes.get(path[i]);
        const b = nodes.get(path[i + 1]);
        if (!a || !b) break;
        await impulse(a.node.pos, b.node.pos, edgeKey(a.node.name, b.node.name), { duration: 420, strength: 1 });
        if (i < path.length - 2) bloomNode(b, 0.35);
      }
    } else {
      await impulse(hub.node.pos, target.node.pos, null, { duration: 700, strength: 1 });
    }
    bloomNode(target, 1);
  }

  function shockwave(name: string) {
    const vis = nodes.get(name);
    if (!vis) return;
    fireWave(vis.node.pos);
    bloomNode(vis, 1.2);
    for (let k = 0; k < 2; k++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.96, 1, 96),
        new THREE.MeshBasicMaterial({ color: C.cited, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      ring.position.copy(vis.node.pos);
      ring.scale.setScalar(0.05);
      ring.userData.billboard = true;
      brain.add(ring);
      transient.push(ring);
      const s = { v: 0.05 };
      track(
        animate(s, {
          v: 0.9 + k * 0.5,
          duration: 1500 + k * 300,
          delay: k * 180,
          ease: "outExpo",
          onUpdate: () => ring.scale.setScalar(s.v),
        }),
      );
      track(
        animate(ring.material, {
          opacity: 0,
          duration: 1500 + k * 300,
          delay: k * 180,
          ease: "inQuad",
          onComplete: () => {
            brain.remove(ring);
            ring.geometry.dispose();
            (ring.material as THREE.Material).dispose();
            const idx = transient.indexOf(ring);
            if (idx >= 0) transient.splice(idx, 1);
          },
        }),
      );
    }
  }

  function setState(next: GraphHighlightState) {
    current = next;
    for (const name of next.reading) if (!prev.reading.has(name)) void thinkTowards(name);
    for (const name of next.cited) if (!prev.cited.has(name)) shockwave(name);
    prev = { reading: new Set(next.reading), cited: new Set(next.cited), recentlyTouched: new Set(next.recentlyTouched) };
  }

  // Spontaneous, quiet firing so the brain never looks dead.
  const ambient = window.setInterval(() => {
    if (disposed || document.hidden || edgeLines.size === 0) return;
    const keys = [...edgeLines.keys()];
    const key = keys[Math.floor(Math.random() * keys.length)];
    const [a, b] = key.split("|");
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb) return;
    const [from, to] = Math.random() < 0.5 ? [na, nb] : [nb, na];
    void impulse(from.node.pos, to.node.pos, key, { duration: 900, strength: 0.45 }).then(() => bloomNode(to, 0.25));
  }, 1700);

  // Assemble: particles fly in from the void while the camera glides closer.
  track(animate(matterMat.uniforms.uProgress, { value: [0, 1], duration: 2800, ease: "outExpo" }));
  track(animate(camera.position, { x: 2.4, y: 1.25, z: 3.4, duration: 3200, ease: "outExpo" }));

  // Picking.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  function pick(ev: PointerEvent): string | null {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...nodes.values()].map((v) => v.halo), false);
    return (hits[0]?.object.userData.name as string | undefined) ?? null;
  }
  const onMove = (ev: PointerEvent) => {
    const name = pick(ev);
    if (name !== hovered) {
      hovered = name;
      onHover(name);
      renderer.domElement.style.cursor = name ? "pointer" : "grab";
      if (name) {
        const v = nodes.get(name);
        if (v) bloomNode(v, 0.3);
      }
    }
  };
  const onDown = (ev: PointerEvent) => {
    downAt = { x: ev.clientX, y: ev.clientY };
  };
  const onUp = (ev: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y);
    downAt = null;
    if (moved > 5) return;
    const name = pick(ev);
    if (name && !name.startsWith("memory:") && !name.startsWith("scratch:")) onOpenFile(name);
  };
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.style.cursor = "grab";

  function resize() {
    const w = Math.max(container.clientWidth, 1);
    const h = Math.max(container.clientHeight, 1);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Render loop.
  const tmp = new THREE.Vector3();
  const targetColor = new THREE.Color();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const t = clock.getElapsedTime();
    matterMat.uniforms.uTime.value = t;
    controls.update();
    brain.rotation.y = Math.sin(t * 0.07) * 0.04;

    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    for (const v of nodes.values()) {
      const n = v.node;
      const reading = current.reading.has(n.name);
      const cited = current.cited.has(n.name);
      const touched = current.recentlyTouched.has(n.name);
      targetColor.set(cited ? C.cited : reading ? C.fileHigh : touched ? C.touched : n.kind === "memory" ? C.memory : C.file);
      v.color.lerp(targetColor, 0.08);
      (v.halo.material as THREE.SpriteMaterial).color.copy(v.color);
      const breathe = 1 + Math.sin(t * 1.3 + n.pos.x * 5) * 0.06;
      const live = reading ? 1.35 + Math.sin(t * 8) * 0.12 : 1;
      const scale = n.size * v.pulse.s * breathe * live * (1 + v.pulse.heat * 0.4);
      v.halo.scale.setScalar(scale * (n.kind === "memory" ? 1.1 : 1.35));
      v.core.scale.setScalar(Math.max(scale * 0.16, 0.0001));

      // Project the label.
      const el = v.label;
      if (el) {
        tmp.copy(n.pos).applyMatrix4(brain.matrixWorld).project(camera);
        const visible = tmp.z < 1;
        const x = (tmp.x * 0.5 + 0.5) * w;
        const y = (-tmp.y * 0.5 + 0.5) * h;
        const depth = camera.position.distanceTo(tmp.copy(n.pos).applyMatrix4(brain.matrixWorld));
        const strong = reading || cited || hovered === n.name || n.kind === "hub";
        const show = visible && (n.kind !== "memory" || strong || touched);
        const near = THREE.MathUtils.clamp(1.15 - (depth - 3) / 3.2, 0.25, 1);
        el.style.transform = `translate(-50%, -150%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        el.style.opacity = show ? String(strong ? 1 : near * 0.8 * Math.min(v.pulse.s, 1)) : "0";
        el.dataset.strong = strong ? "1" : "0";
      }
    }
    for (const o of transient) {
      if (o.userData.billboard) o.quaternion.copy(camera.quaternion);
    }
    composer.render();
  }
  frame();

  return {
    setGraph,
    setState,
    setLabel(name, el) {
      if (el) labels.set(name, el);
      else labels.delete(name);
      const v = nodes.get(name);
      if (v) v.label = el;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(ambient);
      for (const a of running) a.pause();
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      clearGraph();
      for (const o of transient) brain.remove(o);
      for (const d of disposables) d.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

// ─── React shell ────────────────────────────────────────────────────────────

export function BrainCosmos({ graph, state, onOpenFile, loading }: Props) {
  const { t } = useT();
  const memoryLabel = t("chat.graph.memory");
  const mountRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<Controller | null>(null);
  // Label refs attach before the controller exists; keep them here and hand
  // them over once it does.
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const openRef = useRef(onOpenFile);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    openRef.current = onOpenFile;
  }, [onOpenFile]);

  const layout = useMemo(() => (graph ? layoutCosmos(graph) : []), [graph]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const ctrl = createController(el, (name) => openRef.current(name), setHovered);
    for (const [name, labelEl] of labelEls.current) ctrl.setLabel(name, labelEl);
    ctrlRef.current = ctrl;
    return () => {
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (graph && ctrlRef.current) ctrlRef.current.setGraph(graph, layout);
  }, [graph, layout]);

  useEffect(() => {
    ctrlRef.current?.setState(state);
  }, [state]);

  const hoveredNode = hovered ? layout.find((n) => n.name === hovered) : undefined;

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
        // A literal dark stage in every theme: it's a window into the brain.
        background: `radial-gradient(ellipse 140% 120% at 50% 45%, ${C.bgInner} 0%, ${C.bgOuter} 80%)`,
      }}
    >
      <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />

      {/* Labels, positioned by the render loop. */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {layout.map((n) => (
          <div
            key={n.name}
            ref={(el) => {
              if (el) labelEls.current.set(n.name, el);
              else labelEls.current.delete(n.name);
              ctrlRef.current?.setLabel(n.name, el);
            }}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0,
              whiteSpace: "nowrap",
              fontSize: n.kind === "hub" ? "var(--fs-sm)" : "var(--fs-xs)",
              fontWeight: n.kind === "hub" ? 650 : 500,
              letterSpacing: n.kind === "memory" ? 0 : "0.04em",
              textTransform: n.kind === "memory" ? "none" : "uppercase",
              color: n.kind === "memory" ? "#fff2b8" : "#f6e6cf",
              textShadow: "0 0 12px rgba(0,0,0,0.95), 0 0 3px rgba(0,0,0,0.9)",
              transition: "opacity .35s ease",
              willChange: "transform, opacity",
            }}
          >
            <bdi>{labelFor(n, memoryLabel)}</bdi>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: "var(--sp-16)",
          insetInlineStart: "var(--sp-16)",
          display: "flex",
          flexDirection: "column",
          gap: 5,
          padding: "10px 12px",
          borderRadius: 10,
          background: "rgba(10, 7, 5, 0.6)",
          border: "1px solid rgba(255, 220, 180, 0.12)",
          backdropFilter: "blur(10px)",
          color: "rgba(246, 230, 207, 0.85)",
          fontSize: "var(--fs-2xs)",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.7 }}>{t("chat.graph.title")}</div>
        <Dot color={C.impulse} label={t("chat.graph.reading")} />
        <Dot color={C.cited} label={t("chat.graph.cited")} />
        <Dot color={C.touched} label={t("chat.graph.touched")} />
        <Dot color={C.memory} label={t("chat.graph.working")} />
      </div>

      {/* Stats */}
      {graph && (
        <div
          style={{
            position: "absolute",
            top: "var(--sp-16)",
            insetInlineEnd: "var(--sp-16)",
            display: "flex",
            gap: 14,
            padding: "7px 13px",
            borderRadius: 10,
            background: "rgba(10, 7, 5, 0.6)",
            border: "1px solid rgba(255, 220, 180, 0.12)",
            backdropFilter: "blur(10px)",
            color: "rgba(246, 230, 207, 0.9)",
            fontSize: "var(--fs-2xs)",
            pointerEvents: "none",
          }}
        >
          <span>
            {t("chat.graph.files")} <b>{graph.nodes.length}</b>
          </span>
          <span>
            {t("chat.graph.links")} <b>{graph.edges.length}</b>
          </span>
        </div>
      )}

      {hoveredNode && (
        <div
          style={{
            position: "absolute",
            top: "var(--sp-16)",
            insetInlineStart: "var(--sp-16)",
            maxWidth: 320,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(10, 7, 5, 0.72)",
            border: "1px solid rgba(255, 220, 180, 0.16)",
            backdropFilter: "blur(10px)",
            color: "#f6e6cf",
            fontSize: "var(--fs-xs)",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            <bdi>{labelFor(hoveredNode, memoryLabel)}</bdi>
          </div>
          <div style={{ opacity: 0.65, marginTop: 2 }}>
            {hoveredNode.tokens.toLocaleString()} tokens · {Math.round(hoveredNode.confidence * 100)}%
          </div>
        </div>
      )}

      {(loading || !graph || graph.nodes.length === 0) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "rgba(246, 230, 207, 0.7)",
            fontSize: "var(--fs-sm)",
            pointerEvents: "none",
          }}
        >
          {loading ? t("chat.graph.loading") : t("chat.graph.empty")}
        </div>
      )}
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}` }} />
      <span>{label}</span>
    </div>
  );
}
