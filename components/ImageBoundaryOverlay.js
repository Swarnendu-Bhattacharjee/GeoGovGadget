"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Renders an uploaded image with the model's polygons drawn over it in the
// image's own pixel space.
//
// The subtlety that matters here: the <img> uses object-contain, so it is
// letterboxed inside the container whenever their aspect ratios differ — the
// displayed picture is smaller than the box it sits in, and offset within it.
// Scaling polygons by the *container* size (rather than the displayed image
// rect) stretches them edge-to-edge while the photo stays letterboxed, which
// is exactly how the overlay drifts out of alignment. So compute the
// letterboxed rect explicitly and lay the SVG over precisely that.
export default function ImageBoundaryOverlay({
  imageSrc,
  imageWidth,
  imageHeight,
  features,
  selectedId,
  onSelectFeature,
  statuses,
}) {
  const containerRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // The rect the image actually occupies after object-contain letterboxing.
  const fit = useMemo(() => {
    if (!box.w || !box.h || !imageWidth || !imageHeight) return null;
    const scale = Math.min(box.w / imageWidth, box.h / imageHeight);
    const w = imageWidth * scale;
    const h = imageHeight * scale;
    return { scale, w, h, left: (box.w - w) / 2, top: (box.h - h) / 2 };
  }, [box, imageWidth, imageHeight]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <img
        src={imageSrc}
        alt="Uploaded imagery"
        className="w-full h-full object-contain select-none"
        draggable={false}
      />

      {fit && (
        <svg
          className="absolute pointer-events-none"
          style={{ left: fit.left, top: fit.top, width: fit.w, height: fit.h }}
          viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          preserveAspectRatio="none"
        >
          {features.map((f) => {
            const id = f.properties.lot_id;
            const status = statuses[id] || "pending";
            const isSelected = id === selectedId;
            const points = f.geometry.coordinates[0]
              .map(([x, y]) => `${x},${y}`)
              .join(" ");

            let stroke = "#4fd1c5";
            if (status === "approved") stroke = "#7fd88f";
            if (status === "rejected") stroke = "#e57373";

            return (
              <polygon
                key={id}
                points={points}
                fill={stroke}
                fillOpacity={isSelected ? 0.34 : 0.14}
                stroke={stroke}
                // Stroke is specified in image pixels, so divide by the display
                // scale to keep it a constant width on screen at any zoom.
                strokeWidth={(isSelected ? 3 : 1.6) / fit.scale}
                strokeLinejoin="round"
                className="pointer-events-auto cursor-pointer transition-[fill-opacity]"
                onClick={() => onSelectFeature(id)}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
