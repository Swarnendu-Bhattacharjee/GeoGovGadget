"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const ImageBoundaryOverlay = dynamic(() => import("@/components/ImageBoundaryOverlay"), { ssr: false });

const ENGINE_OPTIONS = [
  {
    id: "unet",
    name: "U-Net (trained)",
    blurb: "Trained on SRM cadastral labels · IoU 0.53 · ~1s",
    // Exported to ONNX, so this one still runs where there is no Python.
    browserFallback: true,
  },
  {
    id: "yolo",
    name: "YOLO11-seg",
    blurb: "Instance segmentation, same training sites \u00b7 server-side only",
    browserFallback: false,
  },
  {
    id: "sam",
    name: "Segment Anything",
    blurb: "Zero-shot, class-agnostic · IoU 0.22 · ~19s",
    browserFallback: false,
  },
];

const VIEWS = [
  ["overlay", "Interactive"],
  ["annotated", "Rendered"],
  ["heatmap", "Confidence"],
];

export default function ToolPage() {
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [engine, setEngine] = useState("unet");
  const [view, setView] = useState("overlay");
  const [selectedId, setSelectedId] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [minConfidence, setMinConfidence] = useState(0);
  const [capabilities, setCapabilities] = useState(null);
  const [progress, setProgress] = useState(null);

  // Which engines this deployment can run server-side. On Vercel the answer is
  // "none" — there is no Python runtime — so the U-Net is run in the browser
  // from its ONNX export instead. Probing up front means the UI can say so
  // before an upload rather than after a failed one.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/detect")
      .then((r) => (r.ok ? r.json() : null))
      .then((caps) => {
        if (!cancelled) setCapabilities(caps ?? { serverPython: false, engines: {} });
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ serverPython: false, engines: {} });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const serverHas = useCallback(
    (id) => Boolean(capabilities?.engines?.[id]),
    [capabilities]
  );
  const runsInBrowser = engine === "unet" && capabilities != null && !serverHas("unet");

  const allFeatures = result?.geojson?.features || [];
  const features = useMemo(
    () => allFeatures.filter((f) => (f.properties.confidence ?? 1) >= minConfidence),
    [allFeatures, minConfidence]
  );

  const counts = useMemo(() => {
    let approved = 0, rejected = 0, pending = 0;
    for (const f of features) {
      const s = statuses[f.properties.lot_id] || "pending";
      if (s === "approved") approved++;
      else if (s === "rejected") rejected++;
      else pending++;
    }
    return { approved, rejected, pending, total: features.length };
  }, [features, statuses]);

  const selectedFeature = features.find((f) => f.properties.lot_id === selectedId);

  async function runInBrowser(file) {
    const { detectInBrowser } = await import("@/lib/unet/browser-engine");
    return detectInBrowser(file, setProgress);
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file still fires a change event.
    e.target.value = "";
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedId(null);
    setStatuses({});
    setProgress(null);
    try {
      let data;
      if (serverHas(engine)) {
        const body = new FormData();
        body.append("image", file);
        body.append("engine", engine);
        const res = await fetch("/api/detect", { method: "POST", body });
        data = await res.json();
        if (!res.ok) {
          // The server engine can disappear between the probe and the upload
          // (a redeploy, a moved checkpoint); fall back rather than fail.
          if (data?.code === "server_engine_unavailable" && engine === "unet") {
            data = await runInBrowser(file);
          } else {
            setError(data.error || "Detection failed.");
            return;
          }
        }
      } else if (engine === "unet") {
        data = await runInBrowser(file);
      } else {
        setError(
          `The ${engine} engine only runs server-side, from ml/.venv with torch — ` +
            "which this deployment does not host. Use the U-Net engine, which runs " +
            "in your browser, or run the app locally to reproduce the full " +
            "head-to-head. The scored comparison of every engine is on the " +
            "benchmark page."
        );
        return;
      }
      setResult(data);
      setView("overlay");
    } catch (err) {
      setError(err?.message ? `Detection failed: ${err.message}` : "Network error reaching the detector.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function setStatus(id, status) {
    setStatuses((s) => ({ ...s, [id]: status }));
  }

  function exportGeoJSON() {
    if (!result?.geojson) return;
    const payload = {
      ...result.geojson,
      features: features.map((f) => ({
        ...f,
        properties: { ...f.properties, status: statuses[f.properties.lot_id] || "pending" },
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "geogov-parcels.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-line px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs tracking-widest text-accent2 uppercase">
              Parcel Extraction Engine
            </div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl tracking-tight mt-1">
              Extract cadastral boundaries
            </h1>
            <p className="text-muted text-sm mt-1.5 max-w-2xl">
              Upload an aerial or satellite capture. A U-Net trained on hand-drawn SRM KTR
              cadastral labels segments built-up parcels, vectorises them, and hands you
              GIS-ready GeoJSON to verify.
            </p>
          </div>
          <Link
            href="/benchmark"
            className="font-mono text-xs border border-line rounded-lg px-3 py-2 hover:bg-surface2 transition shrink-0"
          >
            see the accuracy numbers →
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-[1fr_350px]">
        <div className="p-4 flex flex-col gap-3 min-h-[560px]">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="bg-accent text-ink font-semibold text-sm px-4 py-2.5 rounded-lg hover:brightness-110 transition disabled:opacity-60"
            >
              {loading ? "Extracting…" : "Upload imagery"}
            </button>

            <div className="flex items-center gap-1 border border-line rounded-lg p-1">
              {ENGINE_OPTIONS.map((o) => {
                const unavailable =
                  capabilities != null && !serverHas(o.id) && !o.browserFallback;
                return (
                  <button
                    key={o.id}
                    onClick={() => setEngine(o.id)}
                    disabled={unavailable || loading}
                    title={
                      unavailable
                        ? `${o.blurb} — server-only, not available on this deployment`
                        : o.blurb
                    }
                    className={`font-mono text-[11px] px-2.5 py-1.5 rounded transition disabled:opacity-30 disabled:cursor-not-allowed ${
                      engine === o.id ? "bg-accent2 text-ink font-semibold" : "text-muted hover:text-[#e7ebf2]"
                    }`}
                  >
                    {o.name}
                  </button>
                );
              })}
            </div>

            {result && (
              <>
                <div className="flex items-center gap-1 border border-line rounded-lg p-1">
                  {VIEWS.map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setView(id)}
                      disabled={id === "heatmap" && !result.heatmapDataUrl}
                      className={`font-mono text-[11px] px-2.5 py-1.5 rounded transition disabled:opacity-30 ${
                        view === id ? "bg-surface2 text-accent2" : "text-muted hover:text-[#e7ebf2]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={exportGeoJSON}
                  className="font-mono text-xs px-3 py-2.5 rounded-lg border border-line hover:bg-surface2 transition"
                >
                  Export GeoJSON
                </button>
              </>
            )}
          </div>

          {/* Result metrics strip */}
          {result && (
            <div className="flex flex-wrap gap-2">
              <Metric label="Parcels" value={features.length} accent />
              {result.meanConfidence != null && (
                <Metric label="Mean confidence" value={`${Math.round(result.meanConfidence * 100)}%`} />
              )}
              {result.builtUpFraction != null && (
                <Metric label="Built-up" value={`${Math.round(result.builtUpFraction * 100)}%`} />
              )}
              {result.inferenceSeconds != null && (
                <Metric label="Inference" value={`${result.inferenceSeconds}s`} />
              )}
              {result.device && <Metric label="Device" value={result.device} />}
              <Metric label="Source" value={`${result.imageWidth}×${result.imageHeight}px`} />
            </div>
          )}

          {/* Canvas */}
          <div className="min-h-[440px] h-[58vh] border border-line rounded-xl overflow-hidden bg-surface relative">
            {error && (
              <div className="h-full flex items-center justify-center px-6 text-center">
                <p className="text-bad text-sm max-w-md">{error}</p>
              </div>
            )}
            {!error && !result && !loading && (
              <EmptyState onUpload={() => fileInputRef.current?.click()} engine={engine} />
            )}
            {loading && <LoadingState engine={engine} inBrowser={runsInBrowser} progress={progress} />}
            {result && !loading && view === "overlay" && (
              <ImageBoundaryOverlay
                imageSrc={result.originalImageDataUrl}
                imageWidth={result.imageWidth}
                imageHeight={result.imageHeight}
                features={features}
                selectedId={selectedId}
                onSelectFeature={setSelectedId}
                statuses={statuses}
              />
            )}
            {result && !loading && view === "annotated" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.annotatedImageDataUrl} alt="Rendered detection" className="w-full h-full object-contain" />
            )}
            {result && !loading && view === "heatmap" && result.heatmapDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={result.heatmapDataUrl} alt="Model confidence heatmap" className="w-full h-full object-contain" />
            )}
          </div>

          {/* Confidence filter */}
          {result && allFeatures.some((f) => f.properties.confidence != null) && (
            <div className="border border-line rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-[260px]">
                <span className="font-mono text-[11px] text-muted whitespace-nowrap">
                  min confidence
                </span>
                <input
                  type="range"
                  min="0"
                  max="0.95"
                  step="0.05"
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
                  className="flex-1 accent-[#ff8a3d]"
                />
                <span className="font-mono text-[11px] tabular-nums w-10">
                  {Math.round(minConfidence * 100)}%
                </span>
              </div>
              <span className="font-mono text-[11px] text-muted">
                showing {features.length} of {allFeatures.length}
              </span>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <aside className="border-t lg:border-t-0 lg:border-l border-line p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <h2 className="font-display font-bold text-sm mb-2">Verification queue</h2>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              <Pill label="Total" value={counts.total} />
              <Pill label="Approved" value={counts.approved} color="#7fd88f" />
              <Pill label="Rejected" value={counts.rejected} color="#e57373" />
              <Pill label="Pending" value={counts.pending} />
            </div>
          </div>

          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">
              Extracted parcels ({features.length})
            </h2>
            <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
              {features.map((f) => {
                const id = f.properties.lot_id;
                const conf = f.properties.confidence;
                const status = statuses[id] || "pending";
                return (
                  <li
                    key={id}
                    onClick={() => setSelectedId(id)}
                    className={`cursor-pointer rounded-md px-2.5 py-2 border text-xs flex items-center justify-between gap-2 transition ${
                      selectedId === id ? "border-accent2 bg-surface2" : "border-line hover:bg-surface2"
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-mono truncate">{id}</span>
                      {conf != null && (
                        <span className="font-mono text-[10px] text-muted shrink-0">
                          {Math.round(conf * 100)}%
                        </span>
                      )}
                    </span>
                    <StatusBadge status={status} />
                  </li>
                );
              })}
              {features.length === 0 && (
                <li className="text-xs text-muted">Nothing extracted yet.</li>
              )}
            </ul>
          </div>

          {selectedFeature && (
            <div className="border-t border-line pt-4">
              <h2 className="font-display font-bold text-sm mb-2">Selected parcel</h2>
              <dl className="font-mono text-[11px] text-muted flex flex-col gap-1 mb-3">
                <Row k="id" v={selectedFeature.properties.lot_id} />
                <Row k="area" v={`${selectedFeature.properties.area_pixels.toLocaleString()} px²`} />
                <Row k="vertices" v={selectedFeature.properties.vertices} />
                {selectedFeature.properties.confidence != null && (
                  <Row k="confidence" v={`${Math.round(selectedFeature.properties.confidence * 100)}%`} />
                )}
                <Row k="rotation" v={`${selectedFeature.properties.rotation_angle}°`} />
              </dl>
              <div className="flex gap-2">
                <button
                  onClick={() => setStatus(selectedFeature.properties.lot_id, "approved")}
                  className="flex-1 text-xs font-semibold bg-good text-ink rounded-md py-2 hover:brightness-110"
                >
                  Approve
                </button>
                <button
                  onClick={() => setStatus(selectedFeature.properties.lot_id, "rejected")}
                  className="flex-1 text-xs font-semibold bg-bad text-ink rounded-md py-2 hover:brightness-110"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-line pt-4">
            <h2 className="font-display font-bold text-sm mb-2">What&apos;s real here</h2>
            <p className="text-xs text-muted leading-relaxed">
              The default engine is a U-Net with an ImageNet-pretrained ResNet18 encoder,
              trained on eight SRM KTR sites and scored on two it never saw
              (<Link href="/benchmark" className="text-accent2 hover:underline">IoU 0.53, F1 0.69</Link>).
              Coordinates stay in the image&apos;s own pixel space — an arbitrary upload carries no
              geotransform, so there&apos;s no honest way to place it on a basemap. The ten surveyed
              SRM sites do have real coordinates and appear on the{" "}
              <Link href="/3d-map" className="text-accent2 hover:underline">3D map</Link>.
            </p>
            {runsInBrowser && (
              <p className="text-xs text-muted leading-relaxed mt-3">
                This deployment has no Python runtime, so the network runs in your browser
                via ONNX Runtime — the same exported weights, with the tiling and
                vectorisation ported from the Python engine. Your imagery is never
                uploaded anywhere.
              </p>
            )}
          </div>
        </aside>
      </section>
    </main>
  );
}

const PHASE_LABELS = {
  model: "downloading model weights",
  inference: "sliding-window inference",
  vectorising: "vectorising polygons",
};

function LoadingState({ engine, inBrowser, progress }) {
  // The first in-browser run pulls ~57MB of weights before it can start, which
  // is long enough that an unqualified spinner reads as a hang. Say which phase
  // is running and how far along it is.
  const pct = progress ? Math.round(progress.progress * 100) : null;
  const label = progress
    ? `${PHASE_LABELS[progress.phase] || progress.phase}… ${pct}%`
    : engine === "unet"
      ? "sliding-window inference → vectorising polygons…"
      : "running Segment Anything on GPU… (~20s)";

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      <p className="font-mono text-xs text-muted">{label}</p>
      {progress && (
        <div className="w-56 h-1 rounded-full bg-surface2 overflow-hidden">
          <div
            className="h-full bg-accent transition-[width] duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {inBrowser && progress?.phase === "model" && (
        <p className="text-[11px] text-muted max-w-xs">
          Weights are cached after the first run.
        </p>
      )}
    </div>
  );
}

function EmptyState({ onUpload, engine }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="font-mono text-xs text-accent2 uppercase tracking-widest">
        No imagery loaded
      </div>
      <p className="text-muted text-sm max-w-sm">
        Upload an aerial or satellite capture to extract parcel boundaries with the{" "}
        {engine === "unet" ? "trained U-Net" : "Segment Anything"} engine.
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

function Metric({ label, value, accent }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${accent ? "border-accent/40 bg-accent/5" : "border-line bg-surface"}`}>
      <div className="font-mono text-[9px] text-muted uppercase tracking-wide">{label}</div>
      <div className="font-display font-bold text-sm tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function Pill({ label, value, color = "#8fa0bc" }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}: <span className="text-[#e7ebf2] font-semibold">{value}</span>
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="text-[#e7ebf2]">{v}</dd>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: "text-muted border-line",
    approved: "text-good border-good/40",
    rejected: "text-bad border-bad/40",
  };
  return (
    <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${map[status]}`}>
      {status}
    </span>
  );
}
