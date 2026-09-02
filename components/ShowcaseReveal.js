"use client";

import { useEffect, useState } from "react";

// Real detection results from the SRM KTR campus dataset (data/IMAGES/RAW +
// data/outputs/buildings), cycling with a left-to-right wipe from the actual
// raw satellite photo to the detected boundary overlay. Every image here is
// a genuine source photo / model output, not a mockup.
const SITES = [
  { slug: "srm-global", label: "SRM Global" },
  { slug: "law-school", label: "Law School" },
  { slug: "tech-audi", label: "Tech Park 1/2 & Auditorium" },
  { slug: "bel-canteen", label: "BEL Block & Canteen" },
  { slug: "srm-dental", label: "SRM Dental College" },
];

export default function ShowcaseReveal() {
  const [index, setIndex] = useState(0);
  const [wipe, setWipe] = useState(0);

  useEffect(() => {
    let raf;
    let start = null;
    const cycleMs = 4200;

    function tick(ts) {
      if (start === null) start = ts;
      const elapsed = (ts - start) % cycleMs;
      setWipe(Math.min(100, (elapsed / (cycleMs * 0.7)) * 100));
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index]);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SITES.length), 4200);
    return () => clearInterval(id);
  }, []);

  const site = SITES[index];

  return (
    <div className="relative rounded-xl overflow-hidden border border-line aspect-[9/7] bg-surface">
      <img
        src={`/showcase/${site.slug}/raw.jpg`}
        alt={`${site.label} — raw satellite photo`}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}
      >
        <img
          src={`/showcase/${site.slug}/overlay.jpg`}
          alt={`${site.label} — detected boundaries`}
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
      <div
        className="absolute inset-y-0 w-[2px] bg-accent2 shadow-[0_0_12px_2px_rgba(79,209,197,0.7)]"
        style={{ left: `${wipe}%` }}
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-ink/90 to-transparent px-4 py-3">
        <div className="font-mono text-[10px] text-accent2 uppercase tracking-widest">
          Real detection · SRM KTR campus
        </div>
        <div className="font-display font-bold text-sm mt-0.5">{site.label}</div>
      </div>
    </div>
  );
}
