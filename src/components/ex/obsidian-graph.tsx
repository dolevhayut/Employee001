"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import type { EmployeeGraph, RealNode } from "@/lib/profile-graph-real";

export type GraphHighlightState = {
  reading: Set<string>;
  recentlyTouched: Set<string>;
  cited: Set<string>;
};

type Props = {
  graph: EmployeeGraph | null;
  state: GraphHighlightState;
  onOpenFile: (name: string) => void;
  loading?: boolean;
};

type LaidOutNode = RealNode & {
  // 3D position in unit-sphere space (-1..1)
  x: number;
  y: number;
  z: number;
  degree: number;
  r: number; // base node radius in projected px (pre-scale)
};

const LAYOUT_SIZE = 800;
const CENTER = LAYOUT_SIZE / 2;
const SPHERE_RADIUS = 280; // 3D sphere radius in layout units
const PERSPECTIVE = 700;   // smaller = stronger fish-eye
const HUB_DEPTH_BOOST = 1.3;

// ─── Theme detection ─────────────────────────────────────────────────────────

function isDarkTheme(): boolean {
  if (typeof window === "undefined") return true;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light" || attr === "cool") return false;
  // data-theme not set yet — check localStorage before falling back to OS
  try {
    const stored = localStorage.getItem("em001-theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
  } catch {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function useThemeIsDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" ? isDarkTheme() : true
  );
  useEffect(() => {
    setDark(isDarkTheme());
    const obs = new MutationObserver(() => setDark(isDarkTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => setDark(isDarkTheme());
    mq.addEventListener("change", onMq);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);
  return dark;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

// Fibonacci sphere — distributes nodes evenly on a 3D sphere surface.
// Hub stays at center (z biased toward viewer), others spread across sphere.
function layoutNodes(graph: EmployeeGraph): LaidOutNode[] {
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const sorted = [...graph.nodes].sort(
    (a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0)
  );

  const result: LaidOutNode[] = [];
  const n = sorted.length;
  if (n === 0) return result;

  // Hub: positioned slightly forward (positive z) so it pops toward camera
  const hub = sorted[0];
  result.push({
    ...hub,
    x: 0,
    y: 0,
    z: SPHERE_RADIUS * 0.15,
    degree: degree.get(hub.name) ?? 0,
    r: nodeRadiusFor(hub, degree.get(hub.name) ?? 0) * HUB_DEPTH_BOOST,
  });

  // Remaining nodes on a Fibonacci sphere
  const m = n - 1;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < m; i++) {
    const t = m === 1 ? 0.5 : i / (m - 1);
    const phi = Math.acos(1 - 2 * t); // 0..π
    const theta = goldenAngle * i;
    const sx = Math.sin(phi) * Math.cos(theta);
    const sy = Math.sin(phi) * Math.sin(theta);
    const sz = Math.cos(phi);
    const node = sorted[i + 1];
    const deg = degree.get(node.name) ?? 0;
    result.push({
      ...node,
      x: sx * SPHERE_RADIUS,
      y: sy * SPHERE_RADIUS,
      z: sz * SPHERE_RADIUS,
      degree: deg,
      r: nodeRadiusFor(node, deg),
    });
  }

  return result;
}

function nodeRadiusFor(node: RealNode, degree: number): number {
  const base = 10 + Math.min(node.tokens / 600, 10);
  const bonus = Math.min(degree * 1.2, 4);
  return base + bonus;
}

function labelFor(node: LaidOutNode): string {
  if (node.name.startsWith("scratch:")) {
    const fname = node.name.slice("scratch:".length).replace(/\.md$/, "");
    return fname.length > 22 ? `📝 ${fname.slice(0, 22)}…` : `📝 ${fname}`;
  }
  if (node.name.startsWith("memory:")) {
    const preview = node.tags?.[1] ?? "memory";
    return preview.length > 26 ? preview.slice(0, 26) + "…" : preview;
  }
  return node.name.replace(/\.md$/, "");
}

// Theme-aware base colors for nodes (returns hex for canvas use).
function baseNodeColor(node: LaidOutNode, dark: boolean): string {
  if (node.tags?.[0] === "scratch") return "#fde36b";
  if (node.tags?.[0] === "memory") return "#f7d04a";
  if (dark) {
    if (node.confidence >= 0.85) return "#d4a574";
    if (node.confidence >= 0.7) return "#b89070";
    return "#9e7e64";
  }
  if (node.confidence >= 0.85) return "#9E6B47";
  if (node.confidence >= 0.7) return "#B89070";
  return "#C4A98A";
}

// State color overrides (reading > cited > recentlyTouched > base).
function nodeFill(
  node: LaidOutNode,
  state: GraphHighlightState,
  dark: boolean,
  accent: { soft: string; mid: string; deep: string }
): string {
  if (state.reading.has(node.name)) return accent.mid;
  if (state.cited.has(node.name)) return accent.deep;
  if (state.recentlyTouched.has(node.name)) return accent.soft;
  return baseNodeColor(node, dark);
}

// ─── Shader background ──────────────────────────────────────────────────────

const VERT_SHADER = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG_SHADER = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dark;

// Hash + noise primitives
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  float t = u_time * 0.04;

  // Domain-warped fbm for organic nebula / texture
  vec2 q = vec2(fbm(uv * 1.4 + t), fbm(uv * 1.4 - t * 0.7));
  vec2 r = vec2(
    fbm(uv * 2.0 + q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(uv * 2.0 + q + vec2(8.3, 2.8) + 0.13 * t)
  );
  float f = fbm(uv * 1.7 + r);

  // Dark: deep warm brown nebula with amber highlights
  vec3 darkLow  = vec3(0.050, 0.035, 0.020);
  vec3 darkHigh = vec3(0.160, 0.095, 0.045);
  vec3 darkAccent = vec3(0.48, 0.28, 0.10) * smoothstep(0.55, 0.95, f);
  vec3 darkCol = mix(darkLow, darkHigh, clamp(f * 1.5, 0.0, 1.0)) + darkAccent * 0.38;

  // Light: warm cream paper texture (very subtle)
  vec3 lightLow  = vec3(0.961, 0.945, 0.918);
  vec3 lightHigh = vec3(0.933, 0.910, 0.870);
  vec3 lightCol = mix(lightLow, lightHigh, f * 0.45);

  // Vignette — gentle, theme-aware
  float vig = smoothstep(1.1, 0.25, length(uv));
  vec3 col = mix(lightCol, darkCol, u_dark);
  col *= mix(0.94, 1.0, vig);

  fragColor = vec4(col, 1.0);
}
`;

function ShaderBackground({ isDark }: { isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(isDark);
  darkRef.current = isDark;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("shader err", gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT_SHADER));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG_SHADER));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uDark = gl.getUniformLocation(prog, "u_dark");

    let darkBlend = darkRef.current ? 1.0 : 0.0;
    let raf = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const tick = () => {
      const targetDark = darkRef.current ? 1.0 : 0.0;
      darkBlend += (targetDark - darkBlend) * 0.08;
      const t = (performance.now() - start) / 1000;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uDark, darkBlend);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}

// ─── Ambient 3D neuron field (background filaments) ──────────────────────────

type Particle = { x: number; y: number; z: number };

function AmbientNeurons({ isDark }: { isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const darkRef = useRef(isDark);
  darkRef.current = isDark;

  // Stable random particles — generated once
  const particlesRef = useRef<Particle[]>([]);
  if (particlesRef.current.length === 0) {
    const N = 140;
    const rand = mulberry32(0xa17e); // deterministic so SSR/hydration match
    for (let i = 0; i < N; i++) {
      particlesRef.current.push({
        x: (rand() - 0.5) * 1200,
        y: (rand() - 0.5) * 1200,
        z: (rand() - 0.5) * 800,
      });
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastT = performance.now();
    let autoRot = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      autoRot += dt * 0.05;
      const t = (now - start) / 1000;

      const dark = darkRef.current;
      const lineCol = dark ? "rgba(232, 198, 144," : "rgba(106, 69, 40,";
      const dotCol = dark ? "rgba(245, 220, 175," : "rgba(80, 50, 28,";

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;
      const screenScale = Math.min(canvas.width, canvas.height) / 1400;

      const cosY = Math.cos(autoRot);
      const sinY = Math.sin(autoRot);

      // Project all particles
      const particles = particlesRef.current;
      const proj: { px: number; py: number; pz: number; scale: number; idx: number }[] = [];
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        // Drift each neuron along a small lissajous loop so the field breathes
        const dx = Math.sin(t * 0.3 + i * 0.7) * 8;
        const dy = Math.cos(t * 0.27 + i * 1.3) * 8;
        const x = p.x + dx;
        const y = p.y + dy;
        const z = p.z;
        // Y rotation
        const x1 = x * cosY - z * sinY;
        const z1 = z * cosY + x * sinY;
        const persp = 900 / (900 + z1);
        proj.push({
          px: cx + x1 * persp * screenScale,
          py: cy + y * persp * screenScale,
          pz: z1,
          scale: persp,
          idx: i,
        });
      }

      // Connect nearby neurons with thin filaments
      ctx.lineCap = "round";
      const maxDist = 110 * dpr;
      for (let i = 0; i < proj.length; i++) {
        for (let j = i + 1; j < proj.length; j++) {
          const a = proj[i];
          const b = proj[j];
          const ddx = a.px - b.px;
          const ddy = a.py - b.py;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 > maxDist * maxDist) continue;
          const d = Math.sqrt(d2);
          const closeness = 1 - d / maxDist;
          const depth = (a.scale + b.scale) * 0.5;
          const alpha = closeness * closeness * 0.18 * depth;
          if (alpha < 0.012) continue;
          ctx.strokeStyle = lineCol + alpha.toFixed(3) + ")";
          ctx.lineWidth = 0.6 * dpr;
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
        }
      }

      // Tiny neuron dots
      for (const p of proj) {
        const a = 0.18 * p.scale;
        ctx.fillStyle = dotCol + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(p.px, p.py, 1.2 * p.scale * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
        opacity: 0.9,
      }}
    />
  );
}

// Tiny seedable PRNG so the neuron positions are stable across renders
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = s;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Canvas 2D neural-brain layer ────────────────────────────────────────────

type Projected = { px: number; py: number; pz: number; scale: number };

type Synapse = {
  edgeIdx: number;
  progress: number;   // 0..1
  speed: number;      // per-second
  intensity: number;  // 0..1 — fades out
};

type GraphCanvasProps = {
  graph: EmployeeGraph;
  layout: LaidOutNode[];
  state: GraphHighlightState;
  isDark: boolean;
  zoom: number;
  hoveredNode: string | null;
  onHover: (name: string | null) => void;
  onClick: (name: string) => void;
};

function GraphCanvas({
  graph,
  layout,
  state,
  isDark,
  zoom,
  hoveredNode,
  onHover,
  onClick,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  const layoutRef = useRef(layout);
  const graphRef = useRef(graph);
  const hoverRef = useRef(hoveredNode);
  const zoomRef = useRef(zoom);
  const darkRef = useRef(isDark);

  stateRef.current = state;
  layoutRef.current = layout;
  graphRef.current = graph;
  hoverRef.current = hoveredNode;
  zoomRef.current = zoom;
  darkRef.current = isDark;

  const nodeMap = useMemo(() => {
    const m = new Map<string, LaidOutNode>();
    for (const n of layout) m.set(n.name, n);
    return m;
  }, [layout]);
  const nodeMapRef = useRef(nodeMap);
  nodeMapRef.current = nodeMap;

  // Mouse position for parallax rotation (in canvas-local px)
  const mouseRef = useRef({ x: 0, y: 0, hasMoved: false });
  // Projected positions per node, refreshed each frame; used for hit-testing
  const projRef = useRef<Map<string, Projected>>(new Map());
  // Active synaptic pulses
  const synapsesRef = useRef<Synapse[]>([]);
  // Last hit-test result for hover (synced via onHover prop)

  const hitTestProjected = useCallback(
    (clientX: number, clientY: number): string | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = (clientX - rect.left) * dpr;
      const py = (clientY - rect.top) * dpr;
      const proj = projRef.current;
      const nodes = layoutRef.current;
      // Iterate front-to-back: largest pz first (closest to camera)
      const sorted = [...nodes].sort((a, b) => {
        const pa = proj.get(a.name);
        const pb = proj.get(b.name);
        return (pb?.pz ?? 0) - (pa?.pz ?? 0);
      });
      for (const n of sorted) {
        const p = proj.get(n.name);
        if (!p) continue;
        const dx = p.px - px;
        const dy = p.py - py;
        const hitR = (n.r + 4) * p.scale * dpr;
        if (dx * dx + dy * dy <= hitR * hitR) return n.name;
      }
      return null;
    },
    []
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let lastT = performance.now();
    let autoRot = 0; // accumulated auto Y rotation
    let mouseRotX = 0; // smoothed
    let mouseRotY = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dark = darkRef.current;
      const z = zoomRef.current;
      const s = stateRef.current;
      const layoutNow = layoutRef.current;
      const graphNow = graphRef.current;
      const hovered = hoverRef.current;
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      const t = (now - start) / 1000;

      // Slow auto-rotation, plus mouse parallax
      autoRot += dt * 0.15;
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;
      const targetRotY =
        ((mouseRef.current.x * dpr - cx) / canvas.width) * 0.8;
      const targetRotX =
        ((mouseRef.current.y * dpr - cy) / canvas.height) * 0.5;
      mouseRotX += (targetRotX - mouseRotX) * 0.08;
      mouseRotY += (targetRotY - mouseRotY) * 0.08;
      const rotY = autoRot + mouseRotY;
      const rotX = mouseRotX;
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      // Theme-derived colors
      const accent = dark
        ? { soft: "#b89880", mid: "#e8c690", deep: "#f5d8a8" }
        : { soft: "#C4A98A", mid: "#9E6B47", deep: "#7a4d2e" };
      const synapseCol = dark ? "rgba(255, 240, 215, 1)" : "rgba(60, 35, 18, 1)";
      const edgeBase = dark ? "rgba(220, 200, 170, " : "rgba(80, 50, 30, ";
      const edgeReading = dark ? "rgba(245, 216, 168, " : "rgba(158, 107, 71, ";
      const labelMuted = dark ? "rgba(232, 220, 200, 0.85)" : "rgba(40, 30, 20, 0.75)";
      const labelStrong = dark ? "rgba(252, 245, 225, 1)" : "rgba(20, 15, 10, 0.98)";
      const labelStroke = dark ? "rgba(0, 0, 0, 0.85)" : "rgba(255, 252, 245, 0.9)";

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Project every node from 3D layout-space → 2D pixel-space
      const proj = projRef.current;
      proj.clear();
      const screenScale = (Math.min(w, h) / LAYOUT_SIZE) * z * dpr;
      const screenCx = w * dpr * 0.5;
      const screenCy = h * dpr * 0.5;
      for (const n of layoutNow) {
        // Rotate around Y, then X
        const x1 = n.x * cosY - n.z * sinY;
        const z1 = n.z * cosY + n.x * sinY;
        const y1 = n.y * cosX - z1 * sinX;
        const z2 = z1 * cosX + n.y * sinX;
        // Perspective
        const persp = PERSPECTIVE / (PERSPECTIVE + z2);
        const scale = persp;
        const px = screenCx + x1 * scale * screenScale;
        const py = screenCy + y1 * scale * screenScale;
        proj.set(n.name, { px, py, pz: z2, scale });
      }

      // Build neighbor mask if hovered
      let neighborSet: Set<string> | null = null;
      if (hovered) {
        neighborSet = new Set([hovered]);
        for (const e of graphNow.edges) {
          if (e.from === hovered) neighborSet.add(e.to);
          if (e.to === hovered) neighborSet.add(e.from);
        }
      }

      // Spawn pulses: persistent on reading edges, occasional spontaneous on others
      const readingEdgeIdx: number[] = [];
      for (let i = 0; i < graphNow.edges.length; i++) {
        const e = graphNow.edges[i];
        if (s.reading.has(e.from) || s.reading.has(e.to)) readingEdgeIdx.push(i);
      }
      // Maintain pulses per reading edge (one in flight per edge if missing)
      for (const idx of readingEdgeIdx) {
        const exists = synapsesRef.current.some((p) => p.edgeIdx === idx);
        if (!exists) {
          synapsesRef.current.push({
            edgeIdx: idx,
            progress: 0,
            speed: 0.5 + Math.random() * 0.3,
            intensity: 1,
          });
        }
      }
      // Ambient firing — random edge gets a pulse occasionally
      if (Math.random() < dt * 0.7 && graphNow.edges.length > 0) {
        const idx = Math.floor(Math.random() * graphNow.edges.length);
        synapsesRef.current.push({
          edgeIdx: idx,
          progress: 0,
          speed: 0.4 + Math.random() * 0.5,
          intensity: 0.7,
        });
      }

      // ── EDGES (drawn behind nodes) ────────────────────────────────────────
      ctx.lineCap = "round";
      for (let i = 0; i < graphNow.edges.length; i++) {
        const e = graphNow.edges[i];
        const a = nodeMapRef.current.get(e.from);
        const b = nodeMapRef.current.get(e.to);
        if (!a || !b) continue;
        const pa = proj.get(e.from);
        const pb = proj.get(e.to);
        if (!pa || !pb) continue;

        const isReading = s.reading.has(e.from) || s.reading.has(e.to);
        const isActive = !neighborSet || (neighborSet.has(e.from) && neighborSet.has(e.to));

        // Depth-based alpha so back edges fade gracefully
        const depthA = (pa.scale + pb.scale) * 0.5;
        const baseAlpha = (isReading ? 0.85 : 0.35) * depthA;
        const alpha = isActive ? baseAlpha : baseAlpha * 0.18;

        // Slight curve via midpoint perpendicular offset (keeps them dendritic, not too straight)
        const mx = (pa.px + pb.px) * 0.5;
        const my = (pa.py + pb.py) * 0.5;
        const dx = pb.px - pa.px;
        const dy = pb.py - pa.py;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const bow = Math.min(40, len * 0.08) * dpr;
        const cmx = mx + nx * bow;
        const cmy = my + ny * bow;

        ctx.strokeStyle =
          (isReading ? edgeReading : edgeBase) + alpha.toFixed(3) + ")";
        ctx.lineWidth = (isReading ? 1.6 : 0.9) * dpr;
        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.quadraticCurveTo(cmx, cmy, pb.px, pb.py);
        ctx.stroke();
      }

      // ── SYNAPSES (traveling pulses) ────────────────────────────────────────
      const stillAlive: Synapse[] = [];
      for (const pulse of synapsesRef.current) {
        const e = graphNow.edges[pulse.edgeIdx];
        if (!e) continue;
        const pa = proj.get(e.from);
        const pb = proj.get(e.to);
        if (!pa || !pb) continue;
        pulse.progress += dt * pulse.speed;
        if (pulse.progress >= 1) continue; // expire

        const u = pulse.progress;
        const mx = (pa.px + pb.px) * 0.5;
        const my = (pa.py + pb.py) * 0.5;
        const dx = pb.px - pa.px;
        const dy = pb.py - pa.py;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const bow = Math.min(40, len * 0.08) * dpr;
        const cmx = mx + nx * bow;
        const cmy = my + ny * bow;
        // Quadratic bezier sample
        const oneU = 1 - u;
        const sx = oneU * oneU * pa.px + 2 * oneU * u * cmx + u * u * pb.px;
        const sy = oneU * oneU * pa.py + 2 * oneU * u * cmy + u * u * pb.py;
        const sScale = pa.scale * (1 - u) + pb.scale * u;

        // Trail
        const trailSteps = 6;
        for (let k = trailSteps; k >= 1; k--) {
          const tu = Math.max(0, u - k * 0.025);
          const oneTu = 1 - tu;
          const tx = oneTu * oneTu * pa.px + 2 * oneTu * tu * cmx + tu * tu * pb.px;
          const ty = oneTu * oneTu * pa.py + 2 * oneTu * tu * cmy + tu * tu * pb.py;
          const a = ((trailSteps - k) / trailSteps) * pulse.intensity * 0.35;
          ctx.globalAlpha = a;
          ctx.fillStyle = synapseCol;
          ctx.beginPath();
          ctx.arc(tx, ty, 2.4 * sScale * dpr, 0, Math.PI * 2);
          ctx.fill();
        }

        // Head — bright synapse with glow
        ctx.globalAlpha = pulse.intensity;
        ctx.shadowBlur = 14 * sScale * dpr;
        ctx.shadowColor = synapseCol;
        ctx.fillStyle = synapseCol;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.2 * sScale * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        stillAlive.push(pulse);
      }
      synapsesRef.current = stillAlive;

      // ── NODES (back-to-front for proper occlusion) ────────────────────────
      const sortedByDepth = [...layoutNow].sort((A, B) => {
        const pa = proj.get(A.name)?.pz ?? 0;
        const pb = proj.get(B.name)?.pz ?? 0;
        return pb - pa; // far first
      });

      for (const n of sortedByDepth) {
        const p = proj.get(n.name);
        if (!p) continue;
        const isReading = s.reading.has(n.name);
        const isCited = s.cited.has(n.name);
        const isHovered = hovered === n.name;
        const isActive = !neighborSet || neighborSet.has(n.name);
        const fill = nodeFill(n, s, dark, accent);
        const r = n.r * p.scale * dpr;

        ctx.globalAlpha = isActive ? 1 : 0.22;

        // Bloom halo
        const haloR = r * (isReading ? 3.4 : isCited || isHovered ? 2.6 : 2.0);
        const grad = ctx.createRadialGradient(p.px, p.py, r * 0.5, p.px, p.py, haloR);
        grad.addColorStop(0, hexToRgba(fill, isReading ? 0.6 : 0.34));
        grad.addColorStop(1, hexToRgba(fill, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.px, p.py, haloR, 0, Math.PI * 2);
        ctx.fill();

        // Reading expanding ring
        if (isReading) {
          const phase = (t % 1.4) / 1.4;
          ctx.globalAlpha = (1 - phase) * 0.85 * (isActive ? 1 : 0.22);
          ctx.strokeStyle = accent.mid;
          ctx.lineWidth = 1.8 * dpr;
          ctx.beginPath();
          ctx.arc(p.px, p.py, r + 4 * dpr + phase * 18 * dpr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = isActive ? 1 : 0.22;
        }

        // Cited static ring
        if (isCited && !isReading) {
          ctx.strokeStyle = accent.deep;
          ctx.lineWidth = 1.8 * dpr;
          ctx.beginPath();
          ctx.arc(p.px, p.py, r + 4 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Hover ring
        if (isHovered) {
          ctx.strokeStyle = dark ? "rgba(255,250,235,0.55)" : "rgba(20,15,10,0.55)";
          ctx.lineWidth = 1.4 * dpr;
          ctx.beginPath();
          ctx.arc(p.px, p.py, r + 7 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Neuron body with glow
        ctx.shadowBlur = (isReading || isHovered ? 22 : 10) * dpr;
        ctx.shadowColor = fill;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;

      // ── LABELS (top of stack) ─────────────────────────────────────────────
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (const n of layoutNow) {
        const p = proj.get(n.name);
        if (!p) continue;
        const isHovered = hovered === n.name;
        const isReading = s.reading.has(n.name);
        const isCited = s.cited.has(n.name);
        const isActive = !neighborSet || neighborSet.has(n.name);
        const strong = isHovered || isReading || isCited;
        // Hide labels for very far-back nodes unless strong
        const depthFade = Math.max(0, (p.scale - 0.55) / 0.45);
        if (!strong && depthFade < 0.1) continue;
        // Scale labels with canvas zoom — clamped so they never shrink below
        // a readable floor when zooming out, and grow linearly when zooming in.
        const zoomFactor = Math.max(1, 0.65 + 0.5 * z); // z=0.7→1, z=1→1.15, z=2→1.65, z=3→2.15
        const size = (isHovered ? 13 : 11.5) * dpr * Math.max(0.8, p.scale) * zoomFactor;
        const r = n.r * p.scale * dpr;

        ctx.globalAlpha = (isActive ? 1 : 0.35) * (strong ? 1 : depthFade);
        // Canvas font strings can't use CSS variables — they silently fail and keep the previous font
        ctx.font = `${strong ? 700 : 600} ${size}px "Stack Sans Notch", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        const text = labelFor(n);

        // Stronger halo so labels read clearly against any background — scales with text size
        ctx.lineWidth = Math.max(4, size * 0.18) * 0.7;
        ctx.strokeStyle = labelStroke;
        ctx.strokeText(text, p.px, p.py + r + 6 * dpr);
        ctx.fillStyle = strong ? labelStrong : labelMuted;
        ctx.fillText(text, p.px, p.py + r + 6 * dpr);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Pointer events
  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        mouseRef.current.x = e.clientX - rect.left;
        mouseRef.current.y = e.clientY - rect.top;
        mouseRef.current.hasMoved = true;
      }
      const name = hitTestProjected(e.clientX, e.clientY);
      if (name !== hoverRef.current) onHover(name);
    },
    [hitTestProjected, onHover]
  );
  const onMouseLeave = useCallback(() => {
    mouseRef.current.hasMoved = false;
    onHover(null);
  }, [onHover]);
  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const name = hitTestProjected(e.clientX, e.clientY);
      if (name) onClick(name);
    },
    [hitTestProjected, onClick]
  );

  return (
    <canvas
      ref={canvasRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onCanvasClick}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        cursor: hoveredNode ? "pointer" : "default",
      }}
    />
  );
}

// hex (#rgb / #rrggbb) → rgba(...)
function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith("#")) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Main component ─────────────────────────────────────────────────────────

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.12;

export function ObsidianGraph({ graph, state, onOpenFile, loading }: Props) {
  const isDark = useThemeIsDark();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => (graph ? layoutNodes(graph) : []), [graph]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-graph-zoom-skip]")) return;
      const r = el.getBoundingClientRect();
      const inside =
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      if (!inside) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 1 + ZOOM_STEP : 1 - ZOOM_STEP;
      setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * delta)));
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () =>
      window.removeEventListener("wheel", onWheel, {
        capture: true,
      } as EventListenerOptions);
  }, []);

  const zoomBy = (factor: number) =>
    setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor)));
  const zoomReset = () => setZoom(1);

  useEffect(() => {
    setZoom(1);
  }, [graph]);

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--text-subtle)",
          fontSize: "var(--fs-ui)",
          background: "var(--bg)",
        }}
      >
        <span style={{ animation: "pulse 1.6s ease-in-out infinite" }}>
          Loading memory graph…
        </span>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--text-subtle)",
          fontSize: "var(--fs-ui)",
          background: "var(--bg)",
        }}
      >
        No profile files found.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        flex: "1 1 0",
        minHeight: 0,
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <ShaderBackground isDark={isDark} />
      <AmbientNeurons isDark={isDark} />
      <GraphCanvas
        graph={graph}
        layout={layout}
        state={state}
        isDark={isDark}
        zoom={zoom}
        hoveredNode={hoveredNode}
        onHover={setHoveredNode}
        onClick={onOpenFile}
      />

      {/* Legend */}
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          display: "flex",
          flexDirection: "column",
          gap: 5,
          padding: "9px 11px",
          background: "color-mix(in oklch, var(--bg-elevated) 80%, transparent)",
          border: "1px solid var(--hairline)",
          borderRadius: 8,
          fontSize: "var(--fs-meta)",
          color: "var(--text-muted)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: "var(--fs-2xs)",
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-subtle)",
            marginBottom: 1,
          }}
        >
          Memory Graph
        </div>
        <LegendDot
          color={isDark ? "#e8c690" : "#9E6B47"}
          label="Reading now"
          pulse
        />
        <LegendDot
          color={isDark ? "#f5d8a8" : "#7a4d2e"}
          label="Cited in answer"
        />
        <LegendDot
          color={isDark ? "#b89880" : "#C4A98A"}
          label="Recently touched"
        />
        <LegendDot color="#fde36b" label="Working memory" />
      </div>

      {/* Zoom + stats */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "7px 13px",
          background: "color-mix(in oklch, var(--bg-elevated) 80%, transparent)",
          border: "1px solid var(--hairline)",
          borderRadius: 8,
          fontSize: "var(--fs-meta)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        <StatChip label="Files" value={graph.nodes.length} />
        <StatChip label="Links" value={graph.edges.length} />
        <div
          style={{
            width: 1,
            height: 24,
            background: "var(--hairline)",
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ZoomBtn label="−" onClick={() => zoomBy(1 / (1 + ZOOM_STEP * 2))} />
          <button
            onClick={zoomReset}
            title="Reset zoom"
            style={{
              minWidth: 42,
              padding: "3px 6px",
              fontSize: "var(--fs-xs)",
              fontVariantNumeric: "tabular-nums",
              background: "transparent",
              border: "1px solid var(--hairline)",
              borderRadius: 4,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            {Math.round(zoom * 100)}%
          </button>
          <ZoomBtn label="+" onClick={() => zoomBy(1 + ZOOM_STEP * 2)} />
        </div>
      </div>
    </div>
  );
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 24,
        height: 24,
        display: "grid",
        placeItems: "center",
        background: "transparent",
        border: "1px solid var(--hairline)",
        borderRadius: 4,
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: "var(--fs-base)",
        lineHeight: 1,
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}

function LegendDot({
  color,
  label,
  pulse,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          boxShadow: `0 0 8px ${color}`,
          animation: pulse ? "graph-pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      <span>{label}</span>
      <style jsx>{`
        @keyframes graph-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--fs-2xs)",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-subtle)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--fs-base)", fontWeight: 600, color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}
