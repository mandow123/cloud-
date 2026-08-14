import { permanentRedirect } from "next/navigation";

export default async function SupplyResourceDetailPage({ params }: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  permanentRedirect(`/supply/devices/${encodeURIComponent(deviceId)}`);
}
