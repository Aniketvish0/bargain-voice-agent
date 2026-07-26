/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export. The landing page has no server features, and exporting it
  // lets the marketing site and the Vite console ship as one static bundle
  // behind a single domain — see scripts/build-vercel.sh.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
