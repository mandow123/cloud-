import type { ResourceListing } from "@/lib/types";

const MANUAL_SSH_DELIVERY_FORMS = new Set<ResourceListing["deliveryForm"]>([
  "裸金属",
  "容器实例",
  "专属集群",
  "云主机",
]);

export function requiresManualSshPublicKey(resource: Pick<ResourceListing, "deliveryForm">) {
  return MANUAL_SSH_DELIVERY_FORMS.has(resource.deliveryForm);
}
