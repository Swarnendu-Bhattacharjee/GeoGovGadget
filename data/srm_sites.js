// Real detection results from the SRM Institute of Science and Technology,
// Kattankulathur (KTR) campus dataset (data/outputs/combined/*), anchored to
// real coordinates read off your Google Maps screenshots
// (data/cordinates with images/Screenshot (143-151).png).
//
// Two calibration methods were used, both against those screenshots — no
// guessing at absolute position:
//
// 1. `confidence: "landmark"` sites with no `derivedFrom` note: the
//    coordinate is Google's own "click for coordinates" readout for a named
//    pin (e.g. "SRM Global Hospitals" -> 12.822974, 80.048182), read
//    directly off the screenshot. As accurate as Google's own pin.
// 2. `confidence: "landmark"` sites WITH a `derivedFrom` note: no direct
//    coordinate readout existed for that named place, so it was computed by
//    (a) pixel-measuring the on-screen "50 m" scale bar in Screenshot (151)
//    to get real meters-per-pixel (~0.6 m/px), (b) pixel-measuring that
//    landmark's position relative to the one Google-clicked point visible in
//    the same screenshot (SRM Global Hospitals), and (c) converting that
//    pixel offset to a lat/lng offset assuming a north-up, unrotated map
//    (true for Google's default satellite view). This is real trigonometry
//    on your screenshot, not an eyeballed guess — but it still isn't
//    survey-grade GPS, and assumes no image rotation/tilt.
//
// `confidence: "estimated"` sites have neither: no named landmark in any
// screenshot we have corresponds to them, so they're placed near the
// closest visible reference feature, flagged as weaker.
//
// `buildingsPlotted` is the vegetation-immune schematic-derived count
// (README: cleaner, but only sees what Google's map style drew).
// `buildingsRaw` is the photo-derived count (noisier — tree canopy and
// shadow can produce false positives on the RAW/SAM pipeline).

export const SRM_CAMPUS_CENTER = [80.0454, 12.8220]; // [lng, lat] — for the initial flyTo

export const SRM_SITES = [
  {
    slug: "srm-global",
    name: "SRM Global (Main Building)",
    lng: 80.048182,
    lat: 12.822974,
    confidence: "landmark",
    sourceNote: 'Google Maps pin "SRM Global Hospitals", Screenshot (148) — direct coordinate readout',
    buildingsPlotted: 7,
    buildingsRaw: 138,
  },
  {
    slug: "srm-dental",
    name: "SRM Dental College",
    lng: 80.049679,
    lat: 12.825696,
    confidence: "landmark",
    sourceNote: 'Google Maps pin "Dental Grounds", Screenshot (147) — direct coordinate readout',
    buildingsPlotted: 12,
    buildingsRaw: 100,
  },
  {
    slug: "tech-1-2-audi",
    name: "Tech Park 1/2 & Auditorium",
    lng: 80.046372,
    lat: 12.824715,
    confidence: "landmark",
    sourceNote: "Google Maps pin near Dr. TP Ganesan Auditorium, Screenshot (145) — direct coordinate readout",
    buildingsPlotted: 20,
    buildingsRaw: 93,
  },
  {
    slug: "ubi-and-valli-gate",
    name: "UBI & Valliammai Gate",
    lng: 80.044182,
    lat: 12.822934,
    confidence: "landmark",
    sourceNote: '"1, Mahatma Gandhi Rd" (main gate / Golden Jubilee Arch), Screenshot (151) — direct coordinate readout',
    buildingsPlotted: 13,
    buildingsRaw: 105,
  },
  {
    slug: "annexure-and-m-n-block",
    name: "Annexure, M & N Block",
    lng: 80.046082,
    lat: 12.820796,
    confidence: "landmark",
    sourceNote: '"M Block (Girls Hostel)" icon, Screenshot (151), pixel-measured from the SRM Global Hospitals anchor + on-screen scale bar',
    derivedFrom: "srm-global",
    buildingsPlotted: 19,
    buildingsRaw: 80,
  },
  {
    slug: "bel-block-and-canteen",
    name: "BEL Block & Canteen",
    lng: 80.044140,
    lat: 12.821713,
    confidence: "landmark",
    sourceNote: '"SRM College Boys Mess" icon, Screenshot (151), pixel-measured from the SRM Global Hospitals anchor + on-screen scale bar',
    derivedFrom: "srm-global",
    buildingsPlotted: 13,
    buildingsRaw: 73,
  },
  {
    slug: "srm-medical",
    name: "SRM Medical College",
    lng: 80.048331,
    lat: 12.820985,
    confidence: "landmark",
    sourceNote: '"SRM Medical College Hospital" pin, Screenshot (151), pixel-measured from the SRM Global Hospitals anchor + on-screen scale bar',
    derivedFrom: "srm-global",
    buildingsPlotted: 7,
    buildingsRaw: 117,
  },
  {
    slug: "arch-right-side-hostels",
    name: "Architecture Block — Hostel Side",
    lng: 80.043687,
    lat: 12.821497,
    confidence: "landmark",
    sourceNote: 'Midpoint of "Paari Block" and "Agastiyar Block" hostel labels, Screenshot (151), pixel-measured from the SRM Global Hospitals anchor + on-screen scale bar',
    derivedFrom: "srm-global",
    buildingsPlotted: 23,
    buildingsRaw: 128,
  },
  {
    slug: "law-school",
    name: "Law School",
    lng: 80.043894,
    lat: 12.823636,
    confidence: "estimated",
    sourceNote: 'No direct landmark match; placed at "SRM College of Management" pin, Screenshot (146) — same academic cluster, direct coordinate readout for a neighboring building',
    buildingsPlotted: 2,
    buildingsRaw: 114,
  },
  {
    slug: "main-eee-block-entrance-area",
    name: "Main EEE Block Entrance",
    lng: 80.046507,
    lat: 12.823896,
    confidence: "estimated",
    sourceNote: 'No direct landmark match; placed at "Auditorium Ground" pin, Screenshot (151) — nearest labeled feature, pixel-measured from the SRM Global Hospitals anchor',
    derivedFrom: "srm-global",
    buildingsPlotted: 18,
    buildingsRaw: 120,
  },
];

export function srmSiteFeatures() {
  return SRM_SITES.map((site) => ({
    ...site,
    thumb: `/srm-sites/${site.slug}/thumb.jpg`,
    approx: true, // none of these are survey-grade yet, regardless of confidence
    officialData: null, // sqft / floors / ownership: pending official government records
  }));
}

// Genuinely public, campus-wide facts (not per-building) — sourced via web
// search, September 2026:
// https://www.careers360.com/articles/srm-university-campus-list-facilities-contact-addresses-campus-size
// https://en.wikipedia.org/wiki/SRM_Institute_of_Science_and_Technology
export const SRM_CAMPUS_FACTS = {
  areaAcres: 250,
  blocks: "~42",
  builtUpAreaSqft: "~43,00,000",
  note: "Campus-wide figures, not specific to any single building above.",
};
