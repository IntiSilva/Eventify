'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Renderer, Program, Triangle, Mesh } from 'ogl';
import { useMediaQueryOgl, useReducedMotionOgl } from '@/lib/hooks';

/* -------------------------------- Types ------------------------------- */
export type RippleGridParams = {
  enableRainbow?: boolean;
  gridColor?: string; // hex
  rippleIntensity?: number;
  gridSize?: number;
  gridThickness?: number;
  fadeDistance?: number;
  vignetteStrength?: number;
  glowIntensity?: number;
  opacity?: number;
  gridRotation?: number; // degrees
  mouseInteraction?: boolean;
  mouseInteractionRadius?: number;
};

export type Props = RippleGridParams & {
  /** Mobile overrides (<768px). Only specified props override desktop on mobile. */
  mobile?: Partial<RippleGridParams>;
    /** Static image path for mobile / reduced-motion fallback. */
  staticImageSrc?: string;
  /** Force using the static image instead of WebGL, even on desktop. */
  forceStaticImage?: boolean;
};

/* ------------------------------- Internals ---------------------------- */
// Uniform helpers
 type Uniform<T> = { value: T };
 type Vec2 = [number, number];
 type Vec3 = [number, number, number];

 interface RippleUniforms {
  iTime: Uniform<number>;
  iResolution: Uniform<Vec2>;
  enableRainbow: Uniform<boolean>;
  gridColor: Uniform<Vec3>;
  rippleIntensity: Uniform<number>;
  gridSize: Uniform<number>;
  gridThickness: Uniform<number>;
  fadeDistance: Uniform<number>;
  vignetteStrength: Uniform<number>;
  glowIntensity: Uniform<number>;
  opacity: Uniform<number>;
  gridRotation: Uniform<number>;
  mouseInteraction: Uniform<boolean>;
  mousePosition: Uniform<Vec2>;
  mouseInfluence: Uniform<number>;
  mouseInteractionRadius: Uniform<number>;
 }

 // Local utils
 const hexToRgb = (hex: string): Vec3 => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
      ]
    : [1, 1, 1];
 };

const RippleGridBackground: React.FC<Props> = ({
  // Desktop defaults
  enableRainbow = false,
  gridColor = '#ffffff',
  rippleIntensity = 0.05,
  gridSize = 10.0,
  gridThickness = 15.0,
  fadeDistance = 1.5,
  vignetteStrength = 2.0,
  glowIntensity = 0.1,
  opacity = 1.0,
  gridRotation = 0,
  mouseInteraction = true,
  mouseInteractionRadius = 1,
  // Mobile overrides
  mobile,
  staticImageSrc = '/backgrounds/ripple-grid-mobile.avif',
  forceStaticImage = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse state (smoothed)
  const mousePositionRef = useRef({ x: 0.5, y: 0.5 });
  const targetMouseRef = useRef({ x: 0.5, y: 0.5 });
  const mouseInfluenceRef = useRef(0);
  const activeTouchRef = useRef(false);

  // OGL uniforms handle
  const uniformsRef = useRef<RippleUniforms | null>(null);

  // Reduced motion
  const prefersReduced = useReducedMotionOgl();

  // Breakpoint
  const isMobile = useMediaQueryOgl('(max-width: 767px)');

  // Ready after we know container size > 0
  const [isReady, setIsReady] = useState(false);

  // Fade-in state for static image
  const [imageLoaded, setImageLoaded] = useState(false);

  const [hasMounted, setHasMounted] = useState(false)
  useEffect(() => {
    const run = () => setHasMounted(true)
    if (typeof queueMicrotask === 'function') queueMicrotask(run)
    else Promise.resolve().then(run)
  }, [])

  /*
   * Compute the effective values in ONE place (desktop value, overridden by mobile when applicable).
   * This removes the need for a dozen tiny effects and fixes the exhaustive-deps warnings about `pick`.
   */
  const eff = useMemo(() => {
    const pick = <T,>(desk: T, mob?: T): T => (isMobile && mob !== undefined ? mob : desk);
    return {
      enableRainbow: pick(enableRainbow, mobile?.enableRainbow),
      gridColor: pick(gridColor, mobile?.gridColor),
      rippleIntensity: pick(rippleIntensity, mobile?.rippleIntensity),
      gridSize: pick(gridSize, mobile?.gridSize),
      gridThickness: pick(gridThickness, mobile?.gridThickness),
      fadeDistance: pick(fadeDistance, mobile?.fadeDistance),
      vignetteStrength: pick(vignetteStrength, mobile?.vignetteStrength),
      glowIntensity: pick(glowIntensity, mobile?.glowIntensity),
      opacity: pick(opacity, mobile?.opacity),
      gridRotation: pick(gridRotation, mobile?.gridRotation),
      mouseInteraction: pick(mouseInteraction, mobile?.mouseInteraction),
      mouseInteractionRadius: pick(mouseInteractionRadius, mobile?.mouseInteractionRadius),
    } as const;
  }, [
    isMobile,
    mobile,
    enableRainbow,
    gridColor,
    rippleIntensity,
    gridSize,
    gridThickness,
    fadeDistance,
    vignetteStrength,
    glowIntensity,
    opacity,
    gridRotation,
    mouseInteraction,
    mouseInteractionRadius,
  ]);

  // If user preffers reduced motion force static/safe parameters
  const effStatic = useMemo(() => {
    if (!prefersReduced) return eff;
    return {
      ...eff,
      enableRainbow: false,
      rippleIntensity: 0,
      glowIntensity: 0,
      mouseInteraction: false,
    } as typeof eff;
  }, [eff, prefersReduced]);

  // Decide when to use the static image instead of WebGL
  const useStaticImage = forceStaticImage || isMobile || prefersReduced;

  /* --------------------- Lifecycle: create/destroy OGL --------------------- */
  useEffect(() => {
    
    // In static-image mode we skip all WebGL work
    if (useStaticImage) return;

    const container = containerRef.current;
    if (!container) return;

    // Wait for non-zero size once
    if (!isReady) {
      const ro = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width > 0 && height > 0) {
          setIsReady(true);
          ro.disconnect();
        }
      });
      ro.observe(container);
      return () => ro.disconnect();
    }

    // --- OGL bootstrap ---
    const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 2), alpha: true });
    const gl = renderer.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.width = '100%';
    gl.canvas.style.height = '100%';
    gl.canvas.style.opacity = '0';
    gl.canvas.style.transition = 'opacity 450ms ease-out';
    container.appendChild(gl.canvas);

    const vert = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }`;

    const frag = `precision highp float;
      uniform float iTime;
      uniform vec2 iResolution;
      uniform bool enableRainbow;
      uniform vec3 gridColor;
      uniform float rippleIntensity;
      uniform float gridSize;
      uniform float gridThickness;
      uniform float fadeDistance;
      uniform float vignetteStrength;
      uniform float glowIntensity;
      uniform float opacity;
      uniform float gridRotation;
      uniform bool mouseInteraction;
      uniform vec2 mousePosition;
      uniform float mouseInfluence;
      uniform float mouseInteractionRadius;
      varying vec2 vUv;

      float pi = 3.141592;

      mat2 rotate(float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return mat2(c, -s, s, c);
      }

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        uv.x *= iResolution.x / iResolution.y;

        if (gridRotation != 0.0) {
          uv = rotate(gridRotation * pi / 180.0) * uv;
        }

        float dist = length(uv);
        float func = sin(pi * (iTime - dist));
        vec2 rippleUv = uv + uv * func * rippleIntensity;

        if (mouseInteraction && mouseInfluence > 0.0) {
          vec2 mouseUv = (mousePosition * 2.0 - 1.0);
          mouseUv.x *= iResolution.x / iResolution.y;
          float mouseDist = length(uv - mouseUv);
          float influence = mouseInfluence * exp(-mouseDist * mouseDist / (mouseInteractionRadius * mouseInteractionRadius));
          float mouseWave = sin(pi * (iTime * 2.0 - mouseDist * 3.0)) * influence;
          rippleUv += normalize(uv - mouseUv) * mouseWave * rippleIntensity * 0.3;
        }

        vec2 a = sin(gridSize * 0.5 * pi * rippleUv - pi / 2.0);
        vec2 b = abs(a);

        float aaWidth = 0.5;
        vec2 smoothB = vec2(
          smoothstep(0.0, aaWidth, b.x),
          smoothstep(0.0, aaWidth, b.y)
        );

        vec3 color = vec3(0.0);
        color += exp(-gridThickness * smoothB.x * (0.8 + 0.5 * sin(pi * iTime)));
        color += exp(-gridThickness * smoothB.y);
        color += 0.5 * exp(-(gridThickness / 4.0) * sin(smoothB.x));
        color += 0.5 * exp(-(gridThickness / 3.0) * smoothB.y);

        if (glowIntensity > 0.0) {
          color += glowIntensity * exp(-gridThickness * 0.5 * smoothB.x);
          color += glowIntensity * exp(-gridThickness * 0.5 * smoothB.y);
        }

        float ddd = exp(-2.0 * clamp(pow(dist, fadeDistance), 0.0, 1.0));
        
        vec2 vignetteCoords = vUv - 0.5;
        float vignetteDistance = length(vignetteCoords);
        float vignette = 1.0 - pow(vignetteDistance * 2.0, vignetteStrength);
        vignette = clamp(vignette, 0.0, 1.0);
        
        vec3 t;
        if (enableRainbow) {
          t = vec3(
            uv.x * 0.5 + 0.5 * sin(iTime),
            uv.y * 0.5 + 0.5 * cos(iTime),
            pow(cos(iTime), 4.0)
          ) + 0.5;
        } else {
          t = gridColor;
        }

        float finalFade = ddd * vignette;
        float alpha = length(color) * finalFade * opacity;
        gl_FragColor = vec4(color * t * finalFade * opacity, alpha);
      }`;

    // Uniforms (initial from *desktop* props; will be hot-updated by the sync effect below)
    const uniforms: RippleUniforms = {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] },
      enableRainbow: { value: effStatic.enableRainbow },
      gridColor: { value: hexToRgb(effStatic.gridColor) },
      rippleIntensity: { value: effStatic.rippleIntensity },
      gridSize: { value: effStatic.gridSize },
      gridThickness: { value: effStatic.gridThickness },
      fadeDistance: { value: effStatic.fadeDistance },
      vignetteStrength: { value: effStatic.vignetteStrength },
      glowIntensity: { value: effStatic.glowIntensity },
      opacity: { value: effStatic.opacity },
      gridRotation: { value: effStatic.gridRotation },
      mouseInteraction: { value: effStatic.mouseInteraction },
      mousePosition: { value: [0.5, 0.5] },
      mouseInfluence: { value: 0 },
      mouseInteractionRadius: { value: effStatic.mouseInteractionRadius },
    };

    uniformsRef.current = uniforms;

    const geometry = new Triangle(gl);
    const program = new Program(gl, { vertex: vert, fragment: frag, uniforms });
    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      uniforms.iResolution.value = [w, h];
    };

    // Mouse helpers
    const updateTargetFromXY = (clientX: number, clientY: number) => {
      const x = clientX / window.innerWidth;
      const y = 1.0 - clientY / window.innerHeight;
      targetMouseRef.current = { x, y };
    };

    const withInteractivity = uniforms.mouseInteraction.value && !prefersReduced;

    const handleMouseMove: (e: globalThis.MouseEvent) => void = (e) => {
      if (!withInteractivity) return;
      updateTargetFromXY(e.clientX, e.clientY);
      mouseInfluenceRef.current = 1.0;
    };

    const handleMouseOut: (e: globalThis.MouseEvent) => void = (e) => {
      if (!withInteractivity) return;
      if (!e.relatedTarget) mouseInfluenceRef.current = 0.0;
    };

    const handleTouchStart: (e: globalThis.TouchEvent) => void = (e) => {
      if (!withInteractivity) return;
      const t = e.touches[0];
      if (!t) return;
      const rect = container.getBoundingClientRect();
      if (t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom) {
        activeTouchRef.current = true;
        updateTargetFromXY(t.clientX, t.clientY);
        mouseInfluenceRef.current = 1.0;
      }
    };

    const handleTouchMove: (e: globalThis.TouchEvent) => void = (e) => {
      if (!withInteractivity || !activeTouchRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      updateTargetFromXY(t.clientX, t.clientY);
      mouseInfluenceRef.current = 1.0;
    };

    const handleTouchEnd: (e: globalThis.TouchEvent) => void = () => {
      if (!withInteractivity) return;
      activeTouchRef.current = false;
      mouseInfluenceRef.current = 0.0;
    };

    if (withInteractivity) {
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseout', handleMouseOut, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    };

    resize();
    requestAnimationFrame(() => {
      gl.canvas.style.opacity = '1';
    });

    let rafId = 0;
    const render = (t: number) => {
      uniforms.iTime.value = t * 0.001;

      // Mouse smoothing
      const lerpFactor = 0.1;
      mousePositionRef.current.x += (targetMouseRef.current.x - mousePositionRef.current.x) * lerpFactor;
      mousePositionRef.current.y += (targetMouseRef.current.y - mousePositionRef.current.y) * lerpFactor;

      // Influence smoothing
      const currentInfluence = uniforms.mouseInfluence.value;
      const targetInfluence = mouseInfluenceRef.current;
      uniforms.mouseInfluence.value += (targetInfluence - currentInfluence) * 0.05;

      uniforms.mousePosition.value = [mousePositionRef.current.x, mousePositionRef.current.y];

      renderer.render({ scene: mesh });
      rafId = requestAnimationFrame(render);
    };

    if (prefersReduced) {
      // Static render if the user prefers reduced motion
      uniforms.iTime.value = 0;
      uniforms.mouseInfluence.value = 0;
      uniforms.mousePosition.value = [0.5, 0.5];
      renderer.render({ scene: mesh });
    } else {
      rafId = requestAnimationFrame(render);
    }

    return () => {

      window.removeEventListener('resize', resize);
      if (withInteractivity) {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseout', handleMouseOut);
        window.removeEventListener('touchstart', handleTouchStart);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchEnd);
      };
      cancelAnimationFrame(rafId);
      renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (container && gl.canvas.parentElement === container) container.removeChild(gl.canvas);
    };
  }, [useStaticImage, isReady, effStatic, prefersReduced, isMobile]);

  /* ------------------ Sync refs + hot-update uniforms in one go ------------------ */
  useEffect(() => {
    // Sync refs
    // (These refs can be handy if you later want to read the current knobs outside uniforms)
    // Not strictly required, but keeps a single source of truth.
    const u = uniformsRef.current;
    if (!u) return;

    u.enableRainbow.value = effStatic.enableRainbow;
    u.gridColor.value = hexToRgb(effStatic.gridColor);
    u.rippleIntensity.value = effStatic.rippleIntensity;
    u.gridSize.value = effStatic.gridSize;
    u.gridThickness.value = effStatic.gridThickness;
    u.fadeDistance.value = effStatic.fadeDistance;
    u.vignetteStrength.value = effStatic.vignetteStrength;
    u.glowIntensity.value = effStatic.glowIntensity;
    u.opacity.value = effStatic.opacity;
    u.gridRotation.value = effStatic.gridRotation;
    u.mouseInteraction.value = effStatic.mouseInteraction;
    u.mouseInteractionRadius.value = effStatic.mouseInteractionRadius;
  }, [effStatic]);

   return (
    <div ref={containerRef} className="w-full h-full bg-black relative overflow-hidden pointer-events-none [&_canvas]:block">
      {hasMounted && useStaticImage && (
        <Image
          src={staticImageSrc}
          alt=""
          fill
          priority
          sizes="100vw"
          onLoadingComplete={() => setImageLoaded(true)}
          className={`object-cover transition-opacity duration-400 ease-in ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  )
};

export default RippleGridBackground;
