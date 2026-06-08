import type { CSSProperties } from "react";

// Shimmer placeholder block. Compose several to mirror a page's real layout so
// the loading state reads as "content arriving" instead of a bare "Loading...".
export function Skeleton({
  w,
  h,
  radius,
  onDark,
  style,
}: {
  w?: number | string;
  h?: number | string;
  radius?: number | string;
  onDark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`skeleton${onDark ? " on-dark" : ""}`}
      style={{ width: w ?? "100%", height: h ?? 16, borderRadius: radius, ...style }}
    />
  );
}
