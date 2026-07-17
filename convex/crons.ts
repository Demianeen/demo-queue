import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "delete expired hackathon videos",
  { hours: 24 },
  internal.events.deleteExpiredHackathonVideos,
  {},
);

export default crons;
