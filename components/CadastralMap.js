"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, Popup, ScaleControl, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Renders the georeferenced cadastral output on a real basemap.
//
// Every polygon here is a real WGS84 shape produced by
// ml/building_detector/georeference.py — the model's own extraction and the
// surveyed ground truth, both registered onto a reference Google Maps camera
// whose five control points reproduce to ~0.2 m. Nothing on this map is
// seeded or illustrative, which is why it can be compared against the
// registered land records rather than merely displayed.
// MapLibre v6 derives its worker URL from `import.meta.url` and bails to an
// empty string when that isn't an http(s) URL — which is exactly what happens
// once Next's bundler rewrites it. The worker then never starts, so every
// worker-parsed source (GeoJSON, vector tiles) silently yields nothing while
// raster tiles keep working on the main thread, with no error logged. Pointing
// it at a self-hosted copy fixes it; `npm run sync:maplibre` (wired to
// pre-dev/pre-build) keeps that copy in step with the installed package.
if (typeof window !== "undefined") {
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
}

const SOURCE_STYLE = {
  predicted: { color: "#ff8a3d", label: "Model extraction" },
  ground_truth: { color: "#4fd1c5", label: "Surveyed ground truth" },
};

export default function CadastralMap({
  parcels,
  visibleSources,
  focusSite,
  onSelectParcel,
  selectedId,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const bounds = boundsOf(parcels);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          esri: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#0b1220" } },
          { id: "esri", type: "raster", source: "esri", paint: { "raster-opacity": 0.9 } },
        ],
      },
      bounds,
      fitBoundsOptions: { padding: 60 },
      pitch: 50,
      bearing: -18,
      antialias: true,
      maxZoom: 20,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    map.on("load", () => {
      map.addSource("parcels", { type: "geojson", data: parcels });

      // Extrusion height encodes parcel area, so the size distribution reads
      // at a glance instead of requiring every polygon to be clicked.
      map.addLayer({
        id: "parcels-3d",
        type: "fill-extrusion",
        source: "parcels",
        paint: {
          "fill-extrusion-color": [
            "match", ["get", "source"],
            "predicted", SOURCE_STYLE.predicted.color,
            "ground_truth", SOURCE_STYLE.ground_truth.color,
            "#8fa0bc",
          ],
          "fill-extrusion-height": [
            "interpolate", ["linear"], ["get", "area_sqm"],
            0, 4, 500, 10, 2000, 22, 20000, 45,
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.72,
        },
      });

      map.addLayer({
        id: "parcels-outline",
        type: "line",
        source: "parcels",
        paint: {
          "line-color": ["case", ["==", ["get", "id"], selectedId ?? ""], "#ffffff", "#0b1220"],
          "line-width": ["case", ["==", ["get", "id"], selectedId ?? ""], 3, 0.8],
        },
      });

      popupRef.current = new Popup({ closeButton: false, className: "ggg-map-popup" });

      map.on("mousemove", "parcels-3d", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const p = f.properties;
        popupRef.current
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.6;color:#e7ebf2">
               <div style="color:${SOURCE_STYLE[p.source]?.color || "#fff"};font-weight:700">
                 ${SOURCE_STYLE[p.source]?.label || p.source}
               </div>
               <div>${p.site}</div>
               <div style="color:#8fa0bc">${Number(p.area_sqm).toLocaleString()} m²</div>
             </div>`
          )
          .addTo(map);
      });

      map.on("mouseleave", "parcels-3d", () => {
        map.getCanvas().style.cursor = "";
        popupRef.current?.remove();
      });

      map.on("click", "parcels-3d", (e) => {
        const f = e.features?.[0];
        if (f && onSelectParcel) onSelectParcel(f.properties);
      });

      setReady(true);
    });

    mapRef.current = map;
    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layer visibility follows the source toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const active = Object.entries(visibleSources)
      .filter(([, on]) => on)
      .map(([k]) => k);
    const filter = active.length
      ? ["in", ["get", "source"], ["literal", active]]
      : ["==", ["get", "source"], "__none__"];
    map.setFilter("parcels-3d", filter);
    map.setFilter("parcels-outline", filter);
  }, [visibleSources, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty("parcels-outline", "line-color", [
      "case", ["==", ["get", "id"], selectedId ?? ""], "#ffffff", "#0b1220",
    ]);
    map.setPaintProperty("parcels-outline", "line-width", [
      "case", ["==", ["get", "id"], selectedId ?? ""], 3, 0.8,
    ]);
  }, [selectedId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const subset = focusSite
      ? { ...parcels, features: parcels.features.filter((f) => f.properties.site === focusSite) }
      : parcels;
    map.fitBounds(boundsOf(subset), { padding: 80, duration: 1400, pitch: 50 });
  }, [focusSite, ready, parcels]);

  return <div ref={containerRef} className="h-full w-full" />;
}

function boundsOf(fc) {
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  for (const f of fc.features) {
    for (const [x, y] of f.geometry.coordinates[0]) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [[minX, minY], [maxX, maxY]];
}
