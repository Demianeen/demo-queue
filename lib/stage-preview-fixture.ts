import type { StagePresentationData, StageSubmissionData } from "@/lib/stage-presentation";
import type { VisualStyle } from "@/lib/visual-style";

function previewSubmissionId(id: string): StageSubmissionData["id"] {
  return id as StageSubmissionData["id"];
}

const SAMPLE_LINEUP: StageSubmissionData[] = [
  {
    id: previewSubmissionId("preview-signal-relay"),
    name: "Maya Chen",
    teamName: "Trailblazers",
    demoTitle: "Signal Relay",
    description: "Low-latency telemetry for off-grid teams and devices.",
    category: "Developer tools",
    githubUrl: undefined,
    status: "queued",
    queueOrder: 1,
  },
  {
    id: previewSubmissionId("preview-trailhead"),
    name: "Noah Williams",
    teamName: "North Star",
    demoTitle: "Trailhead",
    description: "Outdoor navigation companion",
    category: "Consumer",
    githubUrl: undefined,
    status: "queued",
    queueOrder: 2,
  },
  {
    id: previewSubmissionId("preview-basecamp"),
    name: "Sam Lee",
    teamName: "Basecamp",
    demoTitle: "Basecamp",
    description: "Team coordination, offline-first",
    category: "Productivity",
    githubUrl: undefined,
    status: "queued",
    queueOrder: 3,
  },
  {
    id: previewSubmissionId("preview-northline"),
    name: "Jordan Taylor",
    teamName: "Northline",
    demoTitle: "Northline",
    description: "Maps and routing for field teams",
    category: "Infrastructure",
    githubUrl: undefined,
    status: "queued",
    queueOrder: 4,
  },
  {
    id: previewSubmissionId("preview-echo-point"),
    name: "Alex Morgan",
    teamName: "Echo Point",
    demoTitle: "Echo Point",
    description: "Environmental audio logging",
    category: "Climate",
    githubUrl: undefined,
    status: "queued",
    queueOrder: 5,
  },
];

export function buildStagePreviewFixture({
  eventName,
  eventType,
  visualStyle,
  meetUrl,
}: {
  eventName: string;
  eventType: "demo" | "hackathon";
  visualStyle: VisualStyle;
  meetUrl: string;
}): StagePresentationData {
  const resolvedMeetUrl = meetUrl.trim() || null;

  return {
    event: {
      name: eventName.trim() || "Frontier Hack",
      slug: "preview",
      eventType,
      visualStyle,
      queuePublished: true,
      stageScreenMode: "demo",
      showSubmissionCountOnStage: false,
      showMeetLinkOnStage: Boolean(resolvedMeetUrl),
      showStageTimerOnStage: false,
      showDemoTimerOnStage: false,
    },
    stageTimer: {
      status: "idle",
      durationMs: 5 * 60 * 1000,
      remainingMs: 5 * 60 * 1000,
      endsAt: undefined,
      serverNow: Date.now(),
    },
    demoTimer: {
      status: "idle",
      durationMs: 2 * 60 * 1000,
      remainingMs: 2 * 60 * 1000,
      endsAt: undefined,
      serverNow: Date.now(),
    },
    current: SAMPLE_LINEUP[0],
    upNext: SAMPLE_LINEUP[1],
    lineup: SAMPLE_LINEUP,
    remainingCount: SAMPLE_LINEUP.length,
    waitingCount: 12,
    meetUrl: resolvedMeetUrl,
  };
}
