import { readFile } from "fs/promises";
import { join } from "path";
import ExplainView from "@/components/ExplainView";

export const metadata = {
  title: "How it works — GeoGovGadget",
  description:
    "The extraction pipeline stage by stage, the real training logs, and every engine scored on the same held-out ground truth.",
};

// Both files are written by the ML scripts, never edited by hand — so the page
// cannot drift from what the models actually did.
async function load(name) {
  try {
    return JSON.parse(await readFile(join(process.cwd(), "public", name), "utf-8"));
  } catch {
    return null;
  }
}

export default async function ExplainPage() {
  const [benchmark, training] = await Promise.all([
    load("benchmark.json"),
    load("training_history.json"),
  ]);

  if (!benchmark) {
    return (
      <main className="min-h-screen px-6 py-20 max-w-3xl mx-auto">
        <h1 className="font-display font-extrabold text-3xl">Explainability unavailable</h1>
        <p className="text-muted text-sm mt-3">
          Run <code className="text-accent2">python -m ml.building_detector.benchmark</code> to
          generate <code className="text-accent2">public/benchmark.json</code>.
        </p>
      </main>
    );
  }

  return <ExplainView benchmark={benchmark} training={training} />;
}
