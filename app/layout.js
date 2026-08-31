import "./globals.css";

export const metadata = {
  title: "GeoGovGadget — AI Cadastral Mapping",
  description:
    "AI-enabled automated cadastral mapping and urban parcel boundary extraction from drone/satellite imagery. SIH 2026, PS 26012, Team INFERICS.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-body bg-ink text-[#e7ebf2] antialiased">{children}</body>
    </html>
  );
}
