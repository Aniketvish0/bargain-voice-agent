import { defineSchema } from "convex/server";

// Doot — Convex schema.
// Intentionally EMPTY: no tables defined yet.
// `schemaValidation: false` keeps the deployment schemaless so tables can be
// created ad hoc during development and formally declared here later
// (see docs/DATA_MODEL.md for the planned tables).
export default defineSchema({}, { schemaValidation: false });
