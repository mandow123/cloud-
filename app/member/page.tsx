import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { BuyerOrderList } from "@/components/buyer-order-list";
import { HostingContractList } from "@/components/hosting-contract-list";
import { MemberWorkspace } from "@/components/member-workspace";
import { PersonalCenterOverview } from "@/components/personal-center-overview";
import { CardHourAccountPanel } from "@/components/card-hour-account-panel";
import { MemberPurchaseIntentList } from "@/components/member-purchase-intents";
import { AccountConsoleOverview } from "@/components/account-console-overview";
import { isAccountConsoleV2Enabled } from "@/lib/server/account-console-feature";
import { isHostingV2Enabled } from "@/lib/server/hosting-v2-feature";

export const metadata: Metadata = {
  title: "个人中心",
  description: "查看当前组织的 KAI 标准卡时、算力申请与人工交付进度。",
};

export default function MemberPage() {
  if (isAccountConsoleV2Enabled()) {
    return <AccountRequired purpose="进入采购账户" redirectOnSignedOut><AccountConsoleOverview mode="buyer" /></AccountRequired>;
  }
  const hostingV2Enabled = isHostingV2Enabled();
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">Personal & transaction workspace</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">个人中心与交易工作台</h1>
              <p className="section-lead">查看卡时余额、购买记录、资源对比、回购、租金收益和邀请佣金，并继续管理需求与供应流程。</p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">账户与交易主体严格分离</strong>
              正式交易只读取当前登录账户和当前主体的数据；资源对比暂时保存在本机，不代表下单、锁库存或付款。
            </div>
          </div>
        </div>
      </header>
      <div className="shell py-12 sm:py-16">
        <PersonalCenterOverview />
        <AccountRequired purpose="查看算力申请">
          <MemberPurchaseIntentList compact />
        </AccountRequired>
        <CardHourAccountPanel />
        <MemberWorkspace />
        <section className="mt-16 scroll-mt-28" id="orders">
          <AccountRequired purpose="查看个人订单">
            <div className="grid gap-16">
              {hostingV2Enabled ? <HostingContractList embedded /> : null}
              <BuyerOrderList />
            </div>
          </AccountRequired>
        </section>
      </div>
    </>
  );
}
