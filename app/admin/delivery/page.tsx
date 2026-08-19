import { AdminManualDeliveryIntakes } from "@/components/admin-manual-delivery-intakes";
import { AdminResourcePage } from "@/components/admin-resource-page";
export default function Page() { return <AdminResourcePage beforeTable={<AdminManualDeliveryIntakes />} section="delivery" />; }
