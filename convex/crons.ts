import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Safety nets. Both exist because a stalled mission is invisible — the UI just
 * sits there looking fine while nothing happens.
 */
const crons = cronJobs();

// Twilio occasionally never sends a terminal StatusCallback (dropped webhook,
// tunnel restart). Without this the mission waits forever on a call that ended
// minutes ago.
crons.interval("reap stuck calls", { seconds: 60 }, internal.calls.reapStuck, {});

export default crons;
