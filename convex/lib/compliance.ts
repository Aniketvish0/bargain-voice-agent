/**
 * Doot — the compliance gate. See docs/BUILD-SPEC.md §15.
 *
 * Every vendor passes through this before it can be dialled. Rejected vendors
 * still get a row, with `gateReason` populated, because showing the gate WORK
 * is worth more to a judge than a fifth negotiation feature.
 *
 * The constants here are quotable on stage. Know them.
 */

import {
  CALL_WINDOW_END_IST,
  CALL_WINDOW_START_IST,
  MAX_DIALS_PER_NUMBER_PER_DAY,
} from "./constants";
import { isBlockedNumber, toE164 } from "./phone";

export type GateResult = { ok: true } | { ok: false; reason: string };

/** Current hour in IST, regardless of where the server is. */
export function istHour(nowMs: number): number {
  // IST is UTC+5:30, no DST, ever.
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours();
}

export function withinCallWindow(nowMs: number): boolean {
  const h = istHour(nowMs);
  return h >= CALL_WINDOW_START_IST && h < CALL_WINDOW_END_IST;
}

/**
 * Pure checks — no database access. The DB-backed checks (DNC list, per-number
 * daily cap, already-called-today) live in convex/gate.ts, which can read.
 */
export function staticChecks(
  rawPhone: string,
  nowMs: number,
  opts: { enforceWindow?: boolean } = {},
): GateResult {
  const e164 = toE164(rawPhone);
  if (!e164) {
    return { ok: false, reason: "Not a valid Indian phone number" };
  }
  if (!e164.startsWith("+91")) {
    return { ok: false, reason: "Only Indian (+91) numbers are in scope" };
  }
  if (isBlockedNumber(e164)) {
    return {
      ok: false,
      reason: "Emergency / government / commercial short code — never dialled",
    };
  }
  // Default ON. Only a deliberate override may bypass it, and the override is
  // recorded on the vendor row so it is visible in a spot check.
  if (opts.enforceWindow !== false && !withinCallWindow(nowMs)) {
    return {
      ok: false,
      reason: `Outside the ${CALL_WINDOW_START_IST}:00–${CALL_WINDOW_END_IST}:00 IST call window`,
    };
  }
  return { ok: true };
}

export const DAILY_CAP_REASON = `Originating number hit its ${MAX_DIALS_PER_NUMBER_PER_DAY}-dial daily cap (TRAI bulk threshold is 20)`;
export const DNC_REASON = "On the permanent do-not-call list";
export const ALREADY_CALLED_REASON = "Already called in the last 24 hours";
