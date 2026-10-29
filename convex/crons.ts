import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "delete expired hackathon videos",
  { hours: 24 },
  internal.events.deleteExpiredHackathonVideos,
  {},
);

crons.interval(
  "delete orphaned submission uploads",
  { hours: 24 },
  internal.events.deleteOrphanedSubmissionUploads,
  {},
);

crons.interval(
  "tidy away old practice events",
  { hours: 24 },
  internal.practice.tidyPracticeEvents,
  {},
);

export default crons;
