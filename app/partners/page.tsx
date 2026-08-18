import { permanentRedirect } from "next/navigation";

export default function PartnersPage() {
  const origin = process.env.KAI_PUBLIC_ORIGIN?.trim() || "https://cloud.kai.com";
  permanentRedirect(new URL("/hosting/partners", origin).toString());
}
