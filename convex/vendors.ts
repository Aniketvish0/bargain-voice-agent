import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { toE164 } from "./lib/phone";
import { MAX_VENDORS_PER_MISSION } from "./lib/constants";

/**
 * Vendor discovery. BUILD-SPEC §11.
 *
 * Three sources, tried in order of reliability rather than richness:
 *   1. `leads` table  — hand-verified, seeded from OSM. Always works.
 *   2. Google Places  — better coverage, but billing is a hard gate.
 *   3. (nothing)      — surfaces an honest "no businesses found".
 *
 * Measured coverage today: Goa hotels 82 numbers, HSR restaurants 32,
 * Karol Bagh appliances 3. Lead demos with categories that have data.
 */

export type Candidate = {
  name: string;
  phoneE164: string;
  address?: string;
  sourceUrl?: string;
  source: "curated" | "osm" | "places";
};

export const fromLeads = internalQuery({
  args: { category: v.string(), locality: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Candidate[]> => {
    const all = await ctx.db.query("leads").collect();
    const cat = args.category.toLowerCase();
    const loc = args.locality.toLowerCase();

    const scored = all
      .map((l) => {
        let score = 0;
        const lc = l.category.toLowerCase();
        if (lc === cat) score += 3;
        else if (lc.includes(cat) || cat.includes(lc)) score += 2;
        const ll = `${l.locality} ${l.city}`.toLowerCase();
        if (loc && (ll.includes(loc) || loc.includes(l.city.toLowerCase()))) score += 3;
        // Pre-consented businesses go first — they are the safest to demo with.
        if (l.consentObtained) score += 1;
        return { l, score };
      })
      .filter((x) => x.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, args.limit ?? MAX_VENDORS_PER_MISSION);

    return scored.map(({ l }) => ({
      name: l.name,
      phoneE164: l.phoneE164,
      address: l.address,
      sourceUrl: l.sourceUrl,
      source: l.source,
    }));
  },
});

/**
 * Google Places Text Search (New).
 *
 * ⚠️ Phone numbers live in the ENTERPRISE field-mask SKU. Asking for them
 *    promotes the whole request to that tier — but you get the number in the
 *    SAME call, with no per-result Place Details round-trip.
 * ⚠️ Billing must be enabled or you get 403 PERMISSION_DENIED regardless of
 *    key validity. Returns [] rather than throwing so the leads fallback runs.
 */
export const fromPlaces = internalAction({
  args: { category: v.string(), locality: v.string(), limit: v.optional(v.number()) },
  handler: async (_ctx, args): Promise<Candidate[]> => {
    const key = process.env.GOOGLE_PLACES_KEY;
    if (!key) return [];

    try {
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.internationalPhoneNumber",
            "places.rating",
            "places.userRatingCount",
            "places.businessStatus",
            "places.googleMapsUri",
          ].join(","),
        },
        body: JSON.stringify({
          textQuery: `${args.category} in ${args.locality}`,
          regionCode: "IN",
          languageCode: "en",
          maxResultCount: 20,
        }),
      });

      if (!res.ok) {
        console.warn(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return [];
      }

      const data = await res.json();
      return (data.places ?? [])
        .filter((p: any) => p.businessStatus === "OPERATIONAL")
        .filter((p: any) => p.internationalPhoneNumber)
        .filter((p: any) => (p.userRatingCount ?? 0) >= 5) // kills ghost listings
        .sort(
          (a: any, b: any) =>
            (b.rating ?? 0) * Math.log1p(b.userRatingCount ?? 0) -
            (a.rating ?? 0) * Math.log1p(a.userRatingCount ?? 0),
        )
        .slice(0, args.limit ?? MAX_VENDORS_PER_MISSION)
        .map((p: any): Candidate | null => {
          const e164 = toE164(p.internationalPhoneNumber);
          if (!e164) return null;
          return {
            name: p.displayName?.text ?? "Unknown",
            phoneE164: e164,
            address: p.formattedAddress,
            sourceUrl: p.googleMapsUri,
            source: "places" as const,
          };
        })
        .filter(Boolean) as Candidate[];
    } catch (err) {
      console.warn("Places lookup failed", err);
      return [];
    }
  },
});

/** Write the shortlist, gate-checking each one. Rejects keep a row. */
export const insertForMission = internalMutation({
  args: {
    missionId: v.id("missions"),
    candidates: v.array(
      v.object({
        name: v.string(),
        phoneE164: v.string(),
        address: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        source: v.union(v.literal("curated"), v.literal("osm"), v.literal("places")),
        gatePassed: v.boolean(),
        gateReason: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"vendors">[]> => {
    const ids: Id<"vendors">[] = [];
    let rank = 0;
    const seen = new Set<string>();
    for (const c of args.candidates) {
      if (seen.has(c.phoneE164)) continue; // one call per number, always
      seen.add(c.phoneE164);
      ids.push(
        await ctx.db.insert("vendors", {
          missionId: args.missionId,
          name: c.name,
          phoneE164: c.phoneE164,
          address: c.address,
          sourceUrl: c.sourceUrl,
          source: c.source,
          rank: rank++,
          gatePassed: c.gatePassed,
          gateReason: c.gateReason,
        }),
      );
    }
    return ids;
  },
});

export const forMission = internalQuery({
  args: { missionId: v.id("missions") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("vendors")
      .withIndex("by_mission_rank", (q) => q.eq("missionId", args.missionId))
      .collect(),
});

/** Bulk-load the OSM seed. Idempotent on phone number. */
export const upsertLeads = internalMutation({
  args: {
    rows: v.array(
      v.object({
        category: v.string(),
        locality: v.string(),
        city: v.string(),
        name: v.string(),
        phoneE164: v.string(),
        address: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
        source: v.union(v.literal("curated"), v.literal("osm")),
        consentObtained: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ inserted: number; skipped: number }> => {
    const existing = new Set((await ctx.db.query("leads").collect()).map((l) => l.phoneE164));
    let inserted = 0;
    let skipped = 0;
    for (const r of args.rows) {
      const e164 = toE164(r.phoneE164);
      if (!e164 || existing.has(e164)) {
        skipped++;
        continue;
      }
      existing.add(e164);
      await ctx.db.insert("leads", {
        category: r.category,
        locality: r.locality,
        city: r.city,
        name: r.name,
        phoneE164: e164,
        address: r.address,
        sourceUrl: r.sourceUrl,
        source: r.source,
        consentObtained: r.consentObtained ?? false,
      });
      inserted++;
    }
    return { inserted, skipped };
  },
});
