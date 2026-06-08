// Codex mark (gradient-filled via CSS mask) + eyebrow lockup for page headers.
export function Brand({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span className="codex-mark" style={{ width: 22, height: 22 }} aria-hidden />
      <span className="eyebrow" style={{ margin: 0 }}>
        {label}
      </span>
    </div>
  );
}
