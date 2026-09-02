/**
 * RoofBoundaryOverlay - React component for displaying detected roof boundaries
 * 
 * Usage:
 * <RoofBoundaryOverlay 
 *   imageUrl="/path/to/satellite.jpg"
 *   geojson={geojsonData}
 *   onDetect={handleDetect}
 * />
 * 
 * @author INFERICS
 */

import React, { useState } from 'react';

const RoofBoundaryOverlay = ({ imageUrl, geojson, onDetect }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [detectedRoofs, setDetectedRoofs] = useState(null);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch('/api/roof-detect', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      setDetectedRoofs(data);
      if (onDetect) onDetect(data);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="roof-boundary-overlay">
      <div className="upload-area">
        <input
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          disabled={isUploading}
        />
        {isUploading && <span>Processing satellite image...</span>}
      </div>

      {detectedRoofs && (
        <div className="results">
          <h3>
            Detected {detectedRoofs.buildings_detected} buildings
            {' '}({detectedRoofs.detection_type})
          </h3>
          <pre className="geojson-output">
            {JSON.stringify(detectedRoofs.geojson, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default RoofBoundaryOverlay;
