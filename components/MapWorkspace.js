"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LAND_RECORDS, RECORD_SOURCE, reconcile } from "@/data/land_records";

const CadastralMap = dynamic(() => import("@/components/CadastralMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full flex items-center justify-center bg-surface">
      <span className="font-mono text-xs text-muted">loading basemap…</span>
    </div>
  ),
});

const SOURCES = [
  ["predicted", "Model extraction", "#ff8a3d"],
  ["ground_truth", "Surveyed ground truth", "#4fd1c5"],
];

export default function MapWorkspace({ parcels }) {
  const [visibleSources, setVisibleSources] = useState({ predicted: true, ground_truth: false });
  const [focusSite, setFocusSite] = useState(null);
  const [selected, setSelected] = useState(null);
  const [manualRecord, setManualRecord] = useState(null);

  // Nothing in the supplied records links an extracted polygon to a survey
  // number — that needs the village cadastral index, which we don't hold. So
  // rather than silently comparing against an arbitrary record, default to the
  // nearest registered area and say plainly that the match is by area alone.
  const autoRecord = useMemo(() => {
    if (!selected) return LAND_RECORDS[0];
    return LAND_RECORDS.reduce((best, r) =>
      Math.abs(r.areaSqm - selected.area_sqm) < Math.abs(best.areaSqm - selected.area_sqm) ? r : best
    );
  }, [selected]);
  const record = manualRecord || autoRecord;

  const sites = parcels.sites || [];
  const geo = parcels.georeferencing || {};

  const stats = useMemo(() => {
    const by = { predicted: [], ground_truth: [] };
    for (const f of parcels.features) {
      by[f.properties.source]?.push(f.properties.area_sqm);
    }
    const sum = (a) => a.reduce((s, x) => s + x, 0);
    return {
      predicted: { n: by.predicted.length, area: sum(by.predicted) },
      ground_truth: { n: by.ground_truth.length, area: sum(by.ground_truth) },
    };
  }, [parcels]);

  const check = selected ? reconcile(selected.area_sqm, record) : null;

  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b border-line px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
              Georeferenced cadastral output · WGS84
            </div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1">
              SRM KTR parcel map
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-3xl">
              {parcels.features.length} real parcel polygons across {sites.length} surveyed sites,
              rendered at their true coordinates. Model extraction and surveyed ground truth are
              separate layers — turn both on to see exactly where they agree and where they don&apos;t.
            </p>
          </div>
          <div className="flex flex-col gap-1 font-mono text-[10px] text-muted shrink-0">
            <span className="border border-line rounded px-2 py-1">
              georeference residual {geo.mean_residual_m} m (max {geo.max_residual_m} m)
            </span>
            <span className="border border-line rounded px-2 py-1">
              {geo.scale_x_m_per_px} m/px · rotation {geo.rotation_deg}°
            </span>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_360px] flex-1 min-h-[600px]">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {SOURCES.map(([id, label, color]) => (
              <button
                key={id}
                onClick={() => setVisibleSources((v) => ({ ...v, [id]: !v[id] }))}
                className={`flex items-center gap-2 font-mono text-[11px] px-3 py-2 rounded-lg border transition ${
                  visibleSources[id] ? "border-line bg-surface2" : "border-line/50 text-muted"
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ background: visibleSources[id] ? color : "transparent", border: `1px solid ${color}` }}
                />
                {label}
                <span className="text-muted">({stats[id].n})</span>
              </button>
            ))}

            <select
              value={focusSite || ""}
              onChange={(e) => setFocusSite(e.target.value || null)}
              className="font-mono text-[11px] bg-surface2 border border-line rounded-lg px-3 py-2 outline-none focus:border-accent2 ml-auto"
            >
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.site} value={s.site}>{s.site}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-h-[480px] border border-line rounded-xl overflow-hidden">
            <CadastralMap
              parcels={parcels}
              visibleSources={visibleSources}
              focusSite={focusSite}
              selectedId={selected?.id}
              onSelectParcel={setSelected}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Stat label="Extracted parcels" value={stats.predicted.n} />
            <Stat label="Extracted area" value={`${(stats.predicted.area / 10000).toFixed(2)} ha`} />
            <Stat label="Ground-truth parcels" value={stats.ground_truth.n} />
            <Stat label="Ground-truth area" value={`${(stats.ground_truth.area / 10000).toFixed(2)} ha`} />
          </div>
        </div>

        <aside className="border-t lg:border-t-0 lg:border-l border-line p-4 flex flex-col gap-4 overflow-y-auto">
          {/* Selected parcel */}
          <div>
            <h2 className="font-display font-bold text-sm mb-2">Selected parcel</h2>
            {selected ? (
              <dl className="font-mono text-[11px] text-muted flex flex-col gap-1">
                <Row k="site" v={selected.site} />
                <Row k="layer" v={selected.source === "predicted" ? "model" : "ground truth"} />
                <Row k="area" v={`${Number(selected.area_sqm).toLocaleString()} m²`} />
              </dl>
            ) : (
              <p className="text-xs text-muted">Click any parcel on the map.</p>
            )}
          </div>

          {/* Reconciliation against a registered record */}
          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-1">Reconcile with land record</h2>
            <p className="text-[11px] text-muted mb-3">
              Compares the selected parcel&apos;s extracted area against a registered Chitta area.
              Matched by <span className="text-[#e7ebf2]">nearest area only</span> — tying a parcel
              to its actual survey number needs the village cadastral index, which these four
              extracts don&apos;t contain.
            </p>

            <select
              value={record.surveyNo}
              onChange={(e) =>
                setManualRecord(LAND_RECORDS.find((r) => r.surveyNo === e.target.value) || null)
              }
              className="w-full font-mono text-[11px] bg-surface2 border border-line rounded-lg px-3 py-2 outline-none focus:border-accent2 mb-3"
            >
              {LAND_RECORDS.map((r) => (
                <option key={r.surveyNo} value={r.surveyNo}>
                  Survey {r.surveyNo} · Patta {r.pattaNo} · {r.areaSqm} m²
                </option>
              ))}
            </select>

            <dl className="font-mono text-[11px] text-muted flex flex-col gap-1 mb-3">
              <Row k="owner" v={record.owner} />
              <Row k="patta" v={record.pattaNo} />
              <Row k="classification" v={record.classification} />
              <Row k="registered area" v={`${record.areaSqm.toLocaleString()} m²`} />
              <Row k="assessment" v={`Rs-Pie ${record.fix}`} />
              {record.fmbDimensions && <Row k="FMB dims" v={record.fmbDimensions} />}
            </dl>

            {check ? (
              <div
                className={`rounded-lg border px-3 py-2.5 ${
                  check.status === "reconciled"
                    ? "border-good/40 bg-good/10"
                    : "border-bad/40 bg-bad/10"
                }`}
              >
                <div
                  className={`font-mono text-[11px] font-semibold ${
                    check.status === "reconciled" ? "text-good" : "text-bad"
                  }`}
                >
                  {check.status === "reconciled" ? "AREA CONSISTENT" : "AREA MISMATCH"}
                </div>
                <div className="font-mono text-[11px] text-muted mt-1">
                  {check.delta >= 0 ? "+" : ""}
                  {check.delta.toLocaleString()} m² ({check.ratioPct >= 0 ? "+" : ""}
                  {check.ratioPct}%) vs survey {record.surveyNo}
                </div>
                <div className="font-mono text-[10px] text-muted mt-1.5">
                  {check.status === "reconciled"
                    ? "Within 15% of a registered parcel of this size."
                    : "No registered parcel of comparable size among the four extracts held."}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted">Select a parcel to run the check.</p>
            )}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={record.fmbSketch}
              alt={`FMB sketch for survey ${record.surveyNo}`}
              className="w-full mt-3 rounded-lg border border-line bg-white"
            />
            <p className="text-[10px] text-muted mt-1.5">
              Field Measurement Book sketch, survey {record.surveyNo}
            </p>
          </div>

          {/* Provenance */}
          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">Record provenance</h2>
            <dl className="font-mono text-[10px] text-muted flex flex-col gap-1">
              <Row k="authority" v="TN Revenue & Disaster Mgmt" />
              <Row k="district" v={RECORD_SOURCE.district} />
              <Row k="village" v={RECORD_SOURCE.revenueVillage} />
              <Row k="signed by" v={RECORD_SOURCE.signedBy} />
              <Row k="signed on" v={RECORD_SOURCE.signedOn} />
            </dl>
            <p className="text-[10px] text-muted mt-2 leading-relaxed">
              Certified Chitta extracts, verifiable by reference number at{" "}
              <span className="text-accent2">eservices.tn.gov.in</span>. These are the authoritative
              figures the extraction is checked against — not model output.
            </p>
          </div>

          {/* How coordinates exist */}
          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">How this is georeferenced</h2>
            <p className="text-[11px] text-muted leading-relaxed">{geo.method}</p>
            <p className="text-[11px] text-muted leading-relaxed mt-2">
              The fit reproduces its five control points to {geo.mean_residual_m} m mean
              ({geo.max_residual_m} m worst), at {geo.scale_x_m_per_px} m/px horizontally versus{" "}
              {geo.scale_y_m_per_px} m/px vertically and {geo.rotation_deg}° of rotation — square
              pixels, north-up, which is what a correct solution should look like.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="font-mono text-[9px] text-muted uppercase tracking-wide">{label}</div>
      <div className="font-display font-bold text-sm tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0">{k}</dt>
      <dd className="text-[#e7ebf2] text-right break-words">{v}</dd>
    </div>
  );
}
