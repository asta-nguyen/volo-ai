"use client";

import { useEffect, useRef } from "react";

type Three = typeof import("three");

// A field of points rippling like a voice waveform. The swell travels along x so
// it reads as speech moving through the scene, loudest along the centre row.
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    float centre = exp(-p.z * p.z * 0.22);
    float swell = 0.55 + 0.45 * sin(p.x * 0.38 - uTime * 0.85);
    float wave = sin(p.x * 1.05 + uTime * 1.5) * 0.36
      + sin(p.x * 2.4 - uTime * 2.0 + p.z * 0.9) * 0.16
      + sin(p.z * 1.6 + uTime * 1.1) * 0.1;
    p.y += wave * swell * (0.3 + centre);

    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uPixelRatio * (1.8 + 1.7 * centre) * (9.0 / -view.z);

    float edges = smoothstep(8.0, 4.0, abs(p.x)) * smoothstep(3.6, 1.0, abs(p.z));
    vAlpha = edges * (0.28 + 0.72 * centre);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, vAlpha * uOpacity * smoothstep(0.5, 0.12, d));
  }
`;

function mount(THREE: Three, canvas: HTMLCanvasElement): () => void {
  let renderer: InstanceType<Three["WebGLRenderer"]>;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    return () => {}; // No WebGL: the hero simply keeps its plain background.
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

  const compact = window.matchMedia("(max-width: 720px)").matches;
  const columns = compact ? 90 : 170;
  const rows = compact ? 30 : 54;
  const positions = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = (row * columns + column) * 3;
      positions[index] = (column / (columns - 1) - 0.5) * 16;
      positions[index + 2] = (row / (rows - 1) - 0.5) * 7;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: renderer.getPixelRatio() },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 1 },
    },
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Points(geometry, material));
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

  const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyTheme = () => {
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim();
    material.uniforms.uColor.value.set(accent || "#b85e43");
    // Points over a light paper background need more weight to stay visible.
    material.uniforms.uOpacity.value = darkScheme.matches ? 0.85 : 0.7;
  };
  applyTheme();

  const pointer = { x: 0, y: 0 };
  const tilt = { x: 0, y: 0 };
  const onPointerMove = (event: PointerEvent) => {
    pointer.x = event.clientX / window.innerWidth - 0.5;
    pointer.y = event.clientY / window.innerHeight - 0.5;
  };

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };

  const draw = (seconds: number) => {
    material.uniforms.uTime.value = seconds;
    tilt.x += (pointer.x - tilt.x) * 0.04;
    tilt.y += (pointer.y - tilt.y) * 0.04;
    camera.position.set(tilt.x * 1.6, 1.6 - tilt.y * 0.6, 8.5);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };

  let frame = 0;
  let visible = true;
  const start = performance.now();
  const loop = () => {
    frame = 0;
    if (!visible || document.hidden || reducedMotion.matches) return;
    draw((performance.now() - start) / 1000);
    frame = requestAnimationFrame(loop);
  };
  const play = () => {
    if (reducedMotion.matches) {
      draw(2.2); // One still frame of the waveform.
      return;
    }
    if (!frame) frame = requestAnimationFrame(loop);
  };

  const resizeObserver = new ResizeObserver(() => {
    resize();
    play();
  });
  resizeObserver.observe(canvas);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) play();
  });
  intersectionObserver.observe(canvas);
  const onThemeChange = () => {
    applyTheme();
    if (reducedMotion.matches) draw(2.2);
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("visibilitychange", play);
  darkScheme.addEventListener("change", onThemeChange);
  reducedMotion.addEventListener("change", play);

  resize();
  play();
  canvas.dataset.ready = "";

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    window.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("visibilitychange", play);
    darkScheme.removeEventListener("change", onThemeChange);
    reducedMotion.removeEventListener("change", play);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}

export function HeroScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let unmount = () => {};
    // three loads after hydration so it never delays the first paint.
    void import("three").then((THREE) => {
      if (!cancelled) unmount = mount(THREE, canvas);
    });
    return () => {
      cancelled = true;
      unmount();
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-scene" aria-hidden="true" />;
}
