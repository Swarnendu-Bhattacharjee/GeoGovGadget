"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SITE_CENTER, classStyle } from "@/lib/geo";
import { SRM_CAMPUS_CENTER, srmSiteFeatures } from "@/data/srm_sites";

// A real 3D map, not a screenshot: MapLibre GL renders parcels and building
// footprints as extruded 3D volumes over a raster basemap, colored by class
// and height-coded (buildings taller by floor count, parcels as flat
// ground plates). This is the swap-in target for the trained model's
// per-plot output once it exists — the extrusion layer only cares about
// GeoJSON polygons with a heightM property.
export default function Map3D({ featureCollection, onSelectFeature, view = "demo" }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: "&copy; OpenStreetMap contributors",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#0b1220" } },
          { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.55 } },
        ],
      },
      center: SITE_CENTER,
      zoom: 17.3,
      pitch: 60,
      bearing: -22,
      antialias: true,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      const polys = {
        type: "FeatureCollection",
        features: featureCollection.features.filter((f) => f.geometry.type === "Polygon"),
      };

      map.addSource("plots", { type: "geojson", data: polys });

      map.addLayer({
        id: "plots-extrusion",
        type: "fill-extrusion",
        source: "plots",
        paint: {
          "fill-extrusion-color": [
            "match",
            ["get", "class"],
            "building_footprint",
            classStyle("building_footprint").fill,
            "parcel_boundary",
            classStyle("parcel_boundary").fill,
            "land_use",
            classStyle("land_use").fill,
            "#e7ebf2",
          ],
          "fill-extrusion-height": ["coalesce", ["get", "heightM"], 1],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.86,
        },
      });

      map.addLayer({
        id: "plots-outline",
        type: "line",
        source: "plots",
        paint: { "line-color": "#0b1220", "line-width": 1 },
      });

      const popup = new Popup({ closeButton: false, closeOnClick: false });

      map.on("mousemove", "plots-extrusion", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties;
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.6;color:#e7ebf2">
              <div style="font-weight:600;color:#4fd1c5">${classStyle(p.class).label}</div>
              <div>${p.surveyNo || ""}</div>
              <div>${p.ward || ""}</div>
              ${p.area_sqm ? `<div>${p.area_sqm} sqm</div>` : ""}
              <div>status: ${p.status}</div>
            </div>`
          )
          .addTo(map);
      });

      map.on("mouseleave", "plots-extrusion", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });

      map.on("click", "plots-extrusion", (e) => {
        const f = e.features?.[0];
        if (f && onSelectFeature) onSelectFeature(f.properties.id);
      });

      // Real SRM KTR campus sites — pins, not extruded footprints, since
      // there's no real geo-referenced building geometry to extrude here
      // (see data/srm_sites.js for why the coordinates are approximate).
      for (const site of srmSiteFeatures()) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:14px;height:14px;border-radius:50%;background:#ff8a3d;border:2px solid #0b1220;box-shadow:0 0 0 3px rgba(255,138,61,0.35);cursor:pointer";

        const popup = new Popup({ offset: 14, closeButton: true, maxWidth: "200px" })
          .setHTML(`
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;line-height:1.45;color:#e7ebf2;max-height:min(50vh,320px);overflow-y:auto">
            <img src="${site.thumb}" alt="${site.name}" style="width:100%;height:64px;object-fit:cover;border-radius:5px;margin-bottom:5px;display:block" />
            <div style="font-weight:700;color:#4fd1c5;font-family:'Archivo',sans-serif;font-size:11.5px">${site.name}</div>
            <div style="color:#ff8a3d;margin-top:3px">📍 ${
              site.confidence === "landmark" ? "anchored to a named landmark" : "estimated from layout"
            }, not survey-grade</div>
            <div style="margin-top:4px">${site.buildingsPlotted} clean / ${site.buildingsRaw} raw detections</div>
            <div style="margin-top:3px;color:#8fa0bc">Sqft/floors/ownership: pending</div>
          </div>
        `);

        const marker = new Marker({ element: el }).setLngLat([site.lng, site.lat]).setPopup(popup).addTo(map);
        markersRef.current.push(marker);
      }
    });

    mapRef.current = map;
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (view === "srm") {
      map.flyTo({ center: SRM_CAMPUS_CENTER, zoom: 15.8, pitch: 55, bearing: -12, duration: 1400 });
    } else {
      map.flyTo({ center: SITE_CENTER, zoom: 17.3, pitch: 60, bearing: -22, duration: 1400 });
    }
  }, [view]);

  return <div ref={containerRef} className="h-full w-full rounded-xl" />;
}
