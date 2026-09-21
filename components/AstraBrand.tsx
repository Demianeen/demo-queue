import Image from "next/image";

/** Original outlined artwork, kept separate from editable event names. */
export function AstraBrand({ className = "" }: { className?: string }) {
  return (
    <div className={`astra-brand ${className}`} aria-label="GPT-6 Astra">
      <Image src="/astra/gpt6-wordmark.svg" alt="GPT-6" width={132} height={40} />
      <span aria-hidden />
      <Image src="/astra/astra-wordmark.svg" alt="Astra" width={128} height={40} />
    </div>
  );
}
