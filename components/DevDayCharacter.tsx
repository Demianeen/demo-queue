"use client";

import { useEffect, useId, useRef, type PointerEvent } from "react";
import {
  DEVDAY_CHARACTERS,
  DEVDAY_EYE_OFFSET,
  DEVDAY_GAZE_LIMIT,
  DEVDAY_GLYPHS,
  type DevDayGlyph,
  type DevDayVariant,
} from "@/lib/devday-glyphs";

export type DevDayCharacterProps = {
  variant?: DevDayVariant;
  className?: string;
  interactive?: boolean;
  label?: string;
};

import {
  DEVDAY_LOOK_DURATION, DEVDAY_WINK_PEAK,
  sampleDevDayLook, sampleDevDayWink, sampleDevDayBlink,
  settleMotion, type WinkSide,
} from "@/lib/devday-motion";

type Controller = {
  look: (x: number, y: number) => void;
  release: () => void;
  wink: () => void;
};

function Eye({ kind, side }: { kind: DevDayGlyph; side: WinkSide }) {
  const glyph = DEVDAY_GLYPHS[kind];
  return (
    <g data-eye={side} transform={`translate(${side === "left" ? -DEVDAY_EYE_OFFSET : DEVDAY_EYE_OFFSET} 0)`}>
      <g data-eye-fold="">
        <path
          d={glyph.path}
          transform={`translate(${-glyph.width / 2 + glyph.offsetX} -27.5)`}
          fillRule="evenodd"
        />
      </g>
      <rect
        data-eye-lid=""
        x={-11.225}
        y={glyph.opticalY - 2.025}
        width={22.45}
        height={4.05}
        opacity={0}
      />
    </g>
  );
}

/** Circular source geometry, bounded face motion, and finite gestures with real rest. */
export function DevDayCharacter({
  variant = "purple",
  className = "",
  interactive = true,
  label,
}: DevDayCharacterProps) {
  const clipId = `devday-clip-${useId().replace(/:/g, "")}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const controller = useRef<Controller | null>(null);
  const character = DEVDAY_CHARACTERS[variant];

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !interactive) return;
    const face = svg.querySelector<SVGGElement>("[data-face]");
    if (!face) return;
    const eyes = (["left", "right"] as const).map((side, index) => ({
      side,
      kind: character.eyes[index],
      glyph: DEVDAY_GLYPHS[character.eyes[index]],
      group: svg.querySelector<SVGGElement>(`[data-eye="${side}"]`)!,
      fold: svg.querySelector<SVGGElement>(`[data-eye="${side}"] [data-eye-fold]`)!,
      lid: svg.querySelector<SVGRectElement>(`[data-eye="${side}"] [data-eye-lid]`)!,
    }));
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const variantIndex = Object.keys(DEVDAY_CHARACTERS).indexOf(variant);
    let frame: number | null = null;
    let blinkTimer: ReturnType<typeof setTimeout> | null = null;
    let performanceTimer: ReturnType<typeof setTimeout> | null = null;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    let lastFrame = 0;
    let blinkAt = -Infinity;
    let winkAt = -Infinity;
    let sequenceAt = -Infinity;
    let winkSide: WinkSide = "left";
    let performanceCount = 0;
    let disposed = false;
    let inView = true;
    let engaged = false;
    const canAnimate = () => !disposed && !media.matches && !document.hidden && inView;

    function paint(now: number) {
      const age = (now - winkAt) / 1000;
      const wink = sampleDevDayWink(age, winkSide);
      const winking = age > -0.48 && age < 1.2;
      const blink = winking ? 0 : sampleDevDayBlink((now - blinkAt) / 1000);
      const roll = x * 0.025 + wink.roll;
      face!.setAttribute("transform", `translate(${x * DEVDAY_GAZE_LIMIT} ${y * DEVDAY_GAZE_LIMIT + 3.3 * wink.nod}) rotate(${roll * 180 / Math.PI})`);

      for (const eye of eyes) {
        const near = eye.side === winkSide;
        const sign = eye.side === "left" ? -1 : 1;
        const inset = near ? 50 * wink.depth * 1.875 : 0;
        const scale = near ? 1 + wink.depth : 1 - wink.depth * 0.4375;
        eye.group.setAttribute("transform", `translate(${sign * (DEVDAY_EYE_OFFSET - inset)} 0) scale(${scale})`);
        // The orange dash pair stays its source expression, including during a wink.
        const amount = eye.kind === "-" ? 0 : Math.max(blink, near ? wink.closure : 0);
        const fold = settleMotion(amount / 0.72);
        const lid = settleMotion((amount - 0.18) / 0.54);
        eye.fold.setAttribute("opacity", String(1 - fold));
        eye.fold.setAttribute("transform", `translate(0 ${eye.glyph.opticalY}) scale(${1 - 0.12 * fold} ${1 - 0.5 * fold}) translate(0 ${-eye.glyph.opticalY})`);
        eye.lid.setAttribute("opacity", String(lid));
      }
    }

    function tick(now: number) {
      frame = null;
      if (!canAnimate()) return;
      const sequenceAge = (now - sequenceAt) / 1000;
      const performing = sequenceAge >= 0 && sequenceAge < DEVDAY_LOOK_DURATION;
      if (performing) {
        const pose = sampleDevDayLook(sequenceAge);
        targetX = pose.x;
        targetY = pose.y;
      } else if (Number.isFinite(sequenceAt)) {
        sequenceAt = -Infinity;
        targetX = targetY = 0;
      }
      const dt = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      const follow = 1 - Math.exp(-14 * dt);
      x += (targetX - x) * follow;
      y += (targetY - y) * follow;
      const moving = Math.hypot(targetX - x, targetY - y) > 0.001;
      if (!moving) { x = targetX; y = targetY; }
      paint(now);
      if (performing || moving || now < winkAt + 1200 || now < blinkAt + 240) {
        frame = requestAnimationFrame(tick);
      }
    }

    function wake() {
      if (!canAnimate() || frame !== null) return;
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    }

    function schedulePerformance(delay: number) {
      if (performanceTimer !== null) clearTimeout(performanceTimer);
      performanceTimer = null;
      if (!canAnimate() || engaged) return;
      performanceTimer = setTimeout(() => {
        performanceTimer = null;
        if (!canAnimate() || engaged) return;
        sequenceAt = performance.now();
        winkAt = sequenceAt + DEVDAY_WINK_PEAK * 1000;
        winkSide = (variantIndex + performanceCount) % 2 === 0 ? "left" : "right";
        performanceCount += 1;
        blinkAt = -Infinity;
        wake();
        // A complete performance followed by a genuine quiet hold, staggered by character.
        schedulePerformance(DEVDAY_LOOK_DURATION * 1000 + 6500 + Math.random() * 4500);
      }, delay);
    }

    function scheduleBlink(first = false) {
      if (!canAnimate()) return;
      blinkTimer = setTimeout(() => {
        blinkTimer = null;
        if (!canAnimate()) return;
        if (!Number.isFinite(sequenceAt)) {
          blinkAt = performance.now();
          wake();
        }
        scheduleBlink();
      }, first ? 7200 + variantIndex * 810 : 6200 + Math.random() * 4100);
    }

    function interruptPerformance() {
      if (performanceTimer !== null) clearTimeout(performanceTimer);
      performanceTimer = null;
      sequenceAt = -Infinity;
      // Finish a wink already in progress, rather than snapping the head back.
      if (performance.now() < winkAt - 480) winkAt = -Infinity;
    }

    function reset() {
      if (frame !== null) cancelAnimationFrame(frame);
      if (blinkTimer !== null) clearTimeout(blinkTimer);
      if (performanceTimer !== null) clearTimeout(performanceTimer);
      frame = blinkTimer = performanceTimer = null;
      x = y = targetX = targetY = 0;
      blinkAt = winkAt = sequenceAt = -Infinity;
      paint(performance.now());
    }

    function restart() {
      reset();
      scheduleBlink(true);
      schedulePerformance(650 + variantIndex * 430);
    }

    controller.current = {
      look(nextX, nextY) {
        if (!canAnimate()) return;
        engaged = true;
        interruptPerformance();
        const length = Math.max(1, Math.hypot(nextX, nextY));
        targetX = nextX / length;
        targetY = nextY / length;
        wake();
      },
      release() {
        engaged = false;
        targetX = targetY = 0;
        wake();
        schedulePerformance(2800 + variantIndex * 430);
      },
      wink() {
        const now = performance.now();
        if (!canAnimate() || (now >= winkAt - 480 && now < winkAt + 1050)) return;
        interruptPerformance();
        winkSide = targetX > 0 ? "right" : "left";
        targetX = targetY = 0;
        winkAt = now + 480;
        blinkAt = -Infinity;
        wake();
      },
    };
    media.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting === inView) return;
      inView = entry.isIntersecting;
      restart();
    });
    observer.observe(svg);
    restart();
    return () => {
      disposed = true;
      reset();
      controller.current = null;
      observer.disconnect();
      media.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
    };
  }, [character, interactive, variant]);

  function lookAtPointer(event: PointerEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    controller.current?.look(
      (event.clientX - box.left - box.width / 2) / (box.width / 2),
      (event.clientY - box.top - box.height / 2) / (box.height / 2),
    );
  }

  const artwork = (
    <svg ref={svgRef} viewBox="-50 -50 100 100" width="100%" height="100%" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <defs><clipPath id={clipId}><circle r={50} /></clipPath></defs>
      <circle r={50} fill={character.color} />
      <g clipPath={`url(#${clipId})`} fill={character.ink}>
        <g data-face="">
          <Eye kind={character.eyes[0]} side="left" />
          <Eye kind={character.eyes[1]} side="right" />
        </g>
      </g>
    </svg>
  );

  const classes = `devday-character ${className}`.trim();
  if (!interactive) {
    return <span className={classes} aria-hidden="true" style={{ display: "block", aspectRatio: "1" }}>{artwork}</span>;
  }

  return (
    <button
      type="button"
      className={`${classes} focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current`}
      aria-label={label ?? `Make the ${variant} character wink`}
      style={{ display: "block", aspectRatio: "1", padding: 0, border: 0, borderRadius: "50%", background: "transparent", cursor: "pointer" }}
      onPointerEnter={lookAtPointer}
      onPointerMove={lookAtPointer}
      onPointerLeave={() => controller.current?.release()}
      onPointerCancel={() => controller.current?.release()}
      onFocus={() => controller.current?.look(0, 0)}
      onBlur={() => controller.current?.release()}
      onClick={() => controller.current?.wink()}
    >
      {artwork}
    </button>
  );
}

export default DevDayCharacter;
