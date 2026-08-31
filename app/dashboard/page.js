"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { classStyle, findOverlaps } from "@/lib/geo";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const EMPTY_FC = { type: "FeatureCollection", features: [] };

export default function Dashboard() {
  const [featureCollection, setFeatureCollection] = useState(EMPTY_FC);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploadedName, setUploadedName] = useState(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const fileInputRef = useRef(null);

  const overlaps = useMemo(() => findOverlaps(featureCollection), [featureCollection]);
  const overlapIds = useMemo(() => new Set(overlaps.flat()), [overlaps]);

  const counts = useMemo(() => {
    const c = { parcel_boundary: 0, building_footprint: 0, road: 0, land_use: 0 };
    for (const f of featureCollection.features) {
      if (c[f.properties.class] !== undefined) c[f.properties.class]++;
    }
    return c;
  }, [featureCollection]);

  const analytics = useMemo(() => {
    const withConfidence = featureCollection.features.filter((f) => typeof f.properties.confidence === "number");
    const avgConfidence = withConfidence.length
      ? withConfidence.reduce((s, f) => s + f.properties.confidence, 0) / withConfidence.length
      : 0;
    const totalArea = featureCollection.features
      .filter((f) => typeof f.properties.area_sqm === "number")
      .reduce((s, f) => s + f.properties.area_sqm, 0);
    const wardSet = new Set(featureCollection.features.map((f) => f.properties.ward).filter(Boolean));
    const verified = featureCollection.features.filter((f) => f.properties.status !== "pending").length;
    return { avgConfidence, totalArea, wardCount: wardSet.size, verified, total: featureCollection.features.length };
  }, [featureCollection]);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setSelectedId(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/segment", { method: "POST", body });
      const data = await res.json();
      setFeatureCollection(data.polygons);
      setUploadedName(file.name);
    } finally {
      setLoading(false);
    }
  }

  function setStatus(id, status) {
    setFeatureCollection((fc) => ({
      ...fc,
      features: fc.features.map((f) =>
        f.properties.id === id ? { ...f, properties: { ...f.properties, status } } : f
      ),
    }));
  }

  function deleteFeature(id) {
    setFeatureCollection((fc) => ({
      ...fc,
      features: fc.features.filter((f) => f.properties.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  }

  function handleMapClick(lngLat) {
    setDrawPoints((pts) => [...pts, lngLat]);
  }

  function finishDrawing() {
    if (drawPoints.length < 3) {
      setDrawMode(false);
      setDrawPoints([]);
      return;
    }
    const ring = [...drawPoints, drawPoints[0]];
    const id = `manual-${Date.now()}`;
    const newFeature = {
      type: "Feature",
      properties: { id, class: "parcel_boundary", confidence: 1, status: "approved", drawn: true },
      geometry: { type: "Polygon", coordinates: [ring] },
    };
    setFeatureCollection((fc) => ({ ...fc, features: [...fc.features, newFeature] }));
    setDrawMode(false);
    setDrawPoints([]);
  }

  function cancelDrawing() {
    setDrawMode(false);
    setDrawPoints([]);
  }

  function exportGeoJSON() {
    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geogovgadget-parcels.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedFeature = featureCollection.features.find((f) => f.properties.id === selectedId);

  return (
    <main className="min-h-screen">
      <header className="border-b border-line px-6 py-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
            Extraction &amp; Verification Dashboard
          </div>
          <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1">
            Web-GIS Dashboard
          </h1>
          <p className="text-muted text-sm mt-1 max-w-xl">
            Upload imagery, review extracted boundaries on the map, verify or correct them, and
            export GIS-ready output.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-accent text-ink font-semibold text-sm px-4 py-2.5 rounded-lg hover:brightness-110 transition"
            disabled={loading}
          >
            {loading ? "Extracting…" : "Upload imagery"}
          </button>
          <button
            onClick={exportGeoJSON}
            disabled={featureCollection.features.length === 0}
            className="border border-line text-sm px-4 py-2.5 rounded-lg hover:bg-surface2 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export GeoJSON
          </button>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-0">
        <div className="p-4 flex flex-col gap-3 min-h-[520px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatPill label="Parcels" value={counts.parcel_boundary} color="#ff8a3d" />
            <StatPill label="Buildings" value={counts.building_footprint} color="#4fd1c5" />
            <StatPill label="Roads" value={counts.road} color="#8fa0bc" />
            <StatPill label="Land-use zones" value={counts.land_use} color="#7fd88f" />
            <StatPill label="Overlaps flagged" value={overlaps.length} color="#ff3b3b" warn />
            <div className="ml-auto flex items-center gap-2">
              {!drawMode ? (
                <button
                  onClick={() => setDrawMode(true)}
                  className="font-mono text-xs px-3 py-2 rounded-lg border border-accent text-accent hover:bg-accent hover:text-ink transition"
                >
                  + Add parcel manually
                </button>
              ) : (
                <>
                  <span className="font-mono text-xs text-muted">
                    click map to add points ({drawPoints.length})
                  </span>
                  <button
                    onClick={finishDrawing}
                    className="font-mono text-xs px-3 py-2 rounded-lg bg-good text-ink"
                  >
                    Finish
                  </button>
                  <button
                    onClick={cancelDrawing}
                    className="font-mono text-xs px-3 py-2 rounded-lg border border-line"
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="min-h-[420px] h-[55vh] border border-line rounded-xl overflow-hidden">
            {featureCollection.features.length === 0 ? (
              <EmptyState onUpload={() => fileInputRef.current?.click()} />
            ) : (
              <MapView
                featureCollection={featureCollection}
                overlapIds={overlapIds}
                selectedId={selectedId}
                onSelectFeature={setSelectedId}
                drawMode={drawMode}
                drawPoints={drawPoints}
                onMapClick={handleMapClick}
              />
            )}
          </div>
          {uploadedName && (
            <p className="font-mono text-[11px] text-muted">
              source: {uploadedName} · demo-mode segmentation (see lib/geo.js) · overlap check is
              live geometry via Turf.js
            </p>
          )}

          <AnalyticsPanel analytics={analytics} counts={counts} />
          <TechnicalPanel />
        </div>

        <aside className="border-t lg:border-t-0 lg:border-l border-line p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h2 className="font-display font-bold text-sm mb-2">Topology validation</h2>
            {overlaps.length === 0 ? (
              <p className="text-xs text-muted">
                No overlapping parcel or building geometries detected.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {overlaps.map(([a, b]) => (
                  <li
                    key={`${a}-${b}`}
                    className="font-mono text-[11px] text-bad bg-[#2a1414] border border-bad/40 rounded-md px-2.5 py-1.5"
                  >
                    encroachment risk: {a} ↔ {b}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">
              Detected features ({featureCollection.features.length})
            </h2>
            <ul className="flex flex-col gap-1.5">
              {featureCollection.features.map((f) => (
                <li
                  key={f.properties.id}
                  onClick={() => setSelectedId(f.properties.id)}
                  className={`cursor-pointer rounded-md px-2.5 py-2 border text-xs flex items-center justify-between gap-2 transition ${
                    selectedId === f.properties.id
                      ? "border-accent2 bg-surface2"
                      : "border-line hover:bg-surface2"
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: classStyle(f.properties.class).fill }}
                    />
                    <span className="truncate">{classStyle(f.properties.class).label}</span>
                  </span>
                  <StatusBadge status={f.properties.status} />
                </li>
              ))}
            </ul>
          </div>

          {selectedFeature && (
            <div className="border-t border-line pt-4">
              <h2 className="font-display font-bold text-sm mb-2">Selected parcel</h2>
              <div className="text-xs text-muted font-mono mb-1">id: {selectedFeature.properties.id}</div>
              <div className="text-xs text-muted font-mono mb-1">
                survey no: {selectedFeature.properties.surveyNo}
              </div>
              <div className="text-xs text-muted font-mono mb-1">{selectedFeature.properties.ward}</div>
              <div className="text-xs text-muted font-mono mb-1">
                owner: {selectedFeature.properties.ownerType}
              </div>
              {selectedFeature.properties.area_sqm && (
                <div className="text-xs text-muted font-mono mb-1">
                  area: {selectedFeature.properties.area_sqm} sqm
                </div>
              )}
              <div className="text-xs text-muted font-mono mb-3">
                confidence: {Math.round((selectedFeature.properties.confidence || 0) * 100)}% · last
                verified: {selectedFeature.properties.lastVerified}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStatus(selectedFeature.properties.id, "approved")}
                  className="flex-1 text-xs font-semibold bg-good text-ink rounded-md py-2 hover:brightness-110"
                >
                  Approve
                </button>
                <button
                  onClick={() => setStatus(selectedFeature.properties.id, "rejected")}
                  className="flex-1 text-xs font-semibold bg-bad text-ink rounded-md py-2 hover:brightness-110"
                >
                  Reject
                </button>
                <button
                  onClick={() => deleteFeature(selectedFeature.properties.id)}
                  className="text-xs font-semibold border border-line rounded-md px-3 hover:bg-surface2"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function AnalyticsPanel({ analytics, counts }) {
  const maxCount = Math.max(1, ...Object.values(counts));
  return (
    <div className="border border-line rounded-xl p-4">
      <h2 className="font-display font-bold text-sm mb-3">Analytics</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <MetricCard label="Avg. confidence" value={`${Math.round(analytics.avgConfidence * 100)}%`} />
        <MetricCard label="Total area" value={`${analytics.totalArea.toLocaleString()} sqm`} />
        <MetricCard label="Wards covered" value={analytics.wardCount} />
        <MetricCard label="Verified" value={`${analytics.verified}/${analytics.total}`} />
      </div>
      <div className="flex flex-col gap-2">
        {Object.entries(counts).map(([cls, val]) => (
          <div key={cls} className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted w-32 shrink-0">{classStyle(cls).label}</span>
            <div className="flex-1 h-2.5 bg-surface2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(val / maxCount) * 100}%`, background: classStyle(cls).fill }}
              />
            </div>
            <span className="font-mono text-[11px] text-muted w-6 text-right">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="bg-surface2 rounded-lg px-3 py-2.5">
      <div className="font-mono text-[10px] text-muted uppercase tracking-wide">{label}</div>
      <div className="font-display font-bold text-lg mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function TechnicalPanel() {
  const stack = [
    ["Next.js 14", "App Router, deployed on Vercel"],
    ["React-Leaflet", "Web-GIS map rendering"],
    ["Turf.js", "real polygon topology validation"],
    ["MapLibre GL", "3D parcel visualization"],
    ["Groq LLM API", "AI assistant over parcel records"],
  ];
  return (
    <div className="border border-line rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-sm">Technical stack</h2>
        <Link href="/docs/pipeline-diagram.html" target="_blank" className="font-mono text-[11px] text-accent2 hover:underline">
          view architecture diagram →
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {stack.map(([name, desc]) => (
          <div key={name} className="bg-surface2 border border-line rounded-lg px-3 py-2">
            <div className="font-mono text-xs text-accent2">{name}</div>
            <div className="text-[11px] text-muted mt-0.5">{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatPill({ label, value, color, warn }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-xs ${
        warn && value > 0 ? "border-bad text-bad" : "border-line text-muted"
      }`}
    >
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}: <span className="text-[#e7ebf2] font-semibold">{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: { text: "pending", cls: "text-muted border-line" },
    approved: { text: "approved", cls: "text-good border-good/40" },
    rejected: { text: "rejected", cls: "text-bad border-bad/40" },
  };
  const s = map[status] || map.pending;
  return (
    <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${s.cls}`}>
      {s.text}
    </span>
  );
}

function EmptyState({ onUpload }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-surface text-center px-6">
      <div className="font-mono text-xs text-accent2 uppercase tracking-widest">No imagery loaded</div>
      <p className="text-muted text-sm max-w-sm">
        Upload a drone or satellite image to run parcel &amp; building extraction and see results
        on the map.
      </p>
      <button
        onClick={onUpload}
        className="bg-accent text-ink font-semibold text-sm px-4 py-2.5 rounded-lg hover:brightness-110 transition"
      >
        Upload imagery
      </button>
    </div>
  );
}
