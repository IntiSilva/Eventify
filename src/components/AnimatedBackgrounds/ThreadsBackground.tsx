'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Renderer, Program, Mesh, Triangle, Color } from 'ogl';
import { useReducedMotionOgl, useMediaQueryOgl } from '@/lib/hooks';

/* ------------------------------- Shaders ------------------------------- */
const vertexShader = `
  attribute vec2 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  uniform float iTime;
  uniform vec3 iResolution;
  uniform vec3 uColor;
  uniform float uAmplitude;
  uniform float uDistance;
  uniform vec2 uMouse;
  uniform bool uIsVertical;
  uniform float uScrollOffset;
  uniform float uDragOffset;

  #define PI 3.1415926538
  const int u_line_count = 32;
  const float u_line_width = 7.0;
  const float u_line_blur = 10.0;

  float Perlin2D(vec2 P) {
    vec2 Pi = floor(P);
    vec4 Pf_Pfmin1 = P.xyxy - vec4(Pi, Pi + 1.0);
    vec4 Pt = vec4(Pi.xy, Pi.xy + 1.0);
    Pt = Pt - floor(Pt * (1.0 / 71.0)) * 71.0;
    Pt += vec2(26.0, 161.0).xyxy;
    Pt *= Pt;
    Pt = Pt.xzxz * Pt.yyww;
    vec4 hash_x = fract(Pt * (1.0 / 951.135664));
    vec4 hash_y = fract(Pt * (1.0 / 642.949883));
    vec4 grad_x = hash_x - 0.49999;
    vec4 grad_y = hash_y - 0.49999;
    vec4 grad_results = inversesqrt(grad_x * grad_x + grad_y * grad_y) * (
      grad_x * Pf_Pfmin1.xzxz + grad_y * Pf_Pfmin1.yyww
    );
    grad_results *= 1.4142135623730950;
    vec2 blend = Pf_Pfmin1.xy * Pf_Pfmin1.xy * Pf_Pfmin1.xy * (
      Pf_Pfmin1.xy * (Pf_Pfmin1.xy * 6.0 - 15.0) + 10.0
    );
    vec4 blend2 = vec4(blend, vec2(1.0 - blend));
    return dot(grad_results, blend2.zxzx * blend2.wwyy);
  }

  float pixel(float count, vec2 resolution) {
    return (1.0 / max(resolution.x, resolution.y)) * count;
  }

  float lineFn(
    vec2 st,
    float width,
    float perc,
    float offset,
    vec2 mouse,
    float time,
    float amplitude,
    float distance
  ) {
    float split_offset = (perc * 0.4);
    float split_point = 0.1 + split_offset;
    vec2 oriented_st = uIsVertical ? st.yx : st;
    vec2 oriented_mouse = uIsVertical ? mouse.yx : mouse;

    float amplitude_normal = smoothstep(split_point, 0.7, oriented_st.x);
    float amplitude_strength = 0.5;
    float finalAmplitude =
      amplitude_normal * amplitude_strength * amplitude *
      (1.0 + (oriented_mouse.y - 0.5) * 0.2);

    float time_scaled =
      (time / 10.0 + (oriented_mouse.x - 0.5) * 1.0) + uDragOffset;

    float blur = smoothstep(split_point, split_point + 0.05, oriented_st.x) * perc;

    float xnoise = mix(
      Perlin2D(vec2(time_scaled, oriented_st.x + perc + uScrollOffset) * 2.5),
      Perlin2D(vec2(time_scaled, oriented_st.x + time_scaled) * 3.5) / 1.5,
      oriented_st.x * 0.3
    );

    float y = 0.5 + (perc - 0.5) * distance + xnoise / 2.0 * finalAmplitude;

    float line_start = smoothstep(
      y + (width / 2.0) + (u_line_blur * pixel(1.0, iResolution.xy) * blur),
      y,
      oriented_st.y
    );

    float line_end = smoothstep(
      y,
      y - (width / 2.0) - (u_line_blur * pixel(1.0, iResolution.xy) * blur),
      oriented_st.y
    );

    return clamp(
      (line_start - line_end) * (1.0 - smoothstep(0.0, 1.0, pow(perc, 0.3))),
      0.0,
      1.0
    );
  }

  void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float line_strength = 1.0;

    for (int i = 0; i < u_line_count; i++) {
      float p = float(i) / float(u_line_count);
      line_strength *= (1.0 - lineFn(
        uv,
        u_line_width * pixel(1.0, iResolution.xy) * (1.0 - p),
        p,
        (PI * 1.0) * p,
        uMouse,
        iTime,
        uAmplitude,
        uDistance
      ));
    }

    float colorVal = 1.0 - line_strength;
    fragColor = vec4(uColor * colorVal, colorVal);
  }

  void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
  }
`;

/* -------------------------------- Types -------------------------------- */
type ResponsiveValue = { mobile?: number; tablet?: number; desktop?: number };

interface ThreadsProps {
  color?: [number, number, number];
  amplitude?: number | ResponsiveValue;
  distance?: number | ResponsiveValue;
  scrollSensitivity?: number | ResponsiveValue;
  /** Optional static image path for mobile / reduced-motion fallback */
  staticImageSrc?: string;

  /** Force using the static image instead of WebGL, even on desktop */
  forceStaticImage?: boolean;
}

/* -------------------------- Component ------------------------- */
const ThreadsBackground: React.FC<ThreadsProps> = ({
  color = [0.1, 0.8, 0.5],
  amplitude = 1,
  distance = 0,
  scrollSensitivity = { mobile: 1.5, tablet: 2.0, desktop: 2.0 },
  staticImageSrc = '/backgrounds/threads-bg-mobile.avif',
  forceStaticImage = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const programRef = useRef<Program | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const animationFrameId = useRef<number | null>(null);

  // Physics
  const scrollVelocity = useRef(0);
  const lastScrollY = useRef(0);
  // Scroll performance gating (trackpad / wheel)
  const isUserScrollingRef = useRef(false);
  const scrollIdleTimerRef = useRef<number | null>(null);


  // Dynamic refs (live values used in handlers / RAF)
  const amplitudeRef = useRef(1);
  const distanceRef = useRef(0);
  const scrollSensRef = useRef(2);
  const isVerticalRef = useRef(false);

  const [isReady, setIsReady] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const prefersReducedMotion = useReducedMotionOgl();

  // Breakpoints
  const isMobile = useMediaQueryOgl('(max-width: 767px)');
  const isTablet = useMediaQueryOgl('(min-width: 768px) and (max-width: 1023px)');
  const isDesktop = useMediaQueryOgl('(min-width: 1024px)');
  const useStaticImage = forceStaticImage || isMobile || prefersReducedMotion;


  // Resolve responsive numeric values based on current breakpoint
  const resolveValue = useCallback(
    (prop: number | ResponsiveValue | undefined, defaultValue: number): number => {
      if (typeof prop === 'number') return prop;
      if (typeof prop === 'object' && prop) {
        if (isDesktop && prop.desktop !== undefined) return prop.desktop;
        if (isTablet && prop.tablet !== undefined) return prop.tablet;
        if (isMobile && prop.mobile !== undefined) return prop.mobile;
      }
      return defaultValue;
    },
    [isMobile, isTablet, isDesktop]
  );

  // Effective parameters (single object to keep things in sync)
  const eff = useMemo(
    () => ({
      color,
      amplitude: resolveValue(amplitude, 1),
      distance: resolveValue(distance, 0),
      scrollSensitivity: resolveValue(scrollSensitivity, 2.0),
      isVertical: isMobile,
    }),
    [color, amplitude, distance, scrollSensitivity, resolveValue, isMobile]
  );

  /* ------------------------ Effect: wait for size ------------------------ */
  useEffect(() => {
    if (isReady || !containerRef.current) return;

    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setIsReady(true);
        ro.disconnect();
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [isReady]);

  /* ---------------------- Effect: OGL bootstrap (once) ------------------- */
  useEffect(() => {
    if (useStaticImage) return;
    if (!isReady || !containerRef.current) return;
    if (programRef.current) return;

    const container = containerRef.current;
    const renderer = new Renderer({ alpha: true });
    rendererRef.current = renderer;

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.opacity = '0';
    gl.canvas.style.transition = 'opacity 450ms ease-out';
    container.appendChild(gl.canvas);

    const { clientWidth, clientHeight } = container;
    renderer.setSize(clientWidth, clientHeight);

    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        iTime: { value: 0 },
        iResolution: {
          value: new Color(clientWidth, clientHeight, clientWidth / clientHeight),
        },
        uColor: { value: new Color(...eff.color) },
        uAmplitude: { value: eff.amplitude },
        uDistance: { value: eff.distance },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uIsVertical: { value: eff.isVertical },
        uScrollOffset: { value: 0 },
        uDragOffset: { value: 0 },
      },
    });

    programRef.current = program;

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    meshRef.current = mesh;

    // Fade-in
    requestAnimationFrame(() => {
      gl.canvas.style.opacity = '1';
    });

    // Keep resolution in sync with container size
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) return;

      renderer.setSize(width, height);
      program.uniforms.iResolution.value.r = width;
      program.uniforms.iResolution.value.g = height;
      program.uniforms.iResolution.value.b = width / height;

      // In reduced motion mode, redraw once on resize to keep image sharp
      if (prefersReducedMotion) {
        renderer.render({ scene: mesh });
      }
    });

    resizeObserver.observe(container);

    lastScrollY.current = window.scrollY;

    // Static rendering branch for reduced motion
    if (prefersReducedMotion) {
      program.uniforms.iTime.value = 0;
      program.uniforms.uScrollOffset.value = 0;
      program.uniforms.uDragOffset.value = 0;
      (program.uniforms.uMouse.value as Float32Array).set([0.5, 0.5]);
      program.uniforms.uAmplitude.value = eff.amplitude;
      program.uniforms.uDistance.value = eff.distance;
      program.uniforms.uIsVertical.value = eff.isVertical;

      renderer.render({ scene: mesh });

      return () => {
        resizeObserver.disconnect();
        if (container.contains(gl.canvas)) container.removeChild(gl.canvas);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        programRef.current = null;
        rendererRef.current = null;
        meshRef.current = null;
      };
    }

        const SCROLL_IDLE_MS = 120;
        const FPS_IDLE = 60;
        const FPS_SCROLL = 45;

    const markScrolling = () => {
      isUserScrollingRef.current = true;

      if (scrollIdleTimerRef.current) {
        window.clearTimeout(scrollIdleTimerRef.current);
      }

      scrollIdleTimerRef.current = window.setTimeout(() => {
        isUserScrollingRef.current = false;
        scrollIdleTimerRef.current = null;
      }, SCROLL_IDLE_MS);
    };

    const handleScroll = () => {
      // Mark "active scrolling" first so the RAF can downshift immediately
      markScrolling();

      const y = window.scrollY;
      const dy = y - lastScrollY.current;
      scrollVelocity.current += dy * scrollSensRef.current;
      lastScrollY.current = y;
    };

    const passiveOptions = { passive: true as const };
    window.addEventListener('scroll', handleScroll, passiveOptions);

    // On some trackpads, wheel bursts are the real signal of “user is scrolling now”
    window.addEventListener('wheel', markScrolling, passiveOptions);

    let currentScroll = 0;

    // Time accumulator (so we can freeze animation time during scroll without “jumping”)
    let lastT = performance.now();
    let timeAcc = 0;
    let lastRenderT = 0;

    const update = (t: number) => {
      const dt = t - lastT;
      lastT = t;

      const scrolling = isUserScrollingRef.current;
      const targetFps = scrolling ? FPS_SCROLL : FPS_IDLE;
      const minFrameMs = 1000 / targetFps;

      // Skip renders while scrolling to keep page scroll silky
      if (t - lastRenderT < minFrameMs) {
        animationFrameId.current = requestAnimationFrame(update);
        return;
      }
      lastRenderT = t;

      // Keep the inertia stable even when we render at 30fps
      const baseFrameMs = 1000 / 60;
      const frameScale = dt / baseFrameMs;

      const dampingPerFrame = 0.93;
      const damping = Math.pow(dampingPerFrame, frameScale);

      // Scroll inertia
      currentScroll += scrollVelocity.current * frameScale;
      scrollVelocity.current *= damping;
      if (Math.abs(scrollVelocity.current) < 0.01) scrollVelocity.current = 0;
      program.uniforms.uScrollOffset.value = currentScroll * 0.0001;

      // Mouse: fixed centered value (no pointer listeners)
      (program.uniforms.uMouse.value as Float32Array).set([0.5, 0.5]);

      // Live parameters from refs
      program.uniforms.uAmplitude.value = amplitudeRef.current;
      program.uniforms.uDistance.value = distanceRef.current;
      program.uniforms.uIsVertical.value = isVerticalRef.current;

      // Advance time ONLY when not actively scrolling
      if (!scrolling) timeAcc += dt;
      program.uniforms.iTime.value = timeAcc * 0.0002;

      renderer.render({ scene: mesh });
      animationFrameId.current = requestAnimationFrame(update);
    };

    animationFrameId.current = requestAnimationFrame(update);

    return () => {
      resizeObserver.disconnect();

      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }

      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('wheel', markScrolling);

      if (scrollIdleTimerRef.current) {
        window.clearTimeout(scrollIdleTimerRef.current);
        scrollIdleTimerRef.current = null;
      }

      if (container.contains(gl.canvas)) container.removeChild(gl.canvas);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      programRef.current = null;
      rendererRef.current = null;
      meshRef.current = null;
    };

  }, [
    isReady,
    useStaticImage,
    prefersReducedMotion,
    eff.amplitude,
    eff.distance,
    eff.isVertical,
    eff.color,
  ]);

  /* ------------------ Effect: sync uniforms/refs (single) ------------------ */
  useEffect(() => {
    // Update refs used by handlers and RAF
    amplitudeRef.current = eff.amplitude;
    distanceRef.current = eff.distance;
    scrollSensRef.current = eff.scrollSensitivity;
    isVerticalRef.current = eff.isVertical;

    // Hot-update uniforms if program already exists
    const program = programRef.current;
    if (!program) return;

    program.uniforms.uAmplitude.value = eff.amplitude;
    program.uniforms.uDistance.value = eff.distance;
    program.uniforms.uIsVertical.value = eff.isVertical;

    // If reduced motion is on, keep the static frame in sync
    if (prefersReducedMotion && rendererRef.current && meshRef.current) {
      rendererRef.current.render({ scene: meshRef.current });
    }
  }, [eff, prefersReducedMotion]);

  // Always render the container. Reduced motion is handled by drawing a static frame.
  return (
     <div
        ref={containerRef}
        className="absolute inset-0 w-full h-full bg-black pointer-events-none"
      >
        {isReady && useStaticImage && (
          <Image
            src={staticImageSrc}
            alt=""
            fill
            priority
            sizes="100vw"
            onLoadingComplete={() => setImageLoaded(true)}
            className={
              "object-cover transition-opacity duration-400 ease-in" +
              (imageLoaded ? "opacity-100" : "opacity-0")
            }
          />
        )}
      </div>
  );
};

export default ThreadsBackground;
