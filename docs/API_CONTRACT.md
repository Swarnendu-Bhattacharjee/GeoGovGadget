# API Contract — GeoGovGadget backend

Base URL (local dev): `http://localhost:4000`

Frontend (Aditi) should build against this contract now. Backend currently returns
hardcoded GeoJSON (`backend/server.js`) — Pranjal's real model output will be swapped
in behind the same shape, so nothing on the frontend needs to change later.

## `GET /health`
Returns `{ "status": "ok" }`. Use to confirm the server is up.

## `POST /segment`
Multipart form upload, field name `image`. Runs (today: fakes) segmentation on the
uploaded image and returns detected polygons plus any overlap flags.

**Response:**
```json
{
  "imageId": "uuid",
  "filename": "uploaded-file.jpg",
  "polygons": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "properties": {
          "id": "uuid",
          "class": "building_footprint | parcel_boundary",
          "confidence": 0.94,
          "status": "pending"
        },
        "geometry": { "type": "Polygon", "coordinates": [[[lng, lat], ...]] }
      }
    ]
  },
  "overlaps": [["featureIdA", "featureIdB"]]
}
```

## `GET /parcels`
Returns every parcel feature currently held server-side, as a GeoJSON
`FeatureCollection`. Use this to repopulate the map on page load without re-uploading.

## `POST /verify/:id`
Body: `{ "status": "approved" | "rejected" | "pending" }`
Marks a single parcel's human-verification status. Returns the updated feature.

## Notes for frontend
- `properties.class` drives polygon color: building_footprint vs parcel_boundary.
- `properties.status` drives polygon color/opacity: pending (yellow) / approved (green)
  / rejected (red) — pick actual colors, this is just the state machine.
- Any pair of feature IDs in the top-level `overlaps` array should render both polygons
  with a warning outline (e.g. red dashed border) regardless of their individual status.
- Coordinates are `[lng, lat]` GeoJSON order (not `[lat, lng]`) — Leaflet needs them
  flipped when constructing `L.latLng`.
