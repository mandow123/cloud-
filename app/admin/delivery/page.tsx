import { AdminManualCommercialOrders } from "@/components/manual-commercial-orders";
import { AdminManualDeliveryIntakes } from "@/components/admin-manual-delivery-intakes";
import { AdminResourcePage } from "@/components/admin-resource-page";
import { manualOrderFlowEnabled } from "@/lib/server/manual-order-feature";
export default function Page() { return <AdminResourcePage beforeTable={<>{manualOrderFlowEnabled() ? <AdminManualCommercialOrders /> : null}<AdminManualDeliveryIntakes /></>} section="delivery" />; }
