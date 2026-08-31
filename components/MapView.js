"use client";

import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, Polyline, CircleMarker, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { classStyle, SITE_CENTER } from "@/lib/geo";

function ClickCatcher({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}

// Forces Leaflet to recompute its internal size after mount. Without this,
// a map created inside a flex/grid container that isn't fully laid out yet
// can end up with a stale 0-size viewport, which makes shapes render but
// stop registering clicks in the wrong place (or at all).
function InvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const id = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(id);
  }, [map]);
  return null;
}

function styleFor(feature, { overlapIds, selectedId }) {
  const cls = feature.properties.class;
  const status = feature.properties.status;
  const isOverlap = overlapIds.has(feature.properties.id);
  const isSelected = feature.properties.id === selectedId;
  const base = classStyle(cls).fill;

  let color = base;
  if (status === "approved") color = "#7fd88f";
  if (status === "rejected") color = "#e57373";

  return {
    color: isOverlap ? "#ff3b3b" : color,
    weight: isSelected ? 3.5 : isOverlap ? 2.5 : 1.6,
    dashArray: isOverlap ? "6 4" : undefined,
    fillColor: base,
    fillOpacity: status === "rejected" ? 0.08 : isSelected ? 0.5 : 0.32,
  };
}

function statusLabel(status) {
  if (status === "approved") return { text: "Approved", color: "#7fd88f" };
  if (status === "rejected") return { text: "Rejected", color: "#e57373" };
  return { text: "Pending review", color: "#8fa0bc" };
}

function popupHtml(p, { withActions }) {
  const s = statusLabel(p.status);
  const rows = [
    p.surveyNo && `<div>${p.surveyNo}</div>`,
    p.ward && `<div>${p.ward}</div>`,
    p.ownerType && `<div>${p.ownerType}</div>`,
    p.area_sqm ? `<div>${p.area_sqm} sqm</div>` : "",
    typeof p.confidence === "number" ? `<div>confidence: ${Math.round(p.confidence * 100)}%</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const actions = withActions
    ? `<div class="ggg-popup-actions">
        <button type="button" class="ggg-popup-btn ggg-approve" data-id="${p.id}">Approve</button>
        <button type="button" class="ggg-popup-btn ggg-reject" data-id="${p.id}">Reject</button>
        <button type="button" class="ggg-popup-btn ggg-delete" data-id="${p.id}">Delete</button>
      </div>`
    : "";

  return `
    <div class="ggg-popup">
      <div class="ggg-popup-title">${classStyle(p.class).label}</div>
      <div class="ggg-popup-body">${rows}</div>
      <div class="ggg-popup-status" style="color:${s.color}">${s.text}</div>
      ${actions}
    </div>
  `;
}

export default function MapView({
  featureCollection,
  overlapIds,
  selectedId,
  onSelectFeature,
  drawMode,
  drawPoints,
  onMapClick,
  onApprove,
  onReject,
  onDelete,
}) {
  const geoJsonKey = JSON.stringify({
    n: featureCollection.features.length,
    statuses: featureCollection.features.map((f) => f.properties.status).join(","),
    overlaps: Array.from(overlapIds).join(","),
  });

  const withActions = Boolean(onApprove && onReject && onDelete);
  const layersRef = useRef(new Map());
  const selectedLayerIdRef = useRef(null);

  function highlight(id, layer, feature) {
    const prevId = selectedLayerIdRef.current;
    if (prevId && prevId !== id) {
      const prevLayer = layersRef.current.get(prevId);
      const prevFeature = prevLayer?.feature;
      if (prevLayer && prevFeature) {
        prevLayer.setStyle(styleFor(prevFeature, { overlapIds, selectedId: null }));
      }
    }
    layer.setStyle(styleFor(feature, { overlapIds, selectedId: id }));
    selectedLayerIdRef.current = id;
  }

  return (
    <MapContainer
      center={[SITE_CENTER[1], SITE_CENTER[0]]}
      zoom={17}
      scrollWheelZoom
      className="h-full w-full rounded-xl"
    >
      <InvalidateSize />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {featureCollection.features.length > 0 && (
        <GeoJSON
          key={geoJsonKey}
          data={featureCollection}
          style={(feature) => styleFor(feature, { overlapIds, selectedId })}
          onEachFeature={(feature, layer) => {
            const p = feature.properties;
            layersRef.current.set(p.id, layer);

            layer.bindPopup(popupHtml(p, { withActions }), { className: "ggg-leaflet-popup" });

            layer.on("click", () => {
              onSelectFeature(p.id);
              highlight(p.id, layer, feature);
            });

            layer.on("popupopen", (e) => {
              const el = e.popup.getElement();
              if (!el) return;
              el.querySelector(".ggg-approve")?.addEventListener("click", () => {
                onApprove(p.id);
                layer.closePopup();
              });
              el.querySelector(".ggg-reject")?.addEventListener("click", () => {
                onReject(p.id);
                layer.closePopup();
              });
              el.querySelector(".ggg-delete")?.addEventListener("click", () => {
                onDelete(p.id);
                layer.closePopup();
              });
            });
          }}
        />
      )}

      {drawMode && (
        <>
          <ClickCatcher onMapClick={onMapClick} />
          {drawPoints.length > 0 && (
            <Polyline
              positions={drawPoints.map(([lng, lat]) => [lat, lng])}
              pathOptions={{ color: "#ff8a3d", weight: 2, dashArray: "4 4" }}
            />
          )}
          {drawPoints.map(([lng, lat], i) => (
            <CircleMarker
              key={i}
              center={[lat, lng]}
              radius={4}
              pathOptions={{ color: "#ff8a3d", fillColor: "#ff8a3d", fillOpacity: 1 }}
            />
          ))}
        </>
      )}
    </MapContainer>
  );
}
