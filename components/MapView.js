"use client";

import { MapContainer, TileLayer, GeoJSON, Polyline, CircleMarker, useMapEvents } from "react-leaflet";
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
    fillOpacity: status === "rejected" ? 0.08 : isSelected ? 0.45 : 0.28,
  };
}

export default function MapView({
  featureCollection,
  overlapIds,
  selectedId,
  onSelectFeature,
  drawMode,
  drawPoints,
  onMapClick,
}) {
  const geoJsonKey = JSON.stringify({
    n: featureCollection.features.length,
    statuses: featureCollection.features.map((f) => f.properties.status).join(","),
    overlaps: Array.from(overlapIds).join(","),
    selectedId,
  });

  return (
    <MapContainer
      center={[SITE_CENTER[1], SITE_CENTER[0]]}
      zoom={17}
      scrollWheelZoom
      className="h-full w-full rounded-xl"
    >
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
            layer.bindTooltip(`${classStyle(p.class).label} · ${Math.round((p.confidence || 0) * 100)}%`, {
              sticky: true,
            });
            layer.on("click", () => onSelectFeature(p.id));
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
