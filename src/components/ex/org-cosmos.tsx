"use client";

// Org Cosmos: the organization as a living 3D brain. The company core sits in
// the middle; every twin is a region of light around it, wired to the core by
// synapses. three.js draws the scene; anime.js choreographs what happens
// because the company thinks: impulses from the core to the twins a question
// is routed to, a region igniting while its twin works, sparks for every tool
// it runs, and beams when one twin calls in another. Same dark window and
// palette as BrainCosmos, so the two read as one product.

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { animate } from "animejs";

export type OrgTwin = { id: string; name: string; role: string };

export type OrgCosmosHandle = {
  /** Impulses from the core to each routed twin. */
  route: (ids: string[]) => void;
  /** A twin starts working: its region ignites. */
  activate: (id: string) => void;
  /** A twin finished: its region settles back. */
  settle: (id: string) => void;
  /** A tool call: a spark leaves the twin's region. */
  spark: (id: string) => void;
  /** One twin calls in another. */
  beam: (fromId: string, toId: string) => void;
  /** Everything back to rest. */
  reset: () => void;
};

const PALETTE = ["#ffb36b", "#7fd4ff", "#c79bff", "#7ef0b5", "#ff8fa3", "#ffd86b", "#8fb3ff", "#ffa07a"];
const CORE = "#ffe2b8";
const SYNAPSE = "#ff9d4d";
const IMPULSE = "#b8ecff";

export function twinColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Points filling a ball, denser towards the middle. */
function ball(count: number, radius: number, jitter = 0): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = radius * Math.pow(Math.random(), 0.6);
    const s = Math.sqrt(1 - u * u);
    out[i * 3] = r * s * Math.cos(th) + (Math.random() - 0.5) * jitter;
    out[i * 3 + 1] = r * u * 0.85 + (Math.random() - 0.5) * jitter;
    out[i * 3 + 2] = r * s * Math.sin(th) + (Math.random() - 0.5) * jitter;
  }
  return out;
}

type Region = {
  id: string;
  group: THREE.Group;
  points: THREE.Points;
  mat: THREE.PointsMaterial;
  halo: THREE.Sprite;
  synapse: { line: THREE.Line; mat: THREE.LineBasicMaterial; curve: THREE.QuadraticBezierCurve3 };
  color: THREE.Color;
  state: { heat: number; flash: number; grow: number };
  label: HTMLElement | null;
};

function createScene(container: HTMLDivElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x030202, 0.035);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
  camera.position.set(0, 5.2, 13.5);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minDistance = 4.5;
  controls.maxDistance = 18;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const tex = glowTexture();
  const disposables: { dispose: () => void }[] = [tex];
  const running: { pause: () => unknown }[] = [];
  const track = <T extends { pause: () => unknown }>(a: T): T => {
    running.push(a);
    if (running.length > 300) running.splice(0, running.length - 300);
    return a;
  };

  // Dust: a faint field of stars around the company.
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(ball(1800, 16, 0), 3));
  const dustMat = new THREE.PointsMaterial({ size: 0.05, map: tex, color: 0xc9a27e, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(dustGeo, dustMat));
  disposables.push(dustGeo, dustMat);

  // The company core.
  const coreGroup = new THREE.Group();
  scene.add(coreGroup);
  const coreGeo = new THREE.BufferGeometry();
  coreGeo.setAttribute("position", new THREE.BufferAttribute(ball(2200, 1.05, 0.04), 3));
  const coreMat = new THREE.PointsMaterial({ size: 0.045, map: tex, color: new THREE.Color(CORE), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  coreGroup.add(new THREE.Points(coreGeo, coreMat));
  const coreHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(SYNAPSE), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  coreHalo.scale.setScalar(2.4);
  coreGroup.add(coreHalo);
  disposables.push(coreGeo, coreMat, coreHalo.material);
  const core = { heat: 0 };
  track(animate(coreMat, { opacity: [0, 0.7], duration: 1800, ease: "outQuad" }));
  track(animate(coreHalo.material, { opacity: [0, 0.18], duration: 2200, ease: "outQuad" }));

  let regions = new Map<string, Region>();
  const ringLines: { line: THREE.Line; mat: THREE.LineBasicMaterial }[] = [];
  const transient = new Set<THREE.Object3D>();
  const clock = new THREE.Clock();
  let disposed = false;

  function clearRegions() {
    for (const r of regions.values()) {
      scene.remove(r.group, r.synapse.line);
      r.points.geometry.dispose();
      r.mat.dispose();
      r.halo.material.dispose();
      r.synapse.line.geometry.dispose();
      r.synapse.mat.dispose();
    }
    for (const l of ringLines) {
      scene.remove(l.line);
      l.line.geometry.dispose();
      l.mat.dispose();
    }
    ringLines.length = 0;
    regions = new Map();
  }

  function setTwins(twins: OrgTwin[], labels: Map<string, HTMLElement>) {
    clearRegions();
    const n = Math.max(1, twins.length);
    const radius = n <= 2 ? 3.2 : 3.6 + Math.min(1.6, (n - 3) * 0.25);
    const positions: THREE.Vector3[] = [];
    twins.forEach((twin, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const pos = new THREE.Vector3(Math.cos(a) * radius, Math.sin(i * 1.7) * 0.45, Math.sin(a) * radius);
      positions.push(pos);
      const color = new THREE.Color(twinColor(i));

      const group = new THREE.Group();
      group.position.copy(pos);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(ball(1300, 0.7, 0.02), 3));
      const mat = new THREE.PointsMaterial({ size: 0.04, map: tex, color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
      const points = new THREE.Points(geo, mat);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(1.5);
      group.add(points, halo);
      group.scale.setScalar(0.001);
      scene.add(group);

      // Synapse from the core, arcing up.
      const mid = pos.clone().multiplyScalar(0.5).add(new THREE.Vector3(0, 1.1, 0));
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), mid, pos.clone());
      const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      const lineMat = new THREE.LineBasicMaterial({ color: new THREE.Color(SYNAPSE), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);

      const region: Region = { id: twin.id, group, points, mat, halo, synapse: { line, mat: lineMat, curve }, color, state: { heat: 0, flash: 0, grow: 0 }, label: labels.get(twin.id) ?? null };
      regions.set(twin.id, region);

      // Regions bloom out of the core one after another.
      track(animate(region.state, { grow: [0, 1], duration: 1600, delay: 500 + i * 160, ease: "outElastic(1, .7)" }));
      track(animate(lineMat, { opacity: [0, 0.16], duration: 1400, delay: 700 + i * 160, ease: "inOutSine" }));
    });

    // Faint ring between neighbours: the org is one network.
    positions.forEach((p, i) => {
      const q = positions[(i + 1) % positions.length];
      if (positions.length < 3 && i > 0) return;
      const mid = p.clone().add(q).multiplyScalar(0.5).multiplyScalar(1.12);
      const curve = new THREE.QuadraticBezierCurve3(p, mid, q);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(32));
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(SYNAPSE), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      ringLines.push({ line, mat });
      track(animate(mat, { opacity: [0, 0.06], duration: 1800, delay: 1400, ease: "inOutSine" }));
    });
  }

  function impulse(curve: THREE.Curve<THREE.Vector3>, color: string | THREE.Color, duration: number, size = 0.5, delay = 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(color), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size);
    s.position.copy(curve.getPoint(0));
    scene.add(s);
    transient.add(s);
    const p = { t: 0, o: 0 };
    track(
      animate(p, {
        t: [0, 1],
        o: [0, 1, 1, 0],
        duration,
        delay,
        ease: "inOutSine",
        onUpdate: () => {
          s.position.copy(curve.getPoint(p.t));
          s.material.opacity = p.o;
        },
        onComplete: () => {
          scene.remove(s);
          transient.delete(s);
          s.material.dispose();
        },
      }),
    );
  }

  const handle: OrgCosmosHandle = {
    route(ids) {
      track(animate(core, { heat: [1, 0.25], duration: 1600, ease: "outQuad" }));
      ids.forEach((id, i) => {
        const r = regions.get(id);
        if (!r) return;
        track(animate(r.synapse.mat, { opacity: [0.16, 0.85, 0.4], duration: 1400, delay: i * 140, ease: "outQuad" }));
        for (let k = 0; k < 3; k++) impulse(r.synapse.curve, IMPULSE, 900, 0.55 - k * 0.1, i * 140 + k * 120);
      });
    },
    activate(id) {
      const r = regions.get(id);
      if (!r) return;
      track(animate(r.state, { heat: 1, duration: 900, ease: "outQuad" }));
      track(animate(r.synapse.mat, { opacity: 0.55, duration: 600, ease: "outQuad" }));
    },
    settle(id) {
      const r = regions.get(id);
      if (!r) return;
      track(animate(r.state, { heat: 0.18, duration: 2200, ease: "inOutSine" }));
      track(animate(r.synapse.mat, { opacity: 0.22, duration: 2200, ease: "inOutSine" }));
      // The answer travels back to the core.
      const back = new THREE.QuadraticBezierCurve3(r.synapse.curve.v2, r.synapse.curve.v1, r.synapse.curve.v0);
      impulse(back, r.color, 1100, 0.6);
      track(animate(core, { heat: [0.9, 0.2], duration: 1800, delay: 1000, ease: "outQuad" }));
    },
    spark(id) {
      const r = regions.get(id);
      if (!r) return;
      track(animate(r.state, { flash: [1, 0], duration: 700, ease: "outQuad" }));
      const from = r.group.position.clone();
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
      const to = from.clone().add(dir.multiplyScalar(1.6));
      const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 0.4, 0));
      impulse(new THREE.QuadraticBezierCurve3(from, mid, to), r.color, 800, 0.35);
    },
    beam(fromId, toId) {
      const a = regions.get(fromId);
      const b = regions.get(toId);
      if (!a || !b) return;
      const mid = a.group.position.clone().add(b.group.position).multiplyScalar(0.3).add(new THREE.Vector3(0, 1.6, 0));
      const curve = new THREE.QuadraticBezierCurve3(a.group.position.clone(), mid, b.group.position.clone());
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      const mat = new THREE.LineBasicMaterial({ color: a.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      transient.add(line);
      track(
        animate(mat, {
          opacity: [0, 0.9, 0],
          duration: 2600,
          ease: "inOutSine",
          onComplete: () => {
            scene.remove(line);
            transient.delete(line);
            geo.dispose();
            mat.dispose();
          },
        }),
      );
      for (let k = 0; k < 4; k++) impulse(curve, k % 2 ? b.color : IMPULSE, 1100, 0.5, k * 160);
    },
    reset() {
      for (const r of regions.values()) {
        track(animate(r.state, { heat: 0, flash: 0, duration: 900, ease: "outQuad" }));
        track(animate(r.synapse.mat, { opacity: 0.16, duration: 900, ease: "outQuad" }));
      }
    },
  };

  const v = new THREE.Vector3();
  let raf = 0;
  let w = 0;
  let h = 0;
  function frame() {
    if (disposed) return;
    const t = clock.getElapsedTime();
    controls.update();
    coreGroup.rotation.y = t * 0.08;
    const cBreath = 1 + Math.sin(t * 1.3) * 0.03 + core.heat * 0.18;
    coreGroup.scale.setScalar(cBreath);
    coreMat.size = 0.045 + core.heat * 0.03;
    coreHalo.material.opacity = 0.14 + core.heat * 0.4;

    for (const r of regions.values()) {
      const { heat, flash, grow } = r.state;
      const breath = Math.sin(t * (1.1 + heat * 3) + r.group.position.x) * (0.025 + heat * 0.05);
      r.group.scale.setScalar(Math.max(0.001, grow * (1 + breath + heat * 0.22 + flash * 0.12)));
      r.points.rotation.y = t * (0.12 + heat * 0.9);
      r.mat.size = 0.04 + heat * 0.03 + flash * 0.025;
      r.mat.opacity = 0.42 + heat * 0.5;
      r.halo.material.opacity = 0.08 + heat * 0.42 + flash * 0.25;
      if (r.label && w > 0) {
        v.copy(r.group.position);
        v.y += 1.15;
        v.project(camera);
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h;
        const behind = v.z > 1;
        r.label.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        r.label.style.opacity = behind || grow < 0.6 ? "0" : String(Math.min(1, 0.45 + (1 - v.z) * 6));
        r.label.style.zIndex = String(Math.round((1 - v.z) * 1000));
      }
    }
    composer.render();
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    w = container.clientWidth;
    h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  raf = requestAnimationFrame(frame);

  return {
    handle,
    setTwins,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const a of running) a.pause();
      for (const o of transient) scene.remove(o);
      clearRegions();
      controls.dispose();
      for (const d of disposables) d.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * The organization brain. `labels` are the HTML labels the page renders for
 * each twin; the scene positions them over their regions every frame.
 */
export function OrgCosmos({
  twins,
  labels,
  controlRef,
}: {
  twins: OrgTwin[];
  labels: RefObject<Map<string, HTMLElement>>;
  controlRef: RefObject<OrgCosmosHandle | null>;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null);
  const key = twins.map((t) => t.id).join("|");

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const s = createScene(el);
    sceneRef.current = s;
    controlRef.current = s.handle;
    return () => {
      controlRef.current = null;
      sceneRef.current = null;
      s.dispose();
    };
  }, [controlRef]);

  useEffect(() => {
    sceneRef.current?.setTwins(twins, labels.current);
    // Rebuild only when the set of twins changes, not on every roster object refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={mountRef} style={{ position: "absolute", inset: 0 }} />;
}
