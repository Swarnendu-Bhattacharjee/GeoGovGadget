/**
 * GeoGovPlugin - Next.js plugin for building roof boundary detection
 * 
 * Drop this folder into any Next.js app to add satellite imagery processing.
 * 
 * @author INFERICS
 * @version 2.0
 */

// API route handler for roof boundary extraction
// Place in: pages/api/roof-detect.js or app/api/roof-detect/route.js

import { NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { writeFile, readFile, unlinkSync } from 'fs';
import { join } from 'path';

const PYTHON = process.env.PYTHON_PATH || '/mnt/c/PROJECTS/storage/venv/bin/python3';
const DETECTOR = process.env.GEOGOV_SCRIPT || '/mnt/c/PROJECTS/opencv-GeoGovGadget-2.0/geo_gov_detector.py';
const OUTPUT_DIR = process.env.GEOGOV_OUTPUT || '/tmp/geogov_output';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('image');
    
    if (!file) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Save uploaded image
    const filename = file.name || 'uploaded.jpg';
    const uploadPath = join('/tmp', filename);
    await writeFile(uploadPath, buffer);

    // Run detector
    const result = execFileSync(PYTHON, [
      DETECTOR,
      '--input', uploadPath,
      '--output', OUTPUT_DIR,
      '--debug'
    ], { encoding: 'utf-8', timeout: 30000 });

    // Read generated outputs
    const geojson = JSON.parse(
      await readFile(join(OUTPUT_DIR, 'lot_layouts.geojson'), 'utf-8')
    );
    const metadata = JSON.parse(
      await readFile(join(OUTPUT_DIR, 'metadata.json'), 'utf-8')
    );

    // Cleanup
    try { unlinkSync(uploadPath); } catch {}

    return NextResponse.json({
      success: true,
      detection_type: metadata.detection_type,
      buildings_detected: metadata.buildings_detected,
      geojson,
      annotated_image: '/tmp/geogov_output/layouts/annotated_result.png',
    });
  } catch (error) {
    console.error('Detection error:', error);
    return NextResponse.json(
      { error: 'Processing failed', details: error.message },
      { status: 500 }
    );
  }
}
