import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The console is served under /console/ on the combined deployment, so asset
  // URLs must be prefixed. Left at "/" for `vite dev` so localhost still works.
  base: process.env.CONSOLE_BASE ?? "/",
  server: { port: 5173 },
});
