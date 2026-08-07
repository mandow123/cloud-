"use client";

import { AccountRequired } from "@/components/account-required";
import { MemberWorkspace } from "@/components/member-workspace";

export function AccountWorkspace() {
  return (
    <AccountRequired purpose="进入交易工作台">
      <MemberWorkspace />
    </AccountRequired>
  );
}

