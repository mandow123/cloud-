import { permanentRedirect } from "next/navigation";

export default function SupplyResourceRegistrationPage() {
  permanentRedirect("/supply/devices/new");
}
