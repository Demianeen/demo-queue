import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

export type StagePresentationData = NonNullable<FunctionReturnType<typeof api.events.getStage>>;
export type StageSubmissionData = StagePresentationData["lineup"][number];
export type StageTimerData = StagePresentationData["stageTimer"];
