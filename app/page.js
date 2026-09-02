import Link from "next/link";
import dynamic from "next/dynamic";
import { readFile } from "fs/promises";
import { join } from "path";

const HeroScan = dynamic(() => import("@/components/HeroScan"), { ssr: false });

async function loadBenchmark() {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "public", "benchmark.json"), "utf-8"));
  } catch {
    return null;
  }
}

const PIPELINE = [
  ["01", "Ingest", "Drone / ORI / satellite capture uploaded or pulled from an existing survey batch."],
  ["02", "Segment", "U-Net with a pretrained ResNet18 encoder produces a per-pixel built-up probability map."],
  ["03", "Vectorise", "Threshold → morphological cleanup → contours → Douglas-Peucker simplification into polygons."],
  ["04", "Validate", "Turf.js polygon intersection flags overlaps and encroachment before anything is filed."],
  ["05", "Verify", "A surveyor approves, rejects or redraws — the model proposes, a human decides."],
  ["06", "Export", "GIS-ready GeoJSON, per-parcel confidence attached for triage."],
];

const CAPABILITIES = [
  ["Parcel boundary extraction", "Trained segmentation, not thresholding heuristics."],
  ["Building footprint delineation", "Same engine; labels cover both conventions."],
  ["Topology validation", "Real polygon-intersection geometry, not bounding boxes."],
  ["Confidence-ranked review", "Per-parcel confidence so verifiers triage the doubtful ones first."],
];

export default async function Home() {
  const bench = await loadBenchmark();
  const unet = bench?.engines?.unet?.mean;
  const sam = bench?.engines?.sam?.mean;
  const cv = bench?.engines?.opencv?.mean;

  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-line">
        <div
          className="absolute inset-0 opacity-[0.07] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(#4fd1c5 1px, transparent 1px), linear-gradient(90deg, #4fd1c5 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div className="relative px-6 pt-16 pb-14 max-w-6xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-accent2 uppercase border border-accent2/30 rounded-full px-3 py-1.5 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-accent2 animate-pulse" />
              SIH 2026 · PS 26012 · Team INFERICS
            </div>
            <h1 className="font-display font-extrabold text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.05] tracking-tight">
              Cadastral maps that draw
              <span className="text-accent"> themselves</span>, and a human who signs them off.
            </h1>
            <p className="text-muted text-base sm:text-lg mt-6 max-w-xl leading-relaxed">
              GeoGovGadget turns drone and satellite imagery into GIS-ready parcel boundaries with a
              segmentation model trained on real cadastral labels — then puts every polygon in front
              of a surveyor before it counts as record.
            </p>

            {unet && (
              <div className="flex flex-wrap gap-6 mt-8">
                <HeroStat value={unet.iou.toFixed(2)} label="held-out IoU" />
                <HeroStat value={unet.f1.toFixed(2)} label="F1 score" />
                <HeroStat value={`${bench.engines.unet.mean_seconds}s`} label="per image" />
                <HeroStat
                  value={`${(unet.iou / cv.iou).toFixed(1)}×`}
                  label="vs. heuristic baseline"
                  accent
                />
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-9">
              <Link
                href="/tool"
                className="bg-accent text-ink font-semibold text-sm px-6 py-3.5 rounded-lg hover:brightness-110 transition"
              >
                Run the model
              </Link>
              <Link
                href="/benchmark"
                className="border border-line text-sm px-6 py-3.5 rounded-lg hover:bg-surface2 transition"
              >
                See the numbers
              </Link>
              <Link
                href="/3d-map"
                className="border border-line text-sm px-6 py-3.5 rounded-lg hover:bg-surface2 transition"
              >
                3D campus map
              </Link>
            </div>
          </div>

          <HeroScan />
        </div>
      </section>

      {/* ── Evidence bar ─────────────────────────────────────── */}
      {unet && (
        <section className="border-b border-line bg-surface/40">
          <div className="px-6 py-10 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
              <h2 className="font-display font-bold text-xl">
                Three engines, one held-out test set
              </h2>
              <Link href="/benchmark" className="font-mono text-xs text-accent2 hover:underline">
                full protocol &amp; per-site breakdown →
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <EngineBar name="U-Net (trained)" m={unet} best />
              <EngineBar name="Segment Anything (zero-shot)" m={sam} />
              <EngineBar name="Classical OpenCV (heuristic)" m={cv} />
            </div>
            <p className="text-xs text-muted mt-4 max-w-3xl leading-relaxed">
              The heuristic baseline scores {cv.precision.toFixed(2)} precision at just{" "}
              {cv.recall.toFixed(2)} recall — what it finds is usually real, but it misses roughly{" "}
              {Math.round((1 - cv.recall) * 100)}% of parcels. That gap is the whole reason this
              project stopped tuning thresholds and trained a model instead.
            </p>
          </div>
        </section>
      )}

      {/* ── Pipeline ─────────────────────────────────────────── */}
      <section className="px-6 py-14 max-w-6xl mx-auto border-b border-line">
        <h2 className="font-display font-bold text-2xl mb-2">Imagery in, verified record out</h2>
        <p className="text-muted text-sm mb-8 max-w-2xl">
          Every stage is implemented and runnable — nothing here is a diagram of intent.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map(([n, title, body]) => (
            <div
              key={n}
              className="border border-line rounded-xl p-5 bg-surface hover:border-accent2/40 transition group"
            >
              <div className="font-mono text-[11px] text-accent2 mb-2">{n}</div>
              <div className="font-display font-bold text-sm mb-1.5">{title}</div>
              <p className="text-xs text-muted leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Capabilities + data provenance ───────────────────── */}
      <section className="px-6 py-14 max-w-6xl mx-auto grid md:grid-cols-2 gap-12 border-b border-line">
        <div>
          <h2 className="font-display font-bold text-xl mb-4">What it extracts</h2>
          <ul className="flex flex-col gap-4">
            {CAPABILITIES.map(([title, note]) => (
              <li key={title} className="flex gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-accent mt-2 shrink-0" />
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-xs text-muted mt-0.5">{note}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-display font-bold text-xl mb-4">Where the labels came from</h2>
          <p className="text-sm text-muted leading-relaxed">
            The pitch deck names &ldquo;limited labeled training data for Indian-specific cadastral
            imagery&rdquo; as this project&apos;s principal risk. The labels that exist are
            hand-drawn parcel polygons over ten SRM KTR sites — captured at a different scale and
            framing than the raw imagery, so unusable as-is.
          </p>
          <p className="text-sm text-muted leading-relaxed mt-3">
            Registering them onto the raw captures with SIFT + RANSAC recovers pixel alignment at
            1,500–3,100 inliers per site, turning unusable annotations into a real supervised
            dataset. That step is what made a trained model possible at all.
          </p>
          <Link
            href="/benchmark"
            className="inline-block mt-4 font-mono text-xs text-accent2 hover:underline"
          >
            how it&apos;s validated →
          </Link>
        </div>
      </section>

      {/* ── Honest limits ────────────────────────────────────── */}
      <section className="px-6 py-14 max-w-6xl mx-auto">
        <h2 className="font-display font-bold text-xl mb-4">What this does not do yet</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["No geo-referencing on arbitrary uploads", "An uploaded image carries no geotransform, so output stays in pixel space. The ten surveyed SRM sites do have real coordinates."],
            ["Ten labelled sites", "Enough to beat every baseline here, not enough to claim national generalisation. More survey batches move this directly."],
            ["Preliminary, not legal", "Output is a first-pass map for a surveyor to verify — the human step is the design, not a disclaimer."],
          ].map(([t, b]) => (
            <div key={t} className="border border-line rounded-xl p-5 bg-surface">
              <div className="font-display font-bold text-sm mb-1.5">{t}</div>
              <p className="text-xs text-muted leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-6 py-8 border-t border-line font-mono text-[11px] text-muted max-w-6xl mx-auto flex flex-wrap gap-3 justify-between">
        <span>GeoGovGadget · Team INFERICS · SIH 2026 · PS 26012</span>
        <span>Aligned to SVAMITVA / DILRMP digitisation targets</span>
      </footer>
    </main>
  );
}

function HeroStat({ value, label, accent }) {
  return (
    <div>
      <div
        className={`font-display font-extrabold text-3xl tabular-nums ${accent ? "text-accent" : ""}`}
      >
        {value}
      </div>
      <div className="font-mono text-[10px] text-muted uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

function EngineBar({ name, m, best }) {
  return (
    <div
      className={`rounded-xl border p-4 ${best ? "border-accent bg-accent/5" : "border-line bg-surface"}`}
    >
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <span className="font-display font-bold text-xs">{name}</span>
        <span className="font-display font-extrabold text-lg tabular-nums">{m.iou.toFixed(3)}</span>
      </div>
      <div className="h-2 bg-surface2 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${m.iou * 100}%`, background: best ? "#ff8a3d" : "#4a5a76" }}
        />
      </div>
      <div className="font-mono text-[10px] text-muted mt-2">
        P {m.precision.toFixed(2)} · R {m.recall.toFixed(2)} · F1 {m.f1.toFixed(2)}
      </div>
    </div>
  );
}
