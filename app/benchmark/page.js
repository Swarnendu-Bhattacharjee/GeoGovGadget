import Link from "next/link";
import { readFile } from "fs/promises";
import { join } from "path";

export const metadata = {
  title: "Benchmark — GeoGovGadget",
  description: "Held-out accuracy of every detection engine against hand-drawn cadastral ground truth.",
};

// Read at request time from the file the benchmark script writes, so the page
// can never drift from the numbers the model actually scored.
async function loadBenchmark() {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "public", "benchmark.json"), "utf-8"));
  } catch {
    return null;
  }
}

const METRICS = [
  ["iou", "IoU", "Intersection over union — the strictest single number. Overlap between predicted and true parcel area."],
  ["f1", "F1", "Harmonic mean of precision and recall."],
  ["precision", "Precision", "Of everything it flagged as parcel, how much really was."],
  ["recall", "Recall", "Of every real parcel, how much it found."],
];

export default async function BenchmarkPage() {
  const data = await loadBenchmark();

  if (!data) {
    return (
      <main className="min-h-screen px-6 py-20 max-w-3xl mx-auto">
        <h1 className="font-display font-extrabold text-3xl">Benchmark unavailable</h1>
        <p className="text-muted text-sm mt-3">
          Run <code className="text-accent2">python -m ml.building_detector.benchmark</code> to
          generate <code className="text-accent2">public/benchmark.json</code>.
        </p>
      </main>
    );
  }

  const engines = Object.entries(data.engines);
  const best = engines.reduce((a, b) => (b[1].mean.iou > a[1].mean.iou ? b : a));
  const training = data.training;

  // The SIH judges asked us to try YOLO or TensorFlow "instead of OpenCV", so
  // the two trained detectors get their own head-to-head above the general
  // table. Which one is reported as winning is read from the data, never typed.
  const unet = data.engines.unet;
  const yolo = data.engines.yolo;
  const headToHead =
    unet && yolo
      ? {
          winner: yolo.mean.iou > unet.mean.iou ? "yolo" : "unet",
          delta: yolo.mean.iou - unet.mean.iou,
          deltaPct: ((yolo.mean.iou - unet.mean.iou) / unet.mean.iou) * 100,
        }
      : null;

  return (
    <main className="min-h-screen">
      <header className="border-b border-line px-6 py-10 max-w-6xl mx-auto">
        <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
          Measured, not asserted
        </div>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight mt-2 max-w-3xl">
          Every engine, scored against the same held-out ground truth.
        </h1>
        <p className="text-muted text-sm mt-4 max-w-2xl leading-relaxed">{data.protocol}</p>
        <div className="flex flex-wrap gap-2 mt-5 font-mono text-[11px] text-muted">
          <span className="border border-line rounded-full px-3 py-1.5">
            generated {data.generated}
          </span>
          <span className="border border-line rounded-full px-3 py-1.5">device: {data.device}</span>
          {data.evaluated_on.map((s) => (
            <span key={s} className="border border-line rounded-full px-3 py-1.5">
              held out: {s}
            </span>
          ))}
        </div>
      </header>

      {/* Headline comparison */}
      <section className="px-6 py-10 max-w-6xl mx-auto">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {engines
            .sort((a, b) => b[1].mean.iou - a[1].mean.iou)
            .map(([key, e]) => {
              const isBest = key === best[0];
              return (
                <div
                  key={key}
                  className={`rounded-xl border p-5 ${
                    isBest ? "border-accent bg-accent/5" : "border-line bg-surface"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-display font-bold text-sm">{e.label}</div>
                      <div className="font-mono text-[10px] text-muted mt-0.5">{key}</div>
                    </div>
                    {isBest && (
                      <span className="font-mono text-[10px] bg-accent text-ink px-2 py-0.5 rounded-full shrink-0">
                        best
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="font-display font-extrabold text-4xl tabular-nums">
                      {e.mean.iou.toFixed(3)}
                    </span>
                    <span className="font-mono text-xs text-muted">IoU</span>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    {METRICS.slice(1).map(([k, label]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted w-16 shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 bg-surface2 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${e.mean[k] * 100}%`,
                              background: isBest ? "#ff8a3d" : "#4a5a76",
                            }}
                          />
                        </div>
                        <span className="font-mono text-[10px] tabular-nums w-10 text-right">
                          {e.mean[k].toFixed(3)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-3 border-t border-line font-mono text-[10px] text-muted">
                    {e.mean_seconds}s per image
                  </div>
                </div>
              );
            })}
        </div>
      </section>

      {/* Detector swap the judges asked for */}
      {headToHead && (
        <section className="px-6 pb-10 max-w-6xl mx-auto">
          <div className="border border-line rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line bg-surface">
              <div className="font-mono text-[11px] tracking-widest text-accent2 uppercase">
                Detector swap · U-Net vs YOLO
              </div>
              <h2 className="font-display font-bold text-lg mt-1">
                Same sites, same labels, same vectorisation — only the detector changed.
              </h2>
            </div>

            <div className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-6">
              {[["unet", unet], ["yolo", yolo]].map(([key, e], i) => {
                const won = headToHead.winner === key;
                return (
                  <div key={key} className={i === 1 ? "md:order-3" : ""}>
                    <div className="font-mono text-[10px] text-muted uppercase tracking-wide">
                      {key}
                    </div>
                    <div className="font-display font-bold text-sm mt-0.5">{e.label}</div>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span
                        className={`font-display font-extrabold text-5xl tabular-nums ${
                          won ? "text-accent" : "text-muted"
                        }`}
                      >
                        {e.mean.iou.toFixed(3)}
                      </span>
                      <span className="font-mono text-xs text-muted">IoU</span>
                    </div>
                    <div className="font-mono text-[11px] text-muted mt-2">
                      P {e.mean.precision.toFixed(3)} · R {e.mean.recall.toFixed(3)} · F1{" "}
                      {e.mean.f1.toFixed(3)} · {e.mean_seconds}s
                    </div>
                  </div>
                );
              })}
              <div className="md:order-2 text-center px-4">
                <div className="font-mono text-[10px] text-muted uppercase tracking-widest">
                  difference
                </div>
                <div
                  className={`font-display font-extrabold text-2xl tabular-nums mt-1 ${
                    headToHead.delta > 0 ? "text-good" : "text-bad"
                  }`}
                >
                  {headToHead.delta > 0 ? "+" : ""}
                  {headToHead.delta.toFixed(3)}
                </div>
                <div className="font-mono text-[10px] text-muted mt-0.5">
                  {headToHead.deltaPct > 0 ? "+" : ""}
                  {headToHead.deltaPct.toFixed(1)}% IoU
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-line bg-surface text-xs text-muted leading-relaxed">
              <p>
                <strong className="text-[#e7ebf2]">OpenCV was never the detector.</strong> It
                converts predicted masks into polygons — contour tracing, simplification, area and
                angle. Both engines above use that identical step, so the gap between them is the
                model and nothing else. The classical OpenCV row further down is a separate
                heuristic baseline with no learning in it at all, which is why it scores where it
                does.
              </p>
              <p className="mt-2">
                YOLO11n-seg was trained on the same eight sites, with the same two sites held out,
                using the polygons in <code className="text-accent2">data/yolo_parcels</code>{" "}
                derived from the same hand-drawn masks. Reproduce with{" "}
                <code className="text-accent2">
                  python -m ml.building_detector.benchmark --engines unet yolo sam opencv
                </code>
                .
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Full table */}
      <section className="px-6 pb-10 max-w-6xl mx-auto">
        <h2 className="font-display font-bold text-lg mb-3">Per-site breakdown</h2>
        <div className="overflow-x-auto border border-line rounded-xl">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-surface2 text-left font-mono text-[11px] text-muted uppercase tracking-wide">
                <th className="px-4 py-3">Engine</th>
                <th className="px-4 py-3">Site (held out)</th>
                {METRICS.map(([k, label]) => (
                  <th key={k} className="px-4 py-3 text-right">{label}</th>
                ))}
                <th className="px-4 py-3 text-right">Polygons</th>
                <th className="px-4 py-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {engines.flatMap(([key, e]) =>
                Object.entries(e.per_site).map(([site, m], i) => (
                  <tr key={`${key}-${site}`} className="border-t border-line">
                    <td className="px-4 py-2.5 font-mono text-xs">{i === 0 ? key : ""}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{site}</td>
                    {METRICS.map(([mk]) => (
                      <td key={mk} className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">
                        {m[mk].toFixed(3)}
                      </td>
                    ))}
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted">{m.polygons}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted">{m.seconds}s</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* How the labels exist at all */}
      <section className="px-6 pb-12 max-w-6xl mx-auto grid md:grid-cols-2 gap-8">
        <div className="border border-line rounded-xl p-5">
          <h2 className="font-display font-bold text-base mb-2">Where the ground truth came from</h2>
          <p className="text-xs text-muted leading-relaxed">
            The deck names &ldquo;limited labeled training data for Indian-specific cadastral
            imagery&rdquo; as the project&apos;s main risk. The labels here are hand-drawn parcel and
            footprint polygons over the same ten SRM KTR sites, captured at a different scale and
            framing than the raw imagery — so they couldn&apos;t be used directly.
          </p>
          <p className="text-xs text-muted leading-relaxed mt-3">
            Registering them onto the raw captures with SIFT + RANSAC recovers pixel alignment at
            1,500–3,100 inliers per site. (An earlier attempt to register raw photos against
            schematic map renders was correctly abandoned at 8/200 inliers — a photo and a flat map
            render share no texture. These are the same photograph, so it works.)
          </p>
        </div>
        <div className="border border-line rounded-xl p-5">
          <h2 className="font-display font-bold text-base mb-2">What the numbers do and don&apos;t say</h2>
          <ul className="text-xs text-muted leading-relaxed flex flex-col gap-2">
            <li>
              <span className="text-[#e7ebf2]">Validation is by held-out site</span>, never by random
              crops from a site that also appears in training — adjacent crops of one campus photo
              are correlated enough that a crop-level split would report a score the model
              hasn&apos;t earned.
            </li>
            <li>
              <span className="text-[#e7ebf2]">Two sites is a small test set.</span> Ten labelled
              sites is what exists; these figures carry the uncertainty that implies.
            </li>
            <li>
              <span className="text-[#e7ebf2]">Labels mix two conventions</span> — some sites are
              annotated per building footprint, others per whole parcel. The model learns
              &ldquo;built-up cadastral area&rdquo;, which is the preliminary map a surveyor then
              verifies, not a final legal boundary.
            </li>
          </ul>
        </div>
      </section>

      {/* Training detail */}
      {training && (
        <section className="px-6 pb-16 max-w-6xl mx-auto">
          <h2 className="font-display font-bold text-lg mb-3">Training run</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-5">
            <Stat label="Architecture" value="U-Net" note="ResNet18 ImageNet encoder" />
            <Stat label="Parameters" value={`${training.params_millions}M`} note="fits a 6GB GPU" />
            <Stat label="Training sites" value={training.trained_on.length} note="random 256px crops" />
            <Stat label="Best epoch" value={training.best_epoch} note="selected on held-out IoU" />
          </div>
          <div className="border border-line rounded-xl p-5">
            <h3 className="font-mono text-[11px] text-muted uppercase tracking-wide mb-3">
              Held-out IoU per epoch
            </h3>
            <div className="flex items-end gap-1.5 h-32">
              {training.history.map((h) => (
                <div key={h.epoch} className="flex-1 flex flex-col items-center gap-1.5 group">
                  <div
                    className={`w-full rounded-t transition ${
                      h.epoch === training.best_epoch ? "bg-accent" : "bg-accent2/40"
                    }`}
                    style={{ height: `${(h.iou / 0.6) * 100}%` }}
                    title={`epoch ${h.epoch}: IoU ${h.iou}`}
                  />
                  <span className="font-mono text-[9px] text-muted">{h.epoch}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-3">
              Training loss keeps falling after epoch {training.best_epoch} while held-out IoU
              doesn&apos;t — the model starts memorising eight images. The checkpoint served by the
              app is the best held-out epoch, not the last one.
            </p>
          </div>
        </section>
      )}

      <footer className="px-6 py-8 border-t border-line max-w-6xl mx-auto flex flex-wrap gap-4 items-center justify-between">
        <p className="font-mono text-[11px] text-muted">
          Reproduce: <code className="text-accent2">python -m ml.building_detector.benchmark</code>
        </p>
        <Link href="/tool" className="font-mono text-xs text-accent2 hover:underline">
          run the model yourself →
        </Link>
      </footer>
    </main>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="border border-line rounded-xl p-4 bg-surface">
      <div className="font-mono text-[10px] text-muted uppercase tracking-wide">{label}</div>
      <div className="font-display font-extrabold text-2xl mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] text-muted mt-0.5">{note}</div>
    </div>
  );
}
