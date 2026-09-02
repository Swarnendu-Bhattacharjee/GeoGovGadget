import { readFile } from "fs/promises";
import { join } from "path";

import { SRM_SITES, SRM_CAMPUS_FACTS } from "@/data/srm_sites";

// Retrieval corpus for the assistant. Everything here is either a real
// artefact this repo produces (benchmark scores, ground-truth stats, site
// registry) or sourced scheme context — so the assistant answers from the
// system's actual state rather than from the model's recollection of what a
// cadastral platform usually does.

const SCHEME_CONTEXT = [
  {
    id: "ps-26012",
    title: "Problem statement 26012",
    keywords: "problem statement sih hackathon requirement capability scope roads land use topology",
    text: `SIH 2026 PS 26012: "AI-Enabled Automated Cadastral Mapping and Urban Parcel Boundary Extraction using Drone/Satellite Imagery", software category, team INFERICS. Cadastral map preparation today depends on manual interpretation of drone imagery plus field Ground Truthing — slow, resource-intensive, and hard to keep current. Dense settlements, irregular geometries, encroachments, overlapping structures and mixed land use make manual digitisation harder still. Required capabilities: automatic parcel boundary extraction, building footprint delineation, road/pathway detection, land-use classification. Required platform features: AI segmentation for parcel delineation, deep learning feature extraction, automated topology generation, detection of overlapping/inconsistent geometries, and a Web-GIS visualisation and editing interface.`,
  },
  {
    id: "svamitva",
    title: "SVAMITVA and DILRMP alignment",
    keywords: "svamitva dilrmp scheme government policy ministry panchayati land records ori dsm dtm gnss cors",
    text: `SVAMITVA (Survey of Villages and Mapping with Improvised Technology in Village Areas) is a Ministry of Panchayati Raj scheme using drone survey to issue property cards for rural inhabited land. DILRMP (Digital India Land Records Modernisation Programme), under the Department of Land Resources, is the national land-record digitisation programme. Both consume the same input families this platform targets — ORI, DSM/DTM, GNSS/CORS-corrected survey data — which is why the platform is designed to slot into existing survey batches rather than require new capture.`,
  },
  {
    id: "human-in-loop",
    title: "Verification model",
    keywords: "verification verify surveyor human approve reject confidence queue workflow preliminary legal",
    text: `Output is explicitly a PRELIMINARY parcel map, not a legal boundary. Every polygon carries a model confidence and enters a verification queue where a surveyor approves, rejects or redraws it. The design intent is to convert the surveyor's job from full manual digitisation into verification, which is where the months-to-weeks turnaround claim comes from. Confidence is surfaced per parcel so low-confidence geometry is triaged first.`,
  },
  {
    id: "limits",
    title: "Known limitations",
    keywords: "limitation limits cannot legal authoritative geo-referencing gps pending missing official records caveat",
    text: `1) Arbitrary uploaded images carry no geotransform, so extracted polygons stay in image pixel coordinates — the app does not invent lat/lng for them. Only the ten surveyed SRM KTR sites have real coordinates. 2) Those site coordinates are landmark-anchored or scale-bar-derived from Google Maps captures, not survey-grade GPS. 3) Training used ten labelled sites; that beats every baseline measured here but does not establish national generalisation. 4) Per-building official records (built-up sqft, floor count, ownership, survey number) are NOT held — those fields are pending official data. Do not invent them.`,
  },
];

async function readJson(relPath) {
  try {
    return JSON.parse(await readFile(join(process.cwd(), relPath), "utf-8"));
  } catch {
    return null;
  }
}

export async function buildKnowledgeBase() {
  const [benchmark, groundTruth] = await Promise.all([
    readJson("public/benchmark.json"),
    readJson("data/ground_truth/summary.json"),
  ]);

  const docs = [...SCHEME_CONTEXT];

  if (benchmark?.engines) {
    const lines = Object.entries(benchmark.engines).map(([key, e]) => {
      const m = e.mean;
      return `${e.label} (${key}): IoU ${m.iou}, precision ${m.precision}, recall ${m.recall}, F1 ${m.f1}, ${e.mean_seconds}s per image.`;
    });
    docs.push({
      id: "benchmark",
      title: "Measured accuracy",
      keywords: "accuracy accurate precision recall iou f1 score scores benchmark measured evaluate evaluation performance good better best compare comparison engine baseline",
      text: `Engines scored on ${benchmark.evaluated_on.length} held-out sites (${benchmark.evaluated_on.map((n) => `"${n}"`).join(" and ")}) against hand-drawn cadastral ground truth, generated ${benchmark.generated} on ${benchmark.device}. ${lines.join(" ")} Protocol: ${benchmark.protocol}`,
    });

    if (benchmark.training) {
      const t = benchmark.training;
      docs.push({
        id: "training",
        title: "Model training",
      keywords: "training trained train model unet architecture epoch encoder augmentation overfit checkpoint",
        text: `Model: ${t.model}, ${t.params_millions}M parameters. Trained on ${t.trained_on.length} sites (${t.trained_on.map((n) => `"${n}"`).join(", ")}), validated on ${t.validated_on.length} held-out sites: ${t.validated_on.map((n) => `"${n}"`).join(" and ")}. Held-out scores are in the 'Measured accuracy' document. Best epoch ${t.best_epoch}, selected on held-out IoU rather than final epoch, because training loss keeps falling after the model starts memorising the small training set. Training used random 256px crops with flip/rotate/scale/colour augmentation and an ImageNet-pretrained encoder — the deck's stated mitigation for limited labelled data.`,
      });
    }
  }

  if (Array.isArray(groundTruth) && groundTruth.length) {
    const total = groundTruth.reduce((s, g) => s + g.building_polygons, 0);
    docs.push({
      id: "ground-truth",
      title: "Ground-truth dataset",
      keywords: "labels labelled label ground truth dataset annotation annotated registration sift ransac training data where came from",
      text: `${groundTruth.length} sites with pixel-aligned labels, ${total} annotated parcel polygons total. Labels are hand-drawn red parcel/footprint polygons over SRM KTR captures, registered onto the raw imagery by SIFT+RANSAC homography at ${Math.min(...groundTruth.map((g) => g.registration_inliers))}-${Math.max(...groundTruth.map((g) => g.registration_inliers))} inliers per site. An earlier attempt to register raw photos against schematic map renders was abandoned at 8/200 inliers, because a photo and a flat map render share no texture. Per site: ${groundTruth.map((g) => `${g.site} (${g.building_polygons} polygons, ${Math.round(g.mask_coverage_frac * 100)}% built-up coverage)`).join("; ")}.`,
    });
  }

  docs.push({
    id: "sites",
    title: "Surveyed SRM KTR sites",
    keywords: "site sites srm ktr campus coordinates location parcel counts sqft floors ownership building",
    text: `${SRM_SITES.length} surveyed sites, each with detection counts and an approximate real-world coordinate. ${SRM_SITES.map((s) => `${s.name} at ${s.lat.toFixed(6)}, ${s.lng.toFixed(6)} (${s.confidence}-confidence placement; ${s.buildingsPlotted} schematic-derived structures, ${s.buildingsRaw} raw-photo detections; official sqft/floors/ownership pending)`).join("; ")}. Campus-wide public figures, not per building: ${SRM_CAMPUS_FACTS.areaAcres} acres, ${SRM_CAMPUS_FACTS.blocks} blocks, ${SRM_CAMPUS_FACTS.builtUpAreaSqft} sqft built-up.`,
  });

  return docs;
}

// Lightweight lexical retrieval. The corpus is a handful of documents, so
// term-overlap scoring is the right tool — a vector index would add a
// dependency and a build step to rank eight paragraphs.
export function retrieve(docs, query, k = 4) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

  if (!terms.length) return docs.slice(0, k);

  const scored = docs.map((doc) => {
    const haystack = `${doc.title} ${doc.keywords || ""} ${doc.text}`.toLowerCase();
    const titleHay = `${doc.title} ${doc.keywords || ""}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      const hits = haystack.split(t).length - 1;
      if (hits) score += 1 + Math.log(hits);
      // A hit in the title/keyword line is a much stronger topic signal than
      // an incidental mention in a long body paragraph.
      if (titleHay.includes(t)) score += 3;
    }
    return { doc, score };
  });

  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  // Always keep the limitations doc in context: it's what stops the model
  // filling in ownership/sqft figures the system doesn't actually hold.
  const picked = hits.slice(0, k).map((s) => s.doc);
  const limits = docs.find((d) => d.id === "limits");
  if (limits && !picked.includes(limits)) picked.push(limits);
  return picked.length ? picked : docs.slice(0, k);
}
