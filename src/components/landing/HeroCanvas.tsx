"use client";

import { useEffect, useRef } from "react";

export default function HeroCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import("three");
      const { EffectComposer } = await import(
        "three/examples/jsm/postprocessing/EffectComposer.js"
      );
      const { RenderPass } = await import(
        "three/examples/jsm/postprocessing/RenderPass.js"
      );
      const { ShaderPass } = await import(
        "three/examples/jsm/postprocessing/ShaderPass.js"
      );
      const { UnrealBloomPass } = await import(
        "three/examples/jsm/postprocessing/UnrealBloomPass.js"
      );
      const { RGBShiftShader } = await import(
        "three/examples/jsm/shaders/RGBShiftShader.js"
      );

      if (disposed) return;
      const container = containerRef.current;
      if (!container) return;
      while (container.firstChild) container.removeChild(container.firstChild);

      const renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setClearColor(0x000000, 1);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);
      const camera = new THREE.OrthographicCamera();

      const renderPass = new RenderPass(scene, camera);
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(container.clientWidth, container.clientHeight),
        0.22,
        0.7,
        0.18,
      );
      const rgbShift = new ShaderPass(RGBShiftShader);
      rgbShift.uniforms["amount"].value = 0.0015;
      rgbShift.uniforms["angle"].value = Math.PI / 4;

      const composer = new EffectComposer(renderer);
      composer.addPass(renderPass);
      composer.addPass(bloom);
      composer.addPass(rgbShift);

      const GRID = {
        cols: 120,
        rows: 120,
        jitter: 0.3,
        hexOffset: 0.5,
        dotRadius: 0.022,
        spacing: 0.6,
      };
      const total = GRID.cols * GRID.rows;
      const geometry = new THREE.CircleGeometry(GRID.dotRadius, 8);
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const dots = new THREE.InstancedMesh(geometry, material, total);
      dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(dots);

      const basePos = new Float32Array(total * 2);
      const distArr = new Float32Array(total);
      const xOff = (GRID.cols - 1) * GRID.spacing * 0.5;
      const yOff = (GRID.rows - 1) * GRID.spacing * 0.5;
      const dummy = new THREE.Object3D();
      let idx = 0;
      for (let r = 0; r < GRID.rows; r++) {
        for (let c = 0; c < GRID.cols; c++, idx++) {
          let x = c * GRID.spacing - xOff;
          let y = r * GRID.spacing - yOff;
          y += (c % 2) * GRID.hexOffset * GRID.spacing;
          x += (Math.random() - 0.5) * GRID.jitter;
          y += (Math.random() - 0.5) * GRID.jitter;
          basePos[idx * 2] = x;
          basePos[idx * 2 + 1] = y;
          const len = Math.hypot(x, y);
          const ang = Math.atan2(y, x);
          const oct = 0.5 * Math.cos(ang * 8.0);
          distArr[idx] = len + oct * 0.75;
          dummy.position.set(x, y, 0);
          dummy.updateMatrix();
          dots.setMatrixAt(idx, dummy.matrix);
        }
      }

      const roundedSquareWave = (
        t: number,
        delta: number,
        a: number,
        f: number,
      ) =>
        ((2 * a) / Math.PI) *
        Math.atan(Math.sin(2 * Math.PI * t * f) / delta);

      const clock = new THREE.Clock();
      let raf: number | null = null;
      let inView = true;
      const mat = new THREE.Matrix4();
      const pos = new THREE.Vector3();

      const animate = () => {
        if (!inView) {
          raf = null;
          return;
        }
        raf = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        const speed = 0.5;
        const amp = 0.75;
        const freq = 0.3;
        const falloff = 0.035;
        const phase = (Math.sin(2 * Math.PI * t * freq) + 1) * 0.5;
        rgbShift.uniforms["amount"].value = 0.001 + phase * 0.0025;
        for (let i = 0; i < total; i++) {
          const x0 = basePos[i * 2];
          const y0 = basePos[i * 2 + 1];
          const dist = distArr[i];
          const localDelta = THREE.MathUtils.lerp(
            0.05,
            0.2,
            Math.min(1.0, dist / 70.0),
          );
          const tt = t * speed - dist * falloff;
          const k = 1 + roundedSquareWave(tt, localDelta, amp, freq);
          pos.set(x0 * k, y0 * k, 0);
          mat.set(1, 0, 0, pos.x, 0, 1, 0, pos.y, 0, 0, 1, 0, 0, 0, 0, 1);
          dots.setMatrixAt(i, mat);
        }
        dots.instanceMatrix.needsUpdate = true;
        composer.render();
      };

      const resizeCamera = () => {
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        const aspect = w / h;
        const worldHeight = 10;
        const worldWidth = worldHeight * aspect;
        camera.left = -worldWidth / 2;
        camera.right = worldWidth / 2;
        camera.top = worldHeight / 2;
        camera.bottom = -worldHeight / 2;
        camera.near = -100;
        camera.far = 100;
        camera.position.set(0, 0, 10);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        composer.setSize(w, h);
        bloom.setSize(w, h);
      };

      const ro = new ResizeObserver(() => resizeCamera());
      ro.observe(container);
      resizeCamera();

      // Pause RAF when canvas is offscreen — biggest perf win.
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const wasInView = inView;
            inView = e.isIntersecting;
            if (inView && !wasInView) {
              clock.start();
              if (raf === null) animate();
            } else if (!inView && wasInView) {
              clock.stop();
            }
          }
        },
        { threshold: 0.01 },
      );
      io.observe(container);

      // Also pause when tab is hidden
      const onVis = () => {
        if (document.hidden) {
          inView = false;
        } else {
          const rect = container.getBoundingClientRect();
          const stillInView =
            rect.bottom > 0 && rect.top < window.innerHeight;
          if (stillInView) {
            inView = true;
            clock.start();
            if (raf === null) animate();
          }
        }
      };
      document.addEventListener("visibilitychange", onVis);

      animate();

      cleanup = () => {
        ro.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVis);
        if (raf !== null) cancelAnimationFrame(raf);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        while (container.firstChild) container.removeChild(container.firstChild);
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Fade-out gradient at bottom so the dark canvas blends into the next section */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-32"
        style={{
          background:
            "linear-gradient(to bottom, transparent, var(--lp-bg) 90%)",
        }}
      />
    </div>
  );
}
