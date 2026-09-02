"use client";

import { useEffect, useRef, useState } from "react";

// The hero visual: a real SRM KTR capture with a scan line sweeping across it,
// revealing the model's own extracted parcel boundaries behind the sweep.
// Both frames are genuine artefacts — the raw satellite capture and the
// detector's rendered output — so the headline animation is showing the
// actual product, not a designed impression of one.
const SITES = [
  { slug: "srm-global", label: "SRM Global Hospitals", parcels: 6 },
  { slug: "law-school", label: "SRM School of Law", parcels: 29 },
  { slug: "tech-audi", label: "Tech Park & Auditorium", parcels: 23 },
  { slug: "bel-canteen", label: "BEL Block & Canteen", parcels: 10 },
  { slug: "srm-dental", label: "SRM Dental College", parcels: 17 },
];

const CYCLE_MS = 5000;

export default function HeroScan() {
  const [index, setIndex] = useState(0);
  const [sweep, setSweep] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    let raf;
    function tick(ts) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      if (elapsed >= CYCLE_MS) {
        startRef.current = ts;
        setIndex((i) => (i + 1) % SITES.length);
      }
      // Sweep completes in the first 70% of the cycle, then holds so the
      // finished extraction is readable before the next site.
      setSweep(Math.min(1, (elapsed % CYCLE_MS) / (CYCLE_MS * 0.7)));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const site = SITES[index];
  const pct = sweep * 100;

  return (
    <div className="relative rounded-2xl overflow-hidden border border-line bg-surface aspect-[4/3] shadow-2xl shadow-black/40">
      {/* raw capture */}
      <img
        src={`/showcase/${site.slug}/raw.jpg`}
        alt={`${site.label} — raw satellite capture`}
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* extracted boundaries, revealed behind the sweep */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <img
          src={`/showcase/${site.slug}/overlay.jpg`}
          alt={`${site.label} — extracted parcel boundaries`}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* scan line */}
      {pct < 99.5 && (
        <div
          className="absolute inset-y-0 w-px bg-accent2"
          style={{ left: `${pct}%`, boxShadow: "0 0 20px 4px rgba(79,209,197,0.65)" }}
        />
      )}

      {/* corner brackets — a survey framing cue */}
      <div className="absolute inset-4 pointer-events-none">
        {[
          "top-0 left-0 border-t-2 border-l-2",
          "top-0 right-0 border-t-2 border-r-2",
          "bottom-0 left-0 border-b-2 border-l-2",
          "bottom-0 right-0 border-b-2 border-r-2",
        ].map((cls) => (
          <span key={cls} className={`absolute w-6 h-6 border-accent2/70 ${cls}`} />
        ))}
      </div>

      {/* caption */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/85 to-transparent px-5 pt-10 pb-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] text-accent2 uppercase tracking-[0.18em]">
              Live model output · SRM KTR
            </div>
            <div className="font-display font-bold text-base mt-1">{site.label}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-display font-extrabold text-2xl tabular-nums leading-none">
              {Math.round(site.parcels * sweep)}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">parcels</div>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5">
          {SITES.map((s, i) => (
            <span
              key={s.slug}
              className={`h-0.5 flex-1 rounded-full transition-colors ${
                i === index ? "bg-accent2" : "bg-line"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
