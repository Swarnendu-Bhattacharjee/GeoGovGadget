import { NextResponse } from "next/server";
import { generateFeatures, findOverlaps } from "@/lib/geo";

// POST /api/segment
// Accepts a multipart image upload, returns a GeoJSON FeatureCollection of
// detected parcel boundaries / building footprints / roads / land-use zones,
// plus a real topology (overlap) check on those polygons.
//
// See lib/geo.js for what's real (the overlap check) vs. what's a seeded
// demo stand-in for a trained segmentation model (the polygons themselves).
export async function POST(request) {
  const formData = await request.formData();
  const file = formData.get("image");

  if (!file) {
    return NextResponse.json({ error: "no image field in form data" }, { status: 400 });
  }

  const seedKey = `${file.name || "upload"}:${file.size || 0}`;
  const featureCollection = generateFeatures(seedKey);
  const overlaps = findOverlaps(featureCollection);

  return NextResponse.json({
    imageId: seedKey,
    filename: file.name || null,
    polygons: featureCollection,
    overlaps,
  });
}
