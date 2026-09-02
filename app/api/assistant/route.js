import { NextResponse } from "next/server";
import { generateFeatures, findOverlaps } from "@/lib/geo";
import { buildKnowledgeBase, retrieve } from "@/lib/knowledge";

// POST /api/assistant
// A 24/7 natural-language interface over the platform's own state — the
// feature an official would actually use ("which parcels are unverified",
// "how accurate is this model", "is this a legal boundary").
//
// Grounding is retrieval over lib/knowledge.js, which assembles its corpus
// from real artefacts: the benchmark scores the model actually achieved, the
// ground-truth dataset statistics, the site registry, and scheme context.
// The retrieved passages are pinned into the prompt and the model is told to
// answer only from them, so it can't quietly substitute a plausible-sounding
// figure for one the system holds — the failure mode that matters most when
// the subject is land records.
export async function POST(request) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GROQ_API_KEY is not configured. Add it to .env.local for local dev, or the Vercel project's Environment Variables for deployment.",
      },
      { status: 501 }
    );
  }

  const { question, history } = await request.json();
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "missing question" }, { status: 400 });
  }

  const docs = await buildKnowledgeBase();
  const retrieved = retrieve(docs, question, 4);

  // The demo parcel dataset the dashboard renders, so questions about
  // verification status/wards have something concrete to resolve against.
  const featureCollection = generateFeatures("assistant-dataset");
  const idToSurvey = Object.fromEntries(
    featureCollection.features.map((f) => [f.properties.id, f.properties.surveyNo])
  );
  const overlaps = findOverlaps(featureCollection).map(([a, b]) => [idToSurvey[a], idToSurvey[b]]);
  const parcels = featureCollection.features.map((f) => ({
    surveyNo: f.properties.surveyNo,
    class: f.properties.class,
    ward: f.properties.ward,
    ownerType: f.properties.ownerType,
    status: f.properties.status,
    confidence: f.properties.confidence,
    area_sqm: f.properties.area_sqm,
    lastVerified: f.properties.lastVerified,
  }));

  const systemPrompt = `You are the GeoGovGadget assistant, a query interface for officials working with AI-extracted cadastral records (SIH 2026, problem statement 26012).

Answer ONLY from the retrieved context and datasets below. Rules:
- If a figure isn't in the context, say it isn't held rather than estimating. Never invent a built-up area, floor count, ownership, or survey number.
- Quote real numbers when the context has them (accuracy scores, polygon counts, coordinates).
- If asked whether output is authoritative, be clear it is a preliminary map for surveyor verification, not a legal boundary.
- Be concise and factual. No preamble.

=== RETRIEVED CONTEXT ===
${retrieved.map((d) => `[${d.title}]\n${d.text}`).join("\n\n")}

=== DEMO PARCEL DATASET (dashboard sample, not production records) ===
${JSON.stringify(parcels, null, 1)}

=== TOPOLOGY CHECK (computed polygon intersections, real geometry) ===
${overlaps.length ? JSON.stringify(overlaps) : "no overlapping geometries in the current sample"}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(Array.isArray(history) ? history.slice(-8) : []),
    { role: "user", content: question },
  ];

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages,
      temperature: 0.2,
      max_tokens: 700,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json({ error: `Groq API error: ${res.status} ${errText}` }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({
    answer: data.choices?.[0]?.message?.content || "No response generated.",
    sources: retrieved.map((d) => d.title),
  });
}
