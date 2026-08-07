import type { ReactNode } from "react";
import { SupplyShell } from "@/components/supply-shell";

export default function SupplyLayout({ children }: { children: ReactNode }) {
  return <SupplyShell>{children}</SupplyShell>;
}
