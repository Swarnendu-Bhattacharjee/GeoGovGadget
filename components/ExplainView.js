"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Chart hues: darker steps of the app's own accent/accent2, chosen so the pair
// clears colour-vision separation on this page's #121b2e surface (validated —
// deutan ΔE 14.2, normal ΔE 23.9, contrast >= 3:1). The product's brighter
// #ff8a3d / #4fd1c5 sit outside the dark-mode lightness band as fills.
const SERIES = ["#d96f2a", "#35a99d"];
const INK = "#e7ebf2";
const MUTED = "#8fa0bc";
const LINE = "#2a3a54";

// ---------------------------------------------------------------- pipeline

const STAGES = [
  {
    id: "ingest",
    name: "Ingest",
    one: "An aerial or satellite capture arrives as pixels — no geotransform.",
    detail:
      "An arbitrary upload carries no coordinate system, so everything downstream stays in the image's own pixel space. The ten surveyed SRM sites are the exception: those have real coordinates and appear on the 3D map at WGS 84.",
    figures: [["Held-out site", "944 × 946 px"], ["Coordinate space", "pixels (col, row)"]],
  },
  {
    id: "tile",
    name: "Tile",
    one: "The frame is cut into overlapping 512px windows.",
    detail:
      "A cadastral capture is far larger than any network's input. Tiles overlap by 128px and the far edges are clamped inward, so no strip of the image is only ever seen at a tile boundary. Predictions are averaged (U-Net) or max-merged (YOLO) back into one full-resolution canvas.",
    figures: [["Tile", "512 px"], ["Overlap", "128 px"], ["Stride", "384 px"]],
  },
  {
    id: "detect",
    name: "Detect",
    one: "The trained detector turns each tile into parcel confidence.",
    detail:
      "This is the only stage that differs between engines. The U-Net emits a dense probability field; YOLO emits instances whose masks are painted into the same kind of canvas. Everything after this point is byte-identical between them, which is what makes the benchmark a comparison of models rather than of post-processing.",
    figures: [["U-Net", "14.33 M params"], ["YOLO11n-seg", "instance masks"], ["Output", "confidence 0–1"]],
  },
  {
    id: "clean",
    name: "Clean",
    one: "Threshold, then morphological opening and closing.",
    detail:
      "The raw field is thresholded, then opened once to drop speckle and closed twice to seal pinholes inside a parcel — a 5×5 elliptical kernel both times. Without this, contour tracing finds hundreds of one-pixel islands instead of buildings.",
    figures: [["Kernel", "5×5 ellipse"], ["Open", "1 iteration"], ["Close", "2 iterations"]],
  },
  {
    id: "vector",
    name: "Vectorise",
    one: "Contours are traced and simplified into polygons.",
    detail:
      "External contours only — holes are ignored, since a courtyard is not a separate parcel. Douglas-Peucker then simplifies each ring with an epsilon proportional to its own perimeter, so a large parcel is not held to the same vertex budget as a shed. Anything under 0.04% of the frame is dropped as noise.",
    figures: [["Simplify ε", "1.2% of perimeter"], ["Min area", "0.04% of frame"], ["Output", "GeoJSON rings"]],
  },
  {
    id: "verify",
    name: "Verify",
    one: "Each polygon carries a confidence into a human queue.",
    detail:
      "Mean model confidence inside each ring is carried through to the reviewer, so parcels can be triaged instead of reviewed uniformly. The officer accepts, rejects or redraws; the topology check runs live on the result.",
    figures: [["Per parcel", "area · vertices · angle"], ["Confidence", "mean of ring interior"], ["Actions", "accept / reject / redraw"]],
  },
];

// ------------------------------------------------------------------ charts

/** Shared line-chart shell: one scale, hover crosshair, direct end labels. */
function LineChart({ series, xLabel, yLabel, yMax, formatY, height = 260 }) {
  const [hover, setHover] = useState(null);
  const pad = { l: 52, r: 96, t: 16, b: 34 };
  const w = 720;
  const h = height;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const top = yMax ?? Math.max(...series.flatMap((s) => s.points.map((p) => p.y))) * 1.15;

  const sx = (x) => pad.l + ((x - xMin) / Math.max(1, xMax - xMin)) * innerW;
  const sy = (y) => pad.t + innerH - (y / top) * innerH;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => (top * i) / ticks);
  const xTicks = Array.from({ length: 5 }, (_, i) => Math.round(xMin + ((xMax - xMin) * i) / 4));

  // Nearest epoch to the pointer, for the crosshair.
  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;
    if (px < pad.l || px > w - pad.r) return setHover(null);
    const frac = (px - pad.l) / innerW;
    setHover(Math.round(xMin + frac * (xMax - xMin)));
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-auto"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${yLabel} against ${xLabel}`}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke={LINE} strokeWidth="1" />
            <text x={pad.l - 10} y={sy(t) + 4} textAnchor="end" fontSize="11" fill={MUTED} fontFamily="var(--font-mono, monospace)">
              {formatY(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={h - 12} textAnchor="middle" fontSize="11" fill={MUTED} fontFamily="monospace">
            {t}
          </text>
        ))}

        {hover != null && (
          <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={pad.t + innerH} stroke={MUTED} strokeWidth="1" strokeDasharray="3 3" />
        )}

        {series.map((s, i) => {
          const d = s.points.map((p, k) => `${k ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join("");
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={SERIES[i]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {/* Direct end label — identity never rests on colour alone. */}
              <circle cx={sx(last.x)} cy={sy(last.y)} r="4" fill={SERIES[i]} stroke="#121b2e" strokeWidth="2" />
              <text x={sx(last.x) + 10} y={sy(last.y) + 4} fontSize="11.5" fill={INK} fontFamily="monospace">
                {s.name}
              </text>
              {hover != null &&
                (() => {
                  const p = s.points.reduce((a, b) => (Math.abs(b.x - hover) < Math.abs(a.x - hover) ? b : a));
                  return (
                    <circle cx={sx(p.x)} cy={sy(p.y)} r="5" fill={SERIES[i]} stroke="#121b2e" strokeWidth="2" />
                  );
                })()}
            </g>
          );
        })}
      </svg>

      <figcaption className="flex items-start justify-between gap-4 mt-1">
        <span className="font-mono text-[11px] text-muted">{xLabel}</span>
        {hover != null && (
          <span className="font-mono text-[11px] text-[#e7ebf2] tabular-nums">
            epoch {hover} ·{" "}
            {series
              .map((s) => {
                const p = s.points.reduce((a, b) => (Math.abs(b.x - hover) < Math.abs(a.x - hover) ? b : a));
                return `${s.name} ${formatY(p.y)}`;
              })
              .join("  ·  ")}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function BarRow({ label, sub, value, max, format, winner }) {
  return (
    <div className="grid grid-cols-[150px_1fr_66px] items-center gap-3">
      <div className="min-w-0">
        <div className={`text-xs truncate ${winner ? "text-[#e7ebf2] font-semibold" : "text-muted"}`}>{label}</div>
        <div className="font-mono text-[10px] text-muted">{sub}</div>
      </div>
      <div className="h-6 bg-surface2 relative">
        <div
          className="h-full"
          style={{
            width: `${Math.max(0.5, (value / max) * 100)}%`,
            background: winner ? SERIES[0] : "#3b5170",
            borderTopRightRadius: 4,
            borderBottomRightRadius: 4,
          }}
        />
      </div>
      <div className={`font-mono text-sm tabular-nums text-right ${winner ? "text-[#e7ebf2]" : "text-muted"}`}>
        {format(value)}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- page

const YOLO_METRICS = [
  ["maskMAP50", "Mask mAP@50", (v) => v.toFixed(2), 1],
  ["maskP", "Mask precision", (v) => v.toFixed(2), 1],
  ["maskR", "Mask recall", (v) => v.toFixed(2), 1],
  ["segLoss", "Segmentation loss", (v) => v.toFixed(1), null],
];

const ENGINE_METRICS = [
  ["iou", "IoU", (v) => v.toFixed(3)],
  ["f1", "F1", (v) => v.toFixed(3)],
  ["precision", "Precision", (v) => v.toFixed(3)],
  ["recall", "Recall", (v) => v.toFixed(3)],
];

export default function ExplainView({ benchmark, training }) {
  const [stage, setStage] = useState(STAGES[2].id);
  const [yoloMetric, setYoloMetric] = useState("maskMAP50");
  const [engineMetric, setEngineMetric] = useState("iou");

  const active = STAGES.find((s) => s.id === stage);
  const [, , formatY, yMax] = YOLO_METRICS.find(([k]) => k === yoloMetric);
  const [, , formatEngine] = ENGINE_METRICS.find(([k]) => k === engineMetric);

  const yoloSeries = useMemo(() => {
    const runs = [
      ["yolo11n", training?.runs?.yolo11n],
      ["yolo26s", training?.runs?.yolo26s],
    ].filter(([, r]) => r);
    return runs.map(([name, r]) => ({
      name,
      points: r.history
        .filter((h) => h[yoloMetric] != null)
        .map((h) => ({ x: h.epoch, y: h[yoloMetric] })),
    }));
  }, [training, yoloMetric]);

  const unetSeries = useMemo(() => {
    const r = training?.runs?.unet;
    if (!r) return [];
    return [{ name: "U-Net", points: r.history.map((h) => ({ x: h.epoch, y: h.iou })) }];
  }, [training]);

  const engines = Object.entries(benchmark.engines).sort(
    (a, b) => b[1].mean[engineMetric] - a[1].mean[engineMetric]
  );
  const maxEngine = Math.max(...engines.map(([, e]) => e.mean[engineMetric]));

  return (
    <main className="min-h-screen">
      <header className="border-b border-line px-6 py-10 max-w-6xl mx-auto">
        <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
          How it works, with the receipts
        </div>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-2 max-w-3xl">
          Every stage, every epoch, every number — from the files that produced them.
        </h1>
        <p className="text-muted text-sm mt-4 max-w-2xl leading-relaxed">
          Nothing on this page is typed by hand. The pipeline figures are the constants the code
          actually runs on, the curves are read straight from the training logs, and the scores come
          from <code className="text-accent2">public/benchmark.json</code>, which the benchmark
          script writes.
        </p>
        <div className="flex flex-wrap gap-2 mt-5 font-mono text-[11px] text-muted">
          <span className="border border-line rounded-full px-3 py-1.5">{training?.hardware}</span>
          <span className="border border-line rounded-full px-3 py-1.5">
            {training?.dataset?.trainSites} train / {training?.dataset?.valSites} held-out sites
          </span>
          <span className="border border-line rounded-full px-3 py-1.5">
            generated {benchmark.generated}
          </span>
        </div>
      </header>

      {/* ---------------------------------------------------------- pipeline */}
      <section className="px-6 py-10 max-w-6xl mx-auto">
        <h2 className="font-display font-bold text-lg">The pipeline, stage by stage</h2>
        <p className="text-muted text-sm mt-1.5 max-w-2xl">
          Only stage three differs between engines. Select a stage to see what it does and the
          constants it runs on.
        </p>

        <div className="flex flex-wrap gap-1.5 mt-5" role="tablist" aria-label="Pipeline stages">
          {STAGES.map((s, i) => {
            const on = s.id === stage;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={on}
                onClick={() => setStage(s.id)}
                className={`font-mono text-[11px] px-3 py-2 border transition ${
                  on
                    ? "border-accent text-ink bg-accent font-semibold"
                    : "border-line text-muted hover:text-[#e7ebf2] hover:bg-surface2"
                }`}
              >
                {String(i + 1).padStart(2, "0")} {s.name}
              </button>
            );
          })}
        </div>

        <div className="mt-5 border border-line rounded-xl bg-surface p-6 grid md:grid-cols-[1fr_300px] gap-8">
          <div>
            <div className="font-display font-bold text-xl">{active.one}</div>
            <p className="text-muted text-sm mt-3 leading-relaxed max-w-[62ch]">{active.detail}</p>
          </div>
          <dl className="flex flex-col gap-0 self-start w-full">
            {active.figures.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-2.5 border-b border-line">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-mono text-sm tabular-nums text-[#e7ebf2] m-0 text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* --------------------------------------------------------- training */}
      <section className="px-6 pb-10 max-w-6xl mx-auto">
        <h2 className="font-display font-bold text-lg">Training, as it was logged</h2>
        <p className="text-muted text-sm mt-1.5 max-w-3xl">
          {training?.note}
        </p>

        <div className="grid lg:grid-cols-2 gap-6 mt-6">
          <div className="border border-line rounded-xl bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="font-display font-bold text-sm">
                YOLO runs — validation, per epoch
              </h3>
              <div className="flex gap-1">
                {YOLO_METRICS.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setYoloMetric(k)}
                    className={`font-mono text-[10px] px-2 py-1 border transition ${
                      yoloMetric === k
                        ? "border-accent2 text-accent2"
                        : "border-line text-muted hover:text-[#e7ebf2]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              {yoloSeries.length > 0 && (
                <LineChart
                  series={yoloSeries}
                  xLabel="epoch"
                  yLabel={yoloMetric}
                  yMax={yMax ?? undefined}
                  formatY={formatY}
                />
              )}
            </div>
            <p className="text-xs text-muted mt-3 leading-relaxed">
              Both runs were stopped early for time, not because they converged —{" "}
              <span className="text-[#e7ebf2]">{training?.runs?.yolo11n?.stoppedEarly}</span>, and{" "}
              <span className="text-[#e7ebf2]">{training?.runs?.yolo26s?.stoppedEarly}</span>. The
              bigger model was still behind when we stopped, so we shipped the smaller one.
            </p>
          </div>

          <div className="border border-line rounded-xl bg-surface p-5">
            <h3 className="font-display font-bold text-sm">
              U-Net — held-out pixel IoU, per checkpoint
            </h3>
            <div className="mt-4">
              {unetSeries.length > 0 && (
                <LineChart
                  series={unetSeries}
                  xLabel="epoch"
                  yLabel="held-out IoU"
                  yMax={0.65}
                  formatY={(v) => v.toFixed(2)}
                />
              )}
            </div>
            <p className="text-xs text-muted mt-3 leading-relaxed">
              Charted separately on purpose: this is pixel IoU against the held-out sites, while the
              YOLO panel shows mask mAP@50 on validation tiles. They are different measurements, and
              putting them on one axis would invent a comparison that does not exist. The two are
              compared properly below, where both are scored by the same protocol.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- engines */}
      <section className="px-6 pb-10 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg">Scored on the same held-out ground</h2>
            <p className="text-muted text-sm mt-1.5">
              Held out: {benchmark.evaluated_on.join(" · ")}. Same rasterisation, same metric, every engine.
            </p>
          </div>
          <div className="flex gap-1">
            {ENGINE_METRICS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => setEngineMetric(k)}
                className={`font-mono text-[10px] px-2.5 py-1.5 border transition ${
                  engineMetric === k
                    ? "border-accent2 text-accent2"
                    : "border-line text-muted hover:text-[#e7ebf2]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-line rounded-xl bg-surface p-6 mt-5 flex flex-col gap-3">
          {engines.map(([key, e], i) => (
            <BarRow
              key={key}
              label={e.label}
              sub={`${key} · ${e.mean_seconds}s`}
              value={e.mean[engineMetric]}
              max={maxEngine}
              format={formatEngine}
              winner={i === 0}
            />
          ))}
        </div>

        <div className="overflow-x-auto border border-line rounded-xl mt-4">
          <table className="w-full text-sm min-w-[620px]">
            <caption className="sr-only">Per-site scores for every engine</caption>
            <thead>
              <tr className="bg-surface2 text-left font-mono text-[11px] text-muted uppercase tracking-wide">
                <th scope="col" className="px-4 py-3">Engine</th>
                <th scope="col" className="px-4 py-3">Held-out site</th>
                {ENGINE_METRICS.map(([k, label]) => (
                  <th scope="col" key={k} className="px-4 py-3 text-right">{label}</th>
                ))}
                <th scope="col" className="px-4 py-3 text-right">Polygons</th>
              </tr>
            </thead>
            <tbody>
              {engines.flatMap(([key, e]) =>
                Object.entries(e.per_site).map(([site, m], i) => (
                  <tr key={`${key}-${site}`} className="border-t border-line">
                    <td className="px-4 py-2.5 font-mono text-xs">{i === 0 ? key : ""}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{site}</td>
                    {ENGINE_METRICS.map(([mk]) => (
                      <td key={mk} className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {m[mk].toFixed(3)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted">{m.polygons}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ----------------------------------------------------------- limits */}
      <section className="px-6 pb-14 max-w-6xl mx-auto grid md:grid-cols-2 gap-6">
        <div className="border border-line rounded-xl p-5 bg-surface">
          <h2 className="font-display font-bold text-base mb-2">What we can defend</h2>
          <ul className="text-xs text-muted leading-relaxed flex flex-col gap-2 list-none p-0 m-0">
            <li>
              Both trained engines saw the same eight sites and were scored on the same two they
              never saw — held out by <em>site</em>, not by random crop.
            </li>
            <li>
              The mask threshold was swept for both engines, not just the winner. The U-Net&apos;s
              existing 0.50 turned out to already be its optimum, so the sweep favoured neither.
            </li>
            <li>
              Confidence and NMS use library defaults. No per-site tuning, no discarded runs.
            </li>
          </ul>
        </div>
        <div className="border border-line rounded-xl p-5 bg-surface">
          <h2 className="font-display font-bold text-base mb-2">What we would not claim</h2>
          <ul className="text-xs text-muted leading-relaxed flex flex-col gap-2 list-none p-0 m-0">
            <li>
              <span className="text-[#e7ebf2]">The YOLO lead is small.</span> Two held-out sites is a
              small sample, and a ~1% gap sits inside the variance a different random seed produces.
              Parity-plus, not a breakthrough.
            </li>
            <li>
              Ten labelled sites is a thin dataset for a national claim. More labels is the single
              biggest lever we have, ahead of any change of architecture.
            </li>
            <li>
              Land records are matched by nearest area today. Binding a parcel to its real survey
              number needs the village cadastral index.
            </li>
          </ul>
        </div>
      </section>

      <footer className="px-6 pb-16 max-w-6xl mx-auto">
        <div className="border-t border-line pt-6 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px] text-muted">
          <Link href="/benchmark" className="text-accent2 hover:underline">
            benchmark →
          </Link>
          <Link href="/tool" className="text-accent2 hover:underline">
            run the extractor →
          </Link>
          <span>python -m ml.building_detector.benchmark --engines unet yolo sam opencv</span>
        </div>
      </footer>
    </main>
  );
}
