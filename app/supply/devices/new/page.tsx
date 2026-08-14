import type { Metadata } from "next";
import { SupplyResourceRegistration } from "@/components/supply-resource-registration";

export const metadata: Metadata = {
  title: "连接托管设备",
  description: "选择设备模板并签发一次性 KAI Host Agent 配对凭证。",
};

export default function SupplyDeviceRegistrationPage() {
  return <SupplyResourceRegistration />;
}
