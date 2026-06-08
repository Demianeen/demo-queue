import Image from "next/image";

// Codex mark + eyebrow lockup used at the top of each page card.
export function Brand({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <Image src="/codex-mark.png" alt="" aria-hidden width={22} height={22} priority />
      <span className="eyebrow" style={{ margin: 0 }}>
        {label}
      </span>
    </div>
  );
}
