#!/usr/bin/env python3
"""
Generate a synthetic satellite-style test image with buildings (roofs).
Used to verify the building detector pipeline works end-to-end.
"""
import numpy as np
import cv2

def create_test_image(width=1200, height=900):
    """Create a fake satellite image with buildings, roads, and grass."""
    img = np.zeros((height, width, 3), dtype=np.uint8)

    # Grass field background (darker green, with large smooth regions)
    green_base = np.full((height, width, 3), [90, 100, 70], dtype=np.int16)
    # Add large-scale smooth variation (not per-pixel noise)
    for i in range(0, height, 50):
        for j in range(0, width, 50):
            offset = np.random.randint(-8, 8, (50, 50, 3))
            green_base[i:i+50, j:j+50] = np.clip(green_base[i:i+50, j:j+50].astype(np.int16) + offset, 0, 255)
    img = green_base.astype(np.uint8)

    # Roads (gray asphalt)
    cv2.rectangle(img, (0, 300), (width, 340), (100, 100, 100), -1)
    cv2.rectangle(img, (400, 0), (440, height), (90, 90, 90), -1)

    # Buildings (bright roofs - much brighter than grass)
    buildings = [
        # (x, y, w, h, color) - rectangular buildings with bright roofs
        (100, 100, 80, 60, (200, 200, 200)),    # small house
        (250, 120, 120, 80, (190, 190, 190)),   # medium house
        (500, 100, 60, 40, (210, 210, 210)),    # small garage
        (600, 200, 200, 150, (180, 180, 180)),  # large building
        (900, 80, 90, 70, (200, 200, 200)),     # another house
        (100, 500, 150, 100, (185, 185, 185)),  # building near road
        (300, 450, 70, 50, (210, 210, 210)),
        (700, 500, 180, 120, (175, 175, 175)),
        (1000, 400, 100, 80, (195, 195, 195)),
        (50, 700, 200, 150, (180, 180, 180)),
        (400, 650, 110, 90, (205, 205, 205)),
        (800, 650, 130, 100, (190, 190, 190)),
    ]

    for x, y, w, h, color in buildings:
        cv2.rectangle(img, (x, y), (x + w, y + h), color, -1)
        # Add slight roof shading
        cv2.rectangle(img, (x, y), (x + w, y + h), (color[0]-10, color[1]-10, color[2]-10), 2)

    # Circular building (to test non-rectangular shapes)
    cv2.circle(img, (500, 400), 40, (138, 138, 138), -1)

    # Trees (green circles)
    cv2.circle(img, (150, 50), 25, (40, 120, 40), -1)
    cv2.circle(img, (850, 50), 30, (50, 110, 50), -1)

    # Add slight Gaussian noise
    noise = np.random.normal(0, 3, img.shape).astype(np.uint8)
    img = cv2.add(img, noise)

    return img


if __name__ == "__main__":
    img = create_test_image()
    cv2.imwrite("/home/lowkeypranjal/test_satellite.jpg", img)
    print("[INFO] Test image saved to /home/lowkeypranjal/test_satellite.jpg")
