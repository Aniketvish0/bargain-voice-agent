import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

if (!url) {
  document.getElementById("root")!.innerHTML = `
    <div class="gate">
      <h1>Missing VITE_CONVEX_URL</h1>
      <p>The dashboard needs your Convex deployment URL. Create <code>web/.env.local</code>:</p>
      <code>VITE_CONVEX_URL=https://your-deployment.convex.cloud</code>
      <p style="margin-top:16px">Note it is <b>.convex.cloud</b> for the browser client —
      the bridge uses <b>.convex.site</b> for httpActions.</p>
    </div>`;
} else {
  const convex = new ConvexReactClient(url);
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    </React.StrictMode>,
  );
}
