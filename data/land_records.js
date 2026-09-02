// Real Tamil Nadu land records, transcribed from the certified Chitta extracts
// in data/land/ (Government of Tamil Nadu, Department of Revenue and Disaster
// Management, "Details of Land Holdings : C. No. 10(1) Section"), each
// digitally signed by the Tahsildar and verifiable against the reference
// number on https://eservices.tn.gov.in.
//
// These are the authoritative figures a cadastral map is checked AGAINST.
// Everything the model produces is a proposal until it reconciles with one of
// these — which is the entire point of the platform, and the reason the app
// compares extracted parcel area to the official area rather than just
// reporting its own number.
//
// Area notation: the extracts use Hectare-Are ("Heck - Air"). 1 are = 100 m²,
// so "0 - 12.00" is 0 ha 12 ares = 1,200 m². `fix` is the assessment in
// Rupees-Pie as printed.

export const LAND_RECORDS = [
  {
    surveyNo: "92/4",
    fieldNumber: 92,
    subdivision: "4",
    pattaNo: "586",
    owner: "SRM Institute of Science & Technology",
    ownerType: "Institutional",
    classification: "Wet",
    areaHectAre: "0-12.00",
    areaSqm: 1200,
    fix: "1.73",
    fmbSketch: "/land/fmb_92_4.png",
    // Dimensions read off the FMB sketch, which corroborate the Chitta area:
    // 35.2 m across by ~32.4 m deep ≈ 1,140 m² against the registered 1,200 m².
    fmbDimensions: "35.2 m × 32.8/32.0 m",
    reference: "S/35/04/054/00586/80409",
  },
  {
    surveyNo: "92/3",
    fieldNumber: 92,
    subdivision: "3",
    pattaNo: "586",
    owner: "SRM Institute of Science & Technology",
    ownerType: "Institutional",
    classification: "Wet",
    areaHectAre: "0-10.00",
    areaSqm: 1000,
    fix: "1.44",
    fmbSketch: "/land/fmb_92_3.png",
    reference: "S/35/04/054/00586/80409",
  },
  {
    surveyNo: "93/4A",
    fieldNumber: 93,
    subdivision: "4A",
    pattaNo: "586",
    owner: "SRM Institute of Science & Technology",
    ownerType: "Institutional",
    classification: "Wet",
    areaHectAre: "0-9.50",
    areaSqm: 950,
    fix: "1.11",
    fmbSketch: "/land/fmb_93_4A.png",
    reference: "S/35/04/054/00586/80409",
  },
  {
    surveyNo: "93/3",
    fieldNumber: 93,
    subdivision: "3",
    pattaNo: "564",
    owner: "Valliammai Society, Chennai",
    ownerType: "Society",
    classification: "Wet",
    areaHectAre: "0-23.50",
    areaSqm: 2350,
    fix: "2.68",
    fmbSketch: "/land/fmb_93_3.png",
    reference: "S/35/04/054/00564/80485",
  },
];

export const RECORD_SOURCE = {
  authority: "Government of Tamil Nadu — Department of Revenue and Disaster Management",
  document: "Details of Land Holdings, C. No. 10(1) Section (Chitta extract)",
  district: "Chengalpattu",
  taluk: "Chengalpattu",
  revenueVillage: "Potheri",
  signedBy: "SANKAR V, Tahsildar",
  signedOn: "2020-01-24",
  verifyAt: "https://eservices.tn.gov.in",
};

export const TOTAL_REGISTERED_SQM = LAND_RECORDS.reduce((s, r) => s + r.areaSqm, 0);

// Tolerance for calling an extracted parcel "reconciled" with its registered
// area. Survey-grade cadastral work is far tighter than this; 15% reflects
// what a segmentation model working from ~0.3 m/px satellite imagery can
// honestly claim, and keeps the check meaningful rather than decorative.
export const RECONCILIATION_TOLERANCE = 0.15;

export function reconcile(extractedSqm, record) {
  const delta = extractedSqm - record.areaSqm;
  const ratio = delta / record.areaSqm;
  return {
    delta: Math.round(delta),
    ratioPct: Math.round(ratio * 1000) / 10,
    status: Math.abs(ratio) <= RECONCILIATION_TOLERANCE ? "reconciled" : "discrepancy",
  };
}
