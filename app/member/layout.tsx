import { AccountConsoleShell } from "@/components/account-console-shell";
import { isAccountConsoleV2Enabled } from "@/lib/server/account-console-feature";

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  if (!isAccountConsoleV2Enabled()) return children;
  return <AccountConsoleShell mode="buyer">{children}</AccountConsoleShell>;
}
