import { NextResponse } from "next/server";
import { generateFeatures } from "@/lib/geo";

// POST /api/assistant
// A 24/7 natural-language interface over the plot dataset — the feature a
// government official would actually use: "what's the status of parcel X",
// "which plots in Ward 12 are unverified", etc. Grounded by passing the
// current dataset as context to the LLM (context-stuffing RAG — the dataset
// here is a couple dozen records, small enough that this is the right tool,
// not a vector DB).
//
// Requires GROQ_API_KEY in the environment (local: .env.local, prod: Vercel
// project env vars). Never hardcode the key in source.
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

  const dataset = generateFeatures("assistant-dataset").features.map((f) => ({
    id: f.properties.id,
    class: f.properties.class,
    surveyNo: f.properties.surveyNo,
    ward: f.properties.ward,
    ownerType: f.properties.ownerType,
    status: f.properties.status,
    confidence: f.properties.confidence,
    area_sqm: f.properties.area_sqm,
    floors: f.properties.floors,
    lastVerified: f.properties.lastVerified,
  }));

  const systemPrompt = `You are the GeoGovGadget assistant — a 24/7 query interface for government officials working with AI-extracted cadastral records (parcel boundaries, building footprints, land-use zones) from Problem Statement 26012, "AI-Enabled Automated Cadastral Mapping and Urban Parcel Boundary Extraction using Drone/Satellite Imagery".

Answer questions about the plot dataset below using only what it contains. Be concise and factual. If asked about a plot, cite its survey number and ward. If asked something the dataset doesn't cover, say so plainly rather than inventing details — this dataset is a demo sample, not a live production database, so say that when it's relevant (e.g. if asked "is this real data"). You may also answer general questions about how the GeoGovGadget platform works (segmentation, topology validation, verification workflow, edge deployment) based on the problem statement above.

Dataset (JSON):
${JSON.stringify(dataset, null, 2)}`;

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
      model: "llama-3.3-70b-versatile",
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
  const answer = data.choices?.[0]?.message?.content || "No response generated.";

  return NextResponse.json({ answer });
}
