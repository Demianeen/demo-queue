"use client";

import { useEffect, useRef } from "react";
import type {
  AstraAnimationState,
  AstraConfig,
  AstraFrameInput,
  AstraRenderer,
} from "@/lib/vendor/astra-launch.mjs";

type AstraEngine = typeof import("@/lib/vendor/astra-launch.mjs");

/** Original launch artwork, with an optional, locally bundled particle scene. */
export function AstraBackdrop({ animated = true }: { animated?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (container) container.dataset.renderer = "poster";
    if (!container || !canvas || !animated) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 767px)");
    const viewport = { width: 1, height: 1 };
    const released = new WeakSet<{ dispose(): void }>();
    let engine: AstraEngine | undefined;
    let scene: AstraRenderer | undefined;
    let animation: AstraAnimationState | undefined;
    let config: AstraConfig | undefined;
    let input: AstraFrameInput | undefined;
    let disposed = false;
    let failed = false;
    let loading = false;
    let ready = false;
    let visible = false;
    let measurable = false;
    let generation = 0;
    let frame = 0;
    let previousTime: number | undefined;
    let sizeKey = "";

    function mark(status: "poster" | "loading" | "webgl" | "fallback") {
      container!.dataset.renderer = status;
    }

    function release(resource: { dispose(): void } | undefined) {
      if (!resource || released.has(resource)) return;
      released.add(resource);
      try { resource.dispose(); } catch { /* A lost context may already be released. */ }
    }

    function stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      previousTime = undefined;
    }

    function releaseScene() {
      ++generation;
      stop();
      loading = false;
      ready = false;
      release(animation);
      release(scene);
      animation = undefined;
      scene = undefined;
      sizeKey = "";
    }

    function eligible() {
      return !disposed && !failed && !motion.matches && !compact.matches;
    }

    function active() {
      return eligible() && visible && measurable && !document.hidden;
    }

    function fallback() {
      failed = true;
      releaseScene();
      if (!disposed) mark("fallback");
    }

    function schedule() {
      if (active() && ready && !frame) frame = window.requestAnimationFrame(tick);
    }

    function paint(delta: number) {
      if (!engine || !scene || !animation || !config || !input) return;
      engine.updateAstraAnimation({
        state: animation,
        config,
        input,
        camera: scene.camera,
        animationRoot: scene.animationRoot,
        spinRoot: scene.spinRoot,
        field: scene.field,
        viewport,
      }, delta, delta);
      scene.render(delta, animation, config, false);
    }

    function tick(now: number) {
      frame = 0;
      if (!active() || !ready) return;
      const delta = previousTime === undefined ? 0 : Math.min(Math.max((now - previousTime) / 1000, 0), 0.05);
      previousTime = now;
      try {
        paint(delta);
        mark("webgl");
      } catch {
        fallback();
        return;
      }
      schedule();
    }

    function measure() {
      const bounds = canvas!.getBoundingClientRect();
      measurable = bounds.width > 0 && bounds.height > 0;
      viewport.width = Math.max(1, Math.round(bounds.width));
      viewport.height = Math.max(1, Math.round(bounds.height));
      if (input) input.heroViewportHeight = viewport.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const nextSize = `${viewport.width}:${viewport.height}:${dpr}`;
      if (ready && scene && nextSize !== sizeKey) {
        try {
          scene.resize(viewport.width, viewport.height, dpr);
          sizeKey = nextSize;
        } catch {
          fallback();
        }
      }
    }

    async function initialize() {
      if (!active() || loading || ready) return;
      const revision = ++generation;
      loading = true;
      mark("loading");
      let created: AstraRenderer | undefined;
      try {
        engine = await import("@/lib/vendor/astra-launch.mjs");
        if (disposed || revision !== generation) return;
        if (!active()) {
          loading = false;
          mark("poster");
          return;
        }
        config = { ...engine.DEFAULT_ASTRA_HERO_DATA };
        input = engine.createAstraFrameInput();
        input.reducedMotion = false;
        input.progress = 0;
        input.tiltProgress = 0;
        input.scatterProgress = 0;
        input.heroViewportHeight = viewport.height;
        created = engine.createAstraRenderer(canvas!, config, {
          tier: 2,
          canUseWebGL: () => true,
          getPostprocessing: () => "selective",
          getAntialias: () => false,
          getDpr: () => [1, 1.5],
          getMaxParticleCount: () => 28000,
          getMaxShaderSamples: () => 8,
          shouldUseContinuousMotion: () => !motion.matches,
        });
        scene = created;
        await created.ready;
        if (disposed || revision !== generation) {
          release(created);
          return;
        }
        animation = engine.createAstraAnimationState(config);
        // Start with the complete six so changing themes never obscures a demo.
        animation.introElapsed = config.convergeDuration;
        animation.introProgress = 1;
        ready = true;
        loading = false;
        measure();
        schedule();
      } catch {
        release(created);
        if (!disposed && revision === generation) fallback();
      }
    }

    function reconcile() {
      stop();
      if (disposed) return;
      if (!eligible()) {
        releaseScene();
        mark(failed ? "fallback" : "poster");
        return;
      }
      measure();
      if (active()) {
        if (ready) schedule();
        else void initialize();
      }
    }

    function contextLost(event: Event) {
      event.preventDefault();
      fallback();
    }

    const bounds = container.getBoundingClientRect();
    visible = bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      reconcile();
    });
    intersection.observe(container);
    const resize = new ResizeObserver(reconcile);
    resize.observe(canvas);
    document.addEventListener("visibilitychange", reconcile);
    motion.addEventListener("change", reconcile);
    compact.addEventListener("change", reconcile);
    canvas.addEventListener("webglcontextlost", contextLost);
    reconcile();

    return () => {
      disposed = true;
      intersection.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      motion.removeEventListener("change", reconcile);
      compact.removeEventListener("change", reconcile);
      canvas.removeEventListener("webglcontextlost", contextLost);
      releaseScene();
    };
  }, [animated]);

  return (
    <div ref={containerRef} className="astra-backdrop" data-renderer="poster" data-animated={animated} aria-hidden="true">
      <picture className="astra-backdrop__artwork">
        <source media="(prefers-reduced-motion: reduce), (max-width: 767px)" srcSet="/astra/gpt6-astra-background.webp" />
        {/* This decorative image must stay independent from canvas initialization. */}
        <img className="astra-backdrop__poster" src={animated ? "/astra/launch-poster.webp" : "/astra/gpt6-astra-background.webp"} alt="" width={2560} height={1440} decoding="async" />
      </picture>
      {animated ? <canvas ref={canvasRef} className="astra-backdrop__canvas" /> : null}
    </div>
  );
}
