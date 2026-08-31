"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { generateFeatures, findOverlaps } from "@/lib/geo";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const CAPABILITIES = [
  "Automatic extraction of parcel boundaries",
  "Identification and delineation of building footprints",
  "Detection of roads, pathways, and access corridors",
  "Classification of land-use features in urban areas",
];

const INPUTS = [
  "High-resolution drone imagery",
  "Orthorectified Imagery (ORI)",
  "DSM / DTM datasets",
  "Existing GIS parcel layers",
  "Ground Truthing (GT) datasets",
  "GNSS / CORS-enabled survey data",
];

const OUTPUTS = [
  ["AI/ML-based parcel extraction engine", "seeded demo pipeline today, trained-model swap-in documented"],
  ["GIS-ready cadastral outputs", "GeoJSON export, topology-checked"],
  ["Web-based visualization dashboard", "live Web-GIS map with edit + verification"],
  ["Automated topology validation module", "real polygon-intersection geometry via Turf.js"],
];

export default function Home() {
  const demoFeatures = useMemo(() => generateFeatures("home-overview-demo"), []);
  const demoOverlaps = useMemo(() => findOverlaps(demoFeatures), [demoFeatures]);
  const demoOverlapIds = useMemo(() => new Set(demoOverlaps.flat()), [demoOverlaps]);

  return (
    <main>
      {/* Hero */}
      <section className="px-6 pt-14 pb-10 border-b border-line max-w-5xl mx-auto">
        <div className="font-mono text-xs tracking-widest text-accent2 uppercase mb-4">
          Smart India Hackathon 2026 · Problem Statement 26012 · Team INFERICS
        </div>
        <h1 className="font-display font-extrabold text-4xl sm:text-5xl tracking-tight text-wrap-balance max-w-3xl">
          Automated cadastral mapping, from raw imagery to a verified parcel record.
        </h1>
        <p className="text-muted text-base sm:text-lg mt-5 max-w-2xl leading-relaxed">
          GeoGovGadget turns drone and satellite imagery into GIS-ready parcel boundaries,
          building footprints, and land-use classifications — with a human always verifying
          before anything counts as official record.
        </p>
        <div className="flex flex-wrap gap-3 mt-8">
          <Link
            href="/dashboard"
            className="bg-accent text-ink font-semibold text-sm px-5 py-3 rounded-lg hover:brightness-110 transition"
          >
            Open the dashboard
          </Link>
          <Link
            href="/3d-map"
            className="border border-line text-sm px-5 py-3 rounded-lg hover:bg-surface2 transition"
          >
            View 3D map
          </Link>
          <Link
            href="/assistant"
            className="border border-line text-sm px-5 py-3 rounded-lg hover:bg-surface2 transition"
          >
            Ask the AI assistant
          </Link>
        </div>
      </section>

      {/* Background */}
      <section className="px-6 py-12 border-b border-line max-w-5xl mx-auto grid md:grid-cols-2 gap-10">
        <div>
          <h2 className="font-display font-bold text-xl mb-3">Why this exists</h2>
          <p className="text-sm text-muted leading-relaxed">
            Preparing cadastral maps today relies on manual interpretation of drone imagery and
            field-based ground truthing — slow, resource-intensive, and hard to keep current.
            Dense urban settlements, irregular parcel geometries, encroachments, overlapping
            structures, and mixed land-use patterns make manual digitization even harder,
            regularly delaying survey completion and land-record updates.
          </p>
          <p className="text-sm text-muted leading-relaxed mt-3">
            High-resolution ORI, DSM/DTM, and drone datasets already exist. What's missing is an
            automated layer that turns them into preliminary parcel maps a human can verify in
            minutes instead of building from scratch in weeks.
          </p>
        </div>
        <div>
          <h2 className="font-display font-bold text-xl mb-3">Proposed solution</h2>
          <ul className="flex flex-col gap-2.5">
            {CAPABILITIES.map((c) => (
              <li key={c} className="flex items-start gap-2.5 text-sm text-[#e7ebf2]">
                <span className="w-1.5 h-1.5 rounded-full bg-accent2 mt-1.5 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Inputs / Outputs */}
      <section className="px-6 py-12 border-b border-line max-w-5xl mx-auto grid md:grid-cols-2 gap-10">
        <div>
          <h2 className="font-display font-bold text-xl mb-3">Data it works from</h2>
          <div className="flex flex-wrap gap-2">
            {INPUTS.map((i) => (
              <span
                key={i}
                className="font-mono text-[11px] border border-line bg-surface2 rounded-full px-3 py-1.5 text-muted"
              >
                {i}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h2 className="font-display font-bold text-xl mb-3">What it delivers</h2>
          <ul className="flex flex-col gap-3">
            {OUTPUTS.map(([title, note]) => (
              <li key={title}>
                <div className="text-sm font-semibold">{title}</div>
                <div className="text-xs text-muted mt-0.5">{note}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Live demo preview */}
      <section className="px-6 py-12 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-bold text-xl">See it working</h2>
          <Link href="/dashboard" className="font-mono text-xs text-accent2 hover:underline">
            open full dashboard →
          </Link>
        </div>
        <p className="text-sm text-muted mb-4 max-w-2xl">
          A sample block with parcel boundaries, building footprints, a road, and a land-use
          zone — the same view an official gets after uploading imagery, with one deliberately
          flagged overlap to show topology validation working.
        </p>
        <div className="h-[420px] border border-line rounded-xl overflow-hidden">
          <MapView
            featureCollection={demoFeatures}
            overlapIds={demoOverlapIds}
            selectedId={null}
            onSelectFeature={() => {}}
            drawMode={false}
            drawPoints={[]}
            onMapClick={() => {}}
          />
        </div>
      </section>

      <footer className="px-6 py-8 border-t border-line font-mono text-[11px] text-muted max-w-5xl mx-auto">
        GeoGovGadget · Team INFERICS · SIH 2026 · Problem Statement 26012
      </footer>
    </main>
  );
}
