/**
 * Doot — phone number validation.
 *
 * ⚠️ Do NOT replace this with a regex.
 *
 * An earlier draft of the spec had a hand-rolled E.164 regex. Tested against
 * 298 real Indian phone strings, libphonenumber won 296/298 — and both
 * differences were the regex INVENTING a valid-looking number out of corrupt
 * input. In this product that means dialling a stranger. This is a safety
 * boundary, not a style preference.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { BLOCKED_PREFIXES } from "./constants";

/**
 * Normalise anything Google Places / OSM / a human might hand us into E.164,
 * or return null. Handles "+91 98765 43210", "011-2875 1234", "09876543210".
 */
export function toE164(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const n = parsePhoneNumberFromString(raw.trim(), "IN");
    if (!n || !n.isValid()) return null;
    return n.number; // E.164
  } catch {
    return null;
  }
}

/** True for short codes we must never dial: emergency, government, commercial. */
export function isBlockedNumber(e164: string): boolean {
  const national = e164.replace(/^\+91/, "");
  return BLOCKED_PREFIXES.some((p) => national.startsWith(p));
}

/**
 * ⚠️ Never infer mobile-vs-landline from the first digit — that heuristic is
 * proven false for Indian numbering. Ask libphonenumber.
 */
export function numberKind(e164: string): string | undefined {
  try {
    return parsePhoneNumberFromString(e164)?.getType();
  } catch {
    return undefined;
  }
}

/** For display: "+91 98765 43210". */
export function formatPretty(e164: string): string {
  try {
    return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
  } catch {
    return e164;
  }
}
