"use client";

import { useEffect, useRef, useState } from "react";
import { StagePresentation } from "@/components/StagePresentation";
import type { StagePresentationData } from "@/lib/stage-presentation";

const PREVIEW_WIDTH = 1440;

export function StagePresentationPreview({
  stage,
  submissionUrl,
}: {
  stage: StagePresentationData;
  submissionUrl: string;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = () => setScale(viewport.clientWidth / PREVIEW_WIDTH);
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="shared-stage-preview" ref={viewportRef}>
      <div
        className="shared-stage-preview-canvas"
        style={{ transform: `scale(${scale})` }}
      >
        <StagePresentation embedded stage={stage} submissionUrl={submissionUrl} />
      </div>
    </div>
  );
}
