"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Console } from "@/components/console/Console";
import { ErrorBoundary } from "@/components/console/ErrorBoundary";
import "./console.css";

/**
 * /console — the working console, wired to Convex.
 *
 * The landing page's `<Console/>` section is a static mockup of this; this is
 * the real thing. Its stylesheet is imported HERE rather than in the root
 * layout so the console's design tokens and the marketing site's never fight:
 * both define `--r`, `--ok`, `.btn` and friends with different values.
 */

const url = process.env.NEXT_PUBLIC_CONVEX_URL;

// Module scope, so one client is shared across renders rather than rebuilt on
// each one (a new ConvexReactClient per render tears down every subscription).
const client = url ? new ConvexReactClient(url) : null;

export default function ConsolePage() {
  if (!client) {
    return (
      <div className="gate">
        <h1>Missing NEXT_PUBLIC_CONVEX_URL</h1>
        <p>
          The console needs your Convex deployment URL. Create{" "}
          <code>frontend/.env.local</code>:
        </p>
        <code>NEXT_PUBLIC_CONVEX_URL=https://careful-fly-767.convex.cloud</code>
        <p style={{ marginTop: 16 }}>
          Note it is <b>.convex.cloud</b> for the browser client — the bridge uses{" "}
          <b>.convex.site</b> for httpActions.
        </p>
      </div>
    );
  }

  return (
    <ConvexProvider client={client}>
      <ErrorBoundary>
        <Console />
      </ErrorBoundary>
    </ConvexProvider>
  );
}
