# GeoGovGadget — Team INFERICS (SIH 2026, PS 26012)

AI-enabled automated cadastral mapping and urban parcel boundary extraction from
drone/satellite imagery — Web-GIS dashboard for reviewing, editing, and validating
AI-extracted parcel boundaries, building footprints, roads, and land-use zones.

**Live app:** Next.js, deployed on Vercel — see [Deployment](#deployment) below.

## What's real vs. what's a stand-in

Built for clarity of purpose and a working, appealing UI first — not everything needs to be
ML-powered to demonstrate the platform correctly:

- **Real:** the Web-GIS map (view + edit), the topology/overlap validation (actual polygon
  intersection geometry via Turf.js), human verification workflow (approve/reject), and
  GIS-ready GeoJSON export.
- **Demo stand-in:** the segmentation step. `POST /api/segment` returns deterministic, seeded
  polygons (same image → same layout, different images → different layouts) instead of running
  a trained Mask R-CNN/U-Net model — training and hosting a real segmentation model is out of
  scope for a same-day build. The swap-in point is documented in `lib/geo.js`
  (`generateFeatures()`) — replacing that function's body with real model output requires no
  changes anywhere else in the app. The 3D map and AI assistant read from the same generator,
  so wiring in a real model updates all three surfaces at once.

## Pages

- **`/` — Overview.** Purpose, background, proposed solution, and a live read-only demo of
  the map, for a first-time viewer (judge, official) to understand the platform in one scroll.
- **`/dashboard` — Web-GIS dashboard.** Upload imagery → `/api/segment` returns a GeoJSON
  FeatureCollection of parcels, buildings, roads, and land-use zones, rendered live on the
  map. Click a parcel to approve/reject/delete it. "+ Add parcel manually" draws a new
  boundary by clicking points on the map. Overlapping parcels/buildings are outlined in red
  and listed under Topology Validation. Includes an Analytics panel (confidence, area,
  verification counts) and a Technical panel (stack + architecture diagram link). Export
  GeoJSON downloads the current feature set.
- **`/3d-map` — 3D visualization.** MapLibre GL renders every parcel and building as an
  extruded 3D volume over a basemap — buildings taller by floor count, parcels flat at ground
  level — hover for a record, click to select. Real geometry, seeded demo data (see below).
- **`/assistant` — AI assistant.** A 24/7 natural-language query interface over the plot
  dataset (survey number, ward, ownership, status, verification date) for officials who need
  an answer in seconds. Powered by the Groq API — see [AI assistant setup](#ai-assistant-setup).

## Run locally

```bash
npm install
npm run dev       # http://localhost:3000
```

`npm run dev` is what you want day-to-day — no build step needed, hot reload on save.

**Do not run `npm start` unless you've run `npm run build` first.** `npm start` only serves
an *existing* production build; it doesn't create one. `.next/` (the build output) is
correctly gitignored and never committed, so a fresh clone has no build yet — running
`npm start` straight after cloning fails with:

```
Error: Could not find a production build in the '.next' directory.
Try building your app with 'next build' before starting the production server.
```

If you hit that, run `npm run build` once, then `npm start` works.

**Always run `npm run dev` / `npm run build` / `npm start` — never `npx next dev` or a bare
`next` command.** This project pins Next.js to `14.2.35` in `package-lock.json`. If you
instead run `next` directly (or `npx next` without `node_modules` properly installed), npx
can fetch and run whatever the latest global Next.js is instead of this project's pinned
version — a teammate hit exactly this and got Next.js 16 with Turbopack, which parses CSS
more strictly than 14's webpack pipeline and surfaced a `globals.css` ordering bug that 14
tolerated. If your terminal ever reports a Next.js version that doesn't match the
`"next"` line in `package.json`, you're not running this project's dependencies — `cd` into
the repo root, run `npm install`, and use the `npm run ...` scripts, not `next` directly.

**If you already ran `npm install next@latest` (or similar) trying to fix an earlier error**,
that rewrites your local `package.json`/`package-lock.json` to a newer, untested Next.js —
in one case this pulled in Next 16 + React 19, which `react-leaflet` v4 doesn't officially
support, and threw `Map container is already initialized` on the map pages. Undo it and
reinstall from the committed, tested versions:

```bash
git checkout -- package.json package-lock.json
rm -rf node_modules
npm install
npm run dev
```

## AI assistant setup

`/assistant` calls `POST /api/assistant`, which needs a Groq API key (get one free at
https://console.groq.com/keys):

```bash
cp .env.example .env.local
# edit .env.local, set GROQ_API_KEY=gsk_...
npm run dev
```

Without a key, the endpoint returns a clear 501 error instead of crashing — every other page
works fine with no key configured.

## Stack

- **Next.js 14** (App Router, JavaScript) — single deployable app, API routes replace a
  separate backend, matches Vercel's zero-config deploy.
- **React-Leaflet** — the 2D Web-GIS map.
- **MapLibre GL** — the 3D extruded parcel/building visualization.
- **Turf.js** — real polygon intersection for topology validation.
- **Groq API** (`llama-3.3-70b-versatile`) — the AI assistant, grounded on the plot dataset.
- **Tailwind CSS** — styling.

## Deployment

Repo is structured for a zero-config Vercel deploy (Next.js app lives at repo root):

1. Go to https://vercel.com/new, import `Swarnendu-Bhattacharjee/GeoGovGadget`.
2. Framework preset: Next.js (auto-detected).
3. Add environment variable `GROQ_API_KEY` under Project Settings → Environment Variables if
   you want `/assistant` working in production (every other page works without it).
4. Deploy — Vercel builds `npm run build` and serves it. Every push to `main` auto-deploys;
   every PR gets its own preview URL.

## Docs

- [`docs/pipeline-diagram.html`](./docs/pipeline-diagram.html) — system flow diagram
  (open in a browser or screenshot for the deck).
- [`docs/GIT_WORKFLOW.md`](./docs/GIT_WORKFLOW.md) — branching/PR rules. `main` is protected;
  work on a `yourname-thing` branch and open a PR.
- [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) — original scoping notes (superseded by this README
  where they conflict).

## Legacy

`backend/` holds an earlier Express-based API stub, superseded by the Next.js API routes in
`app/api/`. Kept for reference; not part of the deployed app.
