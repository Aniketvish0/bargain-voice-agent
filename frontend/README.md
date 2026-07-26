# Orydl

The calling envoy landing page. Built with Next.js 14 (App Router), React 18, and TypeScript.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Build

```bash
npm run build
npm run start
```

## Notes

- Dark theme is the default; a nav toggle switches to the warm light theme and persists the choice in `localStorage` (no flash on load via an inline script in the root layout).
- Fonts are loaded with `next/font/google` (IBM Plex Mono as the primary voice, IBM Plex Sans for display headlines).
- Static images live in `public/assets`.
