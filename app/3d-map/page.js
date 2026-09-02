import { readFile } from "fs/promises";
import { join } from "path";
import MapWorkspace from "@/components/MapWorkspace";

export const metadata = {
  title: "Cadastral Map — GeoGovGadget",
  description: "Georeferenced parcel extraction over SRM KTR, checked against registered land records.",
};

export default async function CadastralMapPage() {
  const parcels = JSON.parse(
    await readFile(join(process.cwd(), "public", "parcels.geojson"), "utf-8")
  );
  return <MapWorkspace parcels={parcels} />;
}
