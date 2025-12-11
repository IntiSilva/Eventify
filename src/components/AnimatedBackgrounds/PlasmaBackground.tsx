'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import { Renderer, Program, Mesh, Triangle } from 'ogl';
import { useReducedMotionOgl, useMediaQueryOgl } from '@/lib/hooks';

/* ──────────────────────────────────────────────────────────────────
   Types
   ────────────────────────────────────────────────────────────────── */

type Direction = 'forward' | 'reverse' | 'pingpong';

export type PlasmaBackgroundProps = {
  color?: string;         // hex
  speed?: number;         // base time speed
  direction?: Direction;  // forward | reverse | pingpong
  scale?: number;         // spatial scale
  opacity?: number;       // 0..1
  mouseInteraction?: boolean;
  fpsCap?: number;
  className?: string;
  rotateDeg?: number;     // degrees (clockwise)
  offsetX?: number;       // normalized horizontal offset (0..1)
    /** Static image path for reduced-motion / forced-static mode. */
  staticImageSrc?: string;

  /** Force using the static image instead of WebGL, even on desktop. */
  forceStaticImage?: boolean;
};

/* ──────────────────────────────────────────────────────────────────
   Strong typing for OGL uniforms
   ────────────────────────────────────────────────────────────────── */

type UFloat = { value: number };
type UVec2 = { value: Float32Array };
type UVec3 = { value: Float32Array };

type PlasmaUniforms = {
  iTime: UFloat;
  iResolution: UVec2;
  uCustomColor: UVec3;
  uUseCustomColor: UFloat;
  uSpeed: UFloat;
  uDirection: UFloat;
  uScale: UFloat;
  uOpacity: UFloat;
  uMouse: UVec2;
  uMouseInteractive: UFloat;
  uRotateDeg: UFloat;
  uOffsetNorm: UVec2;
};

type ProgramWithUniforms<U> = Program & { uniforms: U };

/* ──────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────── */

const hexToRgb = (hex?: string): [number, number, number] => {
  if (!hex) return [1, 1, 1];
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

/* ──────────────────────────────────────────────────────────────────
   Shaders (WebGL2)
   ────────────────────────────────────────────────────────────────── */

const vertex = `#version 300 es
precision highp float;
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform float iTime;

uniform vec3 uCustomColor;
uniform float uUseCustomColor;

uniform float uSpeed;
uniform float uDirection;
uniform float uScale;
uniform float uOpacity;

uniform vec2 uMouse;
uniform float uMouseInteractive;

uniform float uRotateDeg;
uniform vec2  uOffsetNorm;

out vec4 fragColor;

void mainImage(out vec4 o, vec2 C) {
  vec2 center = iResolution.xy * 0.5;
  C = (C - center) / uScale + center;

  float a = radians(uRotateDeg);
  float c = cos(a), s = sin(a);
  mat2 R = mat2(c, s, -s, c);
  C = center + R * (C - center);

  C += uOffsetNorm * iResolution;

  vec2 mouseOffset = (uMouse - center) * 0.0002;
  C += mouseOffset * length(C - center) * step(0.5, uMouseInteractive);

  float i, d, z, T = iTime * uSpeed * uDirection;
  vec3 O, p, S;

  for (vec2 r = iResolution.xy, Q; ++i < 60.; O += o.w/d*o.xyz) {
    p = z*normalize(vec3(C-.5*r,r.y));
    p.z -= 4.;
    S = p;
    d = p.y-T;

    p.x += .4*(1.+p.y)*sin(d + p.x*0.1)*cos(.34*d + p.x*0.05);
    Q = p.xz *= mat2(cos(p.y+vec4(0,11,33,0)-T));
    z+= d = abs(sqrt(length(Q*Q)) - .25*(5.+S.y))/3.+8e-4;
    o = 1.+sin(S.y+p.z*.5+S.z-length(S-p)+vec4(2,1,0,8));
  }
  o.xyz = tanh(O/1e4);
}

bool finite1(float x){ return !(isnan(x) || isinf(x)); }
vec3 sanitize(vec3 c){
  return vec3(
    finite1(c.r) ? c.r : 0.0,
    finite1(c.g) ? c.g : 0.0,
    finite1(c.b) ? c.b : 0.0
  );
}

void main() {
  vec4 o = vec4(0.0);
  mainImage(o, gl_FragCoord.xy);
  vec3 rgb = sanitize(o.rgb);

  float intensity = (rgb.r + rgb.g + rgb.b) / 3.0;
  vec3 customColor = intensity * uCustomColor;
  vec3 finalColor = mix(rgb, customColor, step(0.5, uUseCustomColor));

  float alpha = clamp(length(rgb) * uOpacity, 0.0, 1.0);
  fragColor = vec4(finalColor, alpha);
}
`;

/* ──────────────────────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────────────────────── */

const PlasmaBackground: React.FC<PlasmaBackgroundProps> = ({
  color = '#1ACC80',
  speed = 1,
  direction = 'forward',
  scale = 1,
  opacity = 0.95,
  mouseInteraction = true,
  fpsCap = 30,
  className = '',
  rotateDeg = 0,
  offsetX = 0,
  staticImageSrc = '/backgrounds/plasma-bg-mobile.avif',
  forceStaticImage = false
}) => {
  // Refs & state
  const containerRef = useRef<HTMLDivElement | null>(null);
  const programRef = useRef<ProgramWithUniforms<PlasmaUniforms> | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const meshRef = useRef<Mesh | null>(null);

  const animRef = useRef<number | null>(null);
  const runningRef = useRef<boolean>(true);
  const lastTsRef = useRef<number>(0);
  const t0Ref = useRef<number>(0);
  const minDtRef = useRef<number>(1000 / Math.max(1, fpsCap)); // updated by fpsCapRef effect

  const prefersReducedMotion = useReducedMotionOgl();
  const isMobile = useMediaQueryOgl('(max-width: 767px)');
  const [ready, setReady] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const useStaticImage = forceStaticImage || isMobile || prefersReducedMotion;

  // Reactive refs for loop/listeners (avoid re-bootstrap)
  const directionRef = useRef<Direction>('forward');
  const mouseInteractiveRef = useRef<boolean>(true);
  const fpsCapRef = useRef<number>(fpsCap);

  useEffect(() => { directionRef.current = direction; }, [direction]);
  useEffect(() => { mouseInteractiveRef.current = mouseInteraction; }, [mouseInteraction]);
  useEffect(() => {
    fpsCapRef.current = fpsCap;
    minDtRef.current = 1000 / Math.max(1, fpsCapRef.current);
  }, [fpsCap]);

  // Compute effective params
  const getEffective = useCallback(() => {
    const effFpsCap = fpsCapRef.current;
    const effScale = scale;
    const effSpeed = speed;
    const effOpacity = opacity;
    const effRotateDeg = rotateDeg;
    const effOffsetX = offsetX;
    return { effFpsCap, effScale, effSpeed, effOpacity, effRotateDeg, effOffsetX };
  }, [scale, speed, opacity, rotateDeg, offsetX]);


  // Wait until the container has size before bootstrapping WebGL
  useEffect(() => {
    if (ready || !containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setReady(true);
        ro.disconnect();
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready]);

  // Bootstrap WebGL (no prop reads captured for logic; uniforms are applied via helper)
  useEffect(() => {

    if (!ready || useStaticImage || !containerRef.current) return;

    const container = containerRef.current;

    // 1) Renderer (WebGL2)
    let renderer: Renderer | null = null;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, 1.5),
      });
    } catch {
      return; // no WebGL2 available
    }
    rendererRef.current = renderer;

    const gl = renderer.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 450ms ease-out';
    container.appendChild(canvas);

    // 2) Geometry + Program (uniforms with safe defaults; real props applied via helper)
    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uCustomColor: { value: new Float32Array(hexToRgb(color)) }, // initial, will be updated
        uUseCustomColor: { value: color ? 1 : 0 },
        uSpeed: { value: 0.4 },
        uDirection: { value: 1 },
        uScale: { value: 1 },
        uOpacity: { value: 1 },
        uMouse: { value: new Float32Array([0, 0]) },
        uMouseInteractive: { value: mouseInteraction ? 1 : 0 },
        uRotateDeg: { value: 0 },
        uOffsetNorm: { value: new Float32Array([0, 0]) },
      } as PlasmaUniforms,
    }) as ProgramWithUniforms<PlasmaUniforms>;
    programRef.current = program;

    const mesh = new Mesh(gl, { geometry, program });
    meshRef.current = mesh;

    // Helper: apply current props to uniforms immediately
    const applyUniforms = () => {
      const p = programRef.current;
      if (!p) return;

      const { effScale, effSpeed, effOpacity, effRotateDeg, effOffsetX } = getEffective();

      // Numeric uniforms
      p.uniforms.uOpacity.value = effOpacity;
      p.uniforms.uScale.value = effScale;
      p.uniforms.uSpeed.value = effSpeed * 0.4;
      p.uniforms.uRotateDeg.value = effRotateDeg;

      // Offset
      p.uniforms.uOffsetNorm.value[0] = effOffsetX;
      p.uniforms.uOffsetNorm.value[1] = 0;

      // Color & toggle
      const rgb = hexToRgb(color);
      p.uniforms.uUseCustomColor.value = color ? 1 : 0;
      p.uniforms.uCustomColor.value[0] = rgb[0];
      p.uniforms.uCustomColor.value[1] = rgb[1];
      p.uniforms.uCustomColor.value[2] = rgb[2];

      // Direction base (non-pingpong case); pingpong handled in RAF loop
      if (directionRef.current === 'forward') p.uniforms.uDirection.value = 1;
      else if (directionRef.current === 'reverse') p.uniforms.uDirection.value = -1;

      // Mouse flag (also mirrored in ref via separate effect)
      p.uniforms.uMouseInteractive.value = mouseInteractiveRef.current ? 1 : 0;
    };

    // 3) Size handling
    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer!.setSize(w, h);

      const res = program.uniforms.iResolution.value;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;

      // Aplicar uniforms con los valores actuales de desktop
      applyUniforms();
    };

    setSize();
    const ro = new ResizeObserver(setSize);
    ro.observe(container);

    // Fade-in next frame
    requestAnimationFrame(() => { canvas.style.opacity = '1'; });

    // Pause when hidden / not intersecting
    const onVis = () => { runningRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);

    const io = new IntersectionObserver(
      ([entry]) => { runningRef.current = entry.isIntersecting && entry.intersectionRatio > 0; },
      { threshold: [0, 0.01] }
    );
    io.observe(container);

    // Window-level mouse (background is pointer-events-none)
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!mouseInteractiveRef.current) return;
      const mouse = program.uniforms.uMouse.value;
      mouse[0] = e.clientX;
      mouse[1] = e.clientY;
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    // 4) RAF loop with FPS cap (uses refs only)
    const loop = (t: number) => {
      animRef.current = requestAnimationFrame(loop);
      if (!runningRef.current) return;

      //Lazy init for the first time it enters the loop
      if (t0Ref.current === 0) t0Ref.current = t;
      if (lastTsRef.current === 0) lastTsRef.current = t;

      const last = lastTsRef.current;
      const minDt = minDtRef.current;
      if (t - last < minDt) return;
      lastTsRef.current = t;

      const programLocal = programRef.current;
      if (!programLocal) return;

      const timeValue = (t - t0Ref.current) * 0.001;

      // Dynamic ping-pong
      if (directionRef.current === 'pingpong') {
        const cycle = Math.sin(timeValue * 0.5);
        programLocal.uniforms.uDirection.value = cycle;
      }

      programLocal.uniforms.iTime.value = timeValue;
      renderer!.render({ scene: mesh });
    };
    animRef.current = requestAnimationFrame(loop);

    // Cleanup
    return () => {
      cancelAnimationFrame(animRef.current ?? 0);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
      window.removeEventListener('mousemove', onMouseMove);
      renderer?.gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (container.contains(canvas)) container.removeChild(canvas);
      programRef.current = null;
      meshRef.current = null;
      rendererRef.current = null;
    };
  }, [ready, useStaticImage, prefersReducedMotion, color, getEffective, mouseInteraction]);

  // Hot-update uniforms when props / overrides change (after bootstrap)
  useEffect(() => {
    const p = programRef.current;
    if (!p) return;

    const { effScale, effSpeed, effOpacity, effRotateDeg, effOffsetX } = getEffective();

    p.uniforms.uOpacity.value = effOpacity;
    p.uniforms.uScale.value = effScale;
    p.uniforms.uSpeed.value = effSpeed * 0.4;
    p.uniforms.uRotateDeg.value = effRotateDeg;

    p.uniforms.uOffsetNorm.value[0] = effOffsetX;
    p.uniforms.uOffsetNorm.value[1] = 0;

    const rgb = hexToRgb(color);
    p.uniforms.uUseCustomColor.value = color ? 1 : 0;
    p.uniforms.uCustomColor.value[0] = rgb[0];
    p.uniforms.uCustomColor.value[1] = rgb[1];
    p.uniforms.uCustomColor.value[2] = rgb[2];

    if (direction === 'forward') p.uniforms.uDirection.value = 1;
    else if (direction === 'reverse') p.uniforms.uDirection.value = -1;

    p.uniforms.uMouseInteractive.value = mouseInteraction ? 1 : 0;
  }, [
    color,
    mouseInteraction,
    direction,
    scale,
    speed,
    opacity,
    rotateDeg,
    offsetX,
    getEffective,
  ]);

    return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
      aria-hidden
    >
      {useStaticImage && (
        <Image
          src={staticImageSrc}
          alt=""
          fill
          priority
          sizes="100vw"
          onLoadingComplete={() => setImageLoaded(true)}
          className={
            'object-cover transition-opacity duration-400 ease-in' +
            (imageLoaded ? 'opacity-100' : 'opacity-0')
          }
        />
      )}
    </div>
  );

};

export default PlasmaBackground;
