"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, type ThreeElements } from "@react-three/fiber";
import {
  Float,
  Line,
  PerspectiveCamera,
  Points,
  PointMaterial,
} from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

// Brand palette — drawn from social/main.png + campaign carousels.
const PALETTE = {
  surface: "#F2EBE0",
  surfaceDeep: "#E6DDCE",
  copper: "#9E6B47",
  copperWarm: "#C68B5F",
  ink: "#1A1612",
  ghost: "#CDBFB0",
};

// Perlin/snoise vertex displacement — a single, alive object that breathes
// rather than a literal bust. Reads as "an intelligence taking shape" which
// is closer to the brand promise than a static head model.
const TWIN_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vNormal;
  varying float vDisp;

  // simplex noise (Ashima)
  vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
  float snoise(vec3 v){
    const vec2 C=vec2(1.0/6.0,1.0/3.0);
    const vec4 D=vec4(0.0,0.5,1.0,2.0);
    vec3 i=floor(v+dot(v,C.yyy));
    vec3 x0=v-i+dot(i,C.xxx);
    vec3 g=step(x0.yzx,x0.xyz);
    vec3 l=1.0-g;
    vec3 i1=min(g.xyz,l.zxy);
    vec3 i2=max(g.xyz,l.zxy);
    vec3 x1=x0-i1+C.xxx;
    vec3 x2=x0-i2+C.yyy;
    vec3 x3=x0-D.yyy;
    i=mod289(i);
    vec4 p=permute(permute(permute(
      i.z+vec4(0.0,i1.z,i2.z,1.0))
      +i.y+vec4(0.0,i1.y,i2.y,1.0))
      +i.x+vec4(0.0,i1.x,i2.x,1.0));
    float n_=0.142857142857;
    vec3 ns=n_*D.wyz-D.xzx;
    vec4 j=p-49.0*floor(p*ns.z*ns.z);
    vec4 x_=floor(j*ns.z);
    vec4 y_=floor(j-7.0*x_);
    vec4 x=x_*ns.x+ns.yyyy;
    vec4 y=y_*ns.x+ns.yyyy;
    vec4 h=1.0-abs(x)-abs(y);
    vec4 b0=vec4(x.xy,y.xy);
    vec4 b1=vec4(x.zw,y.zw);
    vec4 s0=floor(b0)*2.0+1.0;
    vec4 s1=floor(b1)*2.0+1.0;
    vec4 sh=-step(h,vec4(0.0));
    vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
    vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
    vec3 p0=vec3(a0.xy,h.x);
    vec3 p1=vec3(a0.zw,h.y);
    vec3 p2=vec3(a1.xy,h.z);
    vec3 p3=vec3(a1.zw,h.w);
    vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
    vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
    m=m*m;
    return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  void main(){
    vNormal = normal;
    float n = snoise(position * 1.6 + uTime * 0.25);
    vDisp = n;
    vec3 displaced = position + normal * n * uAmp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const TWIN_FRAG = /* glsl */ `
  uniform vec3 uCopper;
  uniform vec3 uSurface;
  uniform vec3 uLightPos;
  varying vec3 vNormal;
  varying float vDisp;

  void main(){
    vec3 n = normalize(vNormal);
    vec3 l = normalize(uLightPos);
    float diff = max(dot(n, l), 0.0);
    float fres = pow(1.0 - dot(n, vec3(0.0, 0.0, 1.0)), 2.5);
    vec3 base = mix(uSurface, uCopper, 0.35 + vDisp * 0.4);
    vec3 col = base * (0.55 + diff * 0.5) + uCopper * fres * 0.45;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function TwinOrb() {
  const mat = useRef<THREE.ShaderMaterial>(null!);
  const mesh = useRef<THREE.Mesh>(null!);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAmp: { value: 0.18 },
      uCopper: { value: new THREE.Color(PALETTE.copper) },
      uSurface: { value: new THREE.Color(PALETTE.surface) },
      uLightPos: { value: new THREE.Vector3(2.0, 1.5, 3.0) },
    }),
    [],
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    if (mesh.current) {
      mesh.current.rotation.y += 0.0018;
      mesh.current.rotation.x =
        Math.sin(state.clock.elapsedTime * 0.15) * 0.05;
    }
    uniforms.uLightPos.value.set(
      2.0 + state.pointer.x * 1.5,
      1.5 + state.pointer.y * 1.2,
      3.0,
    );
  });

  return (
    <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.4}>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1.05, 48]} />
        <shaderMaterial
          ref={mat}
          uniforms={uniforms}
          vertexShader={TWIN_VERT}
          fragmentShader={TWIN_FRAG}
        />
      </mesh>
      {/* Wireframe overlay — the "digital twin" silhouette around the solid form */}
      <mesh scale={1.04}>
        <icosahedronGeometry args={[1.05, 6]} />
        <meshBasicMaterial
          color={PALETTE.copper}
          wireframe
          transparent
          opacity={0.22}
        />
      </mesh>
    </Float>
  );
}

function OrbitalArcs() {
  const arcs = useMemo(() => {
    const out: Array<{
      points: THREE.Vector3[];
      rotation: [number, number, number];
    }> = [];
    const tilts: [number, number, number][] = [
      [0.3, 0.1, 0.05],
      [-0.4, 0.6, -0.2],
      [0.15, -0.5, 0.35],
    ];
    for (const tilt of tilts) {
      const pts: THREE.Vector3[] = [];
      const r = 1.85 + Math.random() * 0.25;
      for (let i = 0; i <= 128; i++) {
        const t = (i / 128) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0));
      }
      out.push({ points: pts, rotation: tilt });
    }
    return out;
  }, []);

  const group = useRef<THREE.Group>(null!);
  useFrame((state) => {
    if (group.current) {
      group.current.rotation.z = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <group ref={group}>
      {arcs.map((arc, i) => (
        <Line
          key={i}
          points={arc.points}
          color={PALETTE.copper}
          lineWidth={1}
          transparent
          opacity={0.32}
          rotation={arc.rotation}
        />
      ))}
    </group>
  );
}

function Constellation({ count = 220 }: { count?: number }) {
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2.4 + Math.random() * 2.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    }
    return arr;
  }, [count]);

  const pts = useRef<THREE.Points>(null!);
  useFrame((state) => {
    if (pts.current) {
      pts.current.rotation.y = state.clock.elapsedTime * 0.02;
      const mat = pts.current.material as THREE.PointsMaterial;
      mat.opacity = 0.55 + Math.sin(state.clock.elapsedTime * 1.3) * 0.15;
    }
  });

  return (
    <Points ref={pts} positions={positions} stride={3}>
      <PointMaterial
        transparent
        color={PALETTE.copper}
        size={0.025}
        sizeAttenuation
        depthWrite={false}
      />
    </Points>
  );
}

function HalftoneGhostBackdrop() {
  // A second, larger, low-opacity orb behind the main one — the "ghost twin"
  // dotted silhouette from the campaigns, abstracted into a softer presence.
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = -state.clock.elapsedTime * 0.04;
    }
  });
  return (
    <mesh ref={ref} position={[0.6, 0.1, -1.4]} scale={1.45}>
      <icosahedronGeometry args={[1, 3]} />
      <meshBasicMaterial
        color={PALETTE.ghost}
        wireframe
        transparent
        opacity={0.18}
      />
    </mesh>
  );
}

export function WelcomeHero3D() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at 50% 55%, ${PALETTE.surface} 0%, ${PALETTE.surfaceDeep} 75%, ${PALETTE.surfaceDeep} 100%)`,
      }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <PerspectiveCamera makeDefault position={[0, 0, 4.2]} fov={42} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} />
        <directionalLight
          position={[-3, -2, 2]}
          intensity={0.35}
          color={PALETTE.copperWarm}
        />
        <HalftoneGhostBackdrop />
        <TwinOrb />
        <OrbitalArcs />
        <Constellation />
        <EffectComposer>
          <Bloom
            intensity={0.55}
            luminanceThreshold={0.35}
            luminanceSmoothing={0.85}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>

      {/* Data labels — pulled straight from the campaign vocabulary */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: 22,
          fontFamily: "var(--font-manrope), Manrope, sans-serif",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: PALETTE.ink,
          opacity: 0.55,
          lineHeight: 1.4,
        }}
      >
        <div>AGENT</div>
        <div>INTELLIGENCE</div>
        <div>LAYER</div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 22,
          fontFamily: "var(--font-manrope), Manrope, sans-serif",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: PALETTE.ink,
          opacity: 0.55,
          textAlign: "right",
          lineHeight: 1.4,
        }}
      >
        <div>IDENTITY</div>
        <div>MATCH ↑ 97%</div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 22,
          fontFamily: "var(--font-manrope), Manrope, sans-serif",
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: PALETTE.ink,
          opacity: 0.4,
        }}
      >
        EMPLOYEE001 · TWIN 001
      </div>
    </div>
  );
}

// Silence unused export-types complaint in strict mode
export type _Unused = ThreeElements;
