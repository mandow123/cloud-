import type { Metadata } from "next";
import { SupplyResourceRegistration } from "@/components/supply-resource-registration";

export const metadata: Metadata = {
  title: "登记新资源",
  description: "选择资源模板并签发一次性 KAI Host Agent 配对凭证。",
};

export default function SupplyResourceRegistrationPage() {
  return <SupplyResourceRegistration />;
}
