import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { BuyerOrderList } from "@/components/buyer-order-list";
import { MemberWorkspace } from "@/components/member-workspace";
import { PersonalCenterOverview } from "@/components/personal-center-overview";

export const metadata: Metadata = {
  title: "个人中心",
  description: "管理 KAI Cloud 个人资料、购买申请、订单、待支付、待验收与资源对比。",
};

export default function MemberPage() {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">Personal & transaction workspace</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">个人中心与交易工作台</h1>
              <p className="section-lead">查看购买申请、正式订单、支付与验收进度，并继续管理需求和供应流程。</p>
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
        <MemberWorkspace />
        <section className="mt-16 scroll-mt-28" id="orders">
          <AccountRequired purpose="查看个人订单">
            <BuyerOrderList />
          </AccountRequired>
        </section>
      </div>
    </>
  );
}
