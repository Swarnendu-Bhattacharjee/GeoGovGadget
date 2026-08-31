"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { generateFeatures, classStyle } from "@/lib/geo";

const Map3D = dynamic(() => import("@/components/Map3D"), { ssr: false });

export default function ThreeDMapPage() {
  const featureCollection = useMemo(() => generateFeatures("3d-map-demo"), []);
  const [selectedId, setSelectedId] = useState(null);

  const selected = featureCollection.features.find((f) => f.properties.id === selectedId);

  return (
    <main className="min-h-screen">
      <header className="border-b border-line px-6 py-5">
        <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
          3D Cadastral Visualization
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1">
          Parcel &amp; building matrix
        </h1>
        <p className="text-muted text-sm mt-1 max-w-2xl">
          Every extracted parcel and building rendered as an extruded 3D volume over the base
          map — building height reflects estimated floor count, parcel plates sit flat at
          ground level. Hover a shape for its record, click to select it below.
        </p>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0 lg:h-[calc(100vh-97px)]">
        <div className="p-4 min-h-[500px]">
          <div className="h-full min-h-[480px] border border-line rounded-xl overflow-hidden">
            <Map3D featureCollection={featureCollection} onSelectFeature={setSelectedId} />
          </div>
        </div>

        <aside className="border-t lg:border-t-0 lg:border-l border-line p-4 flex flex-col gap-4">
          <div>
            <h2 className="font-display font-bold text-sm mb-2">Legend</h2>
            <div className="flex flex-col gap-1.5">
              {["parcel_boundary", "building_footprint", "land_use"].map((cls) => (
                <div key={cls} className="flex items-center gap-2 text-xs text-muted">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: classStyle(cls).fill }} />
                  {classStyle(cls).label}
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">Selected</h2>
            {selected ? (
              <div className="flex flex-col gap-1 font-mono text-[11px] text-muted">
                <div className="text-[#e7ebf2] font-semibold text-xs mb-1">
                  {classStyle(selected.properties.class).label}
                </div>
                <div>{selected.properties.surveyNo}</div>
                <div>{selected.properties.ward}</div>
                <div>{selected.properties.ownerType}</div>
                {selected.properties.area_sqm && <div>{selected.properties.area_sqm} sqm</div>}
                {selected.properties.floors && <div>{selected.properties.floors} floors</div>}
                <div>last verified: {selected.properties.lastVerified}</div>
              </div>
            ) : (
              <p className="text-xs text-muted">Click a shape on the map to see its record.</p>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">How this reads</h2>
            <p className="text-xs text-muted leading-relaxed">
              This block's layout comes from the same seeded demo generator as the dashboard
              (see <code className="text-accent2">lib/geo.js</code>) — every shape here is a real
              GeoJSON polygon with real geometry, not a static image. Wiring in a trained
              segmentation model changes only where that GeoJSON comes from; this view renders
              whatever it's given.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
