/**
 * geogov-client - Client library for GeoGovGadget 2.0 API
 * 
 * Usage in any Next.js/React app:
 *   import { detectRoofs, getGeoJSON } from './lib/geogov-client';
 * 
 * @author INFERICS
 */

const API_BASE = process.env.NEXT_PUBLIC_GEOGOV_API || '/api/geogov';

/**
 * Detect building roofs in a satellite image
 * @param {File} imageFile - The satellite image file
 * @returns {Promise<Object>} Detection results with GeoJSON + metadata
 */
export async function detectRoofs(imageFile) {
  const formData = new FormData();
  formData.append('image', imageFile);

  const response = await fetch(`${API_BASE}/roof-detect`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.details || 'Detection failed');
  }

  return response.json();
}

/**
 * Get GeoJSON of detected buildings for mapping
 * @param {Object} detectionResult - Result from detectRoofs()
 * @returns {Object} GeoJSON FeatureCollection of building footprints
 */
export function getGeoJSON(detectionResult) {
  return detectionResult.geojson;
}

/**
 * Get annotated image with roof overlays
 * @param {Object} detectionResult - Result from detectRoofs()
 * @returns {string} URL to the annotated result image
 */
export function getAnnotatedImage(detectionResult) {
  return detectionResult.annotated_image;
}

export default { detectRoofs, getGeoJSON, getAnnotatedImage };
