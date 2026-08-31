/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict Mode's dev-only double-mount can race react-leaflet's map
  // creation/cleanup (a known react-leaflet v4 incompatibility, worse under
  // React 19 / Turbopack) and throw "Map container is already initialized".
  // Off for this reason, not out of general preference.
  reactStrictMode: false,
};

module.exports = nextConfig;
