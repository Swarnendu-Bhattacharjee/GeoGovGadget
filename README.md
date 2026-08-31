# GeoGovGadget — Team INFERICS (SIH 2026, PS 26012)

AI-enabled automated cadastral mapping and urban parcel boundary extraction from
drone/satellite imagery.

See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for scope, roles, and today's timeline.
See [`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md) for the backend↔frontend contract.
See [`docs/GIT_WORKFLOW.md`](./docs/GIT_WORKFLOW.md) for branching/PR rules — `main` is
protected, everyone else works on a `yourname-thing` branch and opens a PR.
See [`docs/pipeline-diagram.html`](./docs/pipeline-diagram.html) for the system flow
diagram (open it in a browser, or screenshot it for the deck).

## Backend (stub, live)

```bash
cd backend
npm install
npm start        # listens on :4000
```

- `GET /health`
- `POST /segment` (multipart `image` field) → hardcoded GeoJSON polygons + overlap flags
- `GET /parcels`
- `POST /verify/:id`

The `/segment` handler currently returns fixed sample polygons so frontend work isn't
blocked on the ML pipeline. Swap the body of that handler in `backend/server.js` for
real model output — response shape stays the same.

## Frontend

TBD — React + Leaflet dashboard, to be scaffolded in `frontend/`.

## ML / Edge

TBD — see `ml/` and `edge/`.
