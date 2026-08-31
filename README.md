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
  changes anywhere else in the app.

## Run locally

```bash
npm install
npm run dev       # http://localhost:3000
```

- Upload any image → `/api/segment` returns a GeoJSON FeatureCollection of parcels,
  buildings, roads, and land-use zones, rendered live on the map.
- Click a parcel to select it, approve/reject it, or delete it.
- "+ Add parcel manually" lets you draw a new parcel boundary by clicking points on the map.
- Overlapping parcels/buildings are outlined in red and listed under Topology Validation.
- Export GeoJSON downloads the current feature set.

## Stack

- **Next.js 14** (App Router, JavaScript) — single deployable app, API routes replace a
  separate backend, matches Vercel's zero-config deploy.
- **React-Leaflet** — the Web-GIS map.
- **Turf.js** — real polygon intersection for topology validation.
- **Tailwind CSS** — styling.

## Deployment

Repo is structured for a zero-config Vercel deploy (Next.js app lives at repo root):

1. Go to https://vercel.com/new, import `Swarnendu-Bhattacharjee/GeoGovGadget`.
2. Framework preset: Next.js (auto-detected). No environment variables required for the
   current build.
3. Deploy — Vercel builds `npm run build` and serves it. Every push to `main` auto-deploys;
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
