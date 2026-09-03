/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict Mode's dev-only double-mount can race react-leaflet's map
  // creation/cleanup (a known react-leaflet v4 incompatibility, worse under
  // React 19 / Turbopack) and throw "Map container is already initialized".
  // Off for this reason, not out of general preference.
  reactStrictMode: false,

  // The browser engine pulls ~57MB of ONNX weights plus ~14MB of wasm runtime.
  // Neither filename is content-hashed, so these are not marked immutable —
  // a re-export has to be able to win — but an hour of freshness with a day of
  // stale-while-revalidate keeps a reload from refetching 70MB.
  async headers() {
    return [
      {
        source: "/:dir(models|ort)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
