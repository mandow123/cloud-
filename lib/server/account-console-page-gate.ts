import { redirect } from "next/navigation";
import { supplyHostingPageRedirectForEnvironment } from "./account-console-feature.ts";

export function requireSupplyHostingPageAccess() {
  const destination = supplyHostingPageRedirectForEnvironment(process.env);
  if (destination) redirect(destination);
}
