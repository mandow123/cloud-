import type { Metadata } from "next";
import { AccountRequired } from "@/components/account-required";
import { CardHourAccountPanel } from "@/components/card-hour-account-panel";

export const metadata: Metadata = {
  title: "我的资产",
  description: "查看 KAI 标准卡时资产、账本明细、租金佣金收益与充值状态。",
};

export default function MemberAssetsPage() {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">MY ASSETS</p>
          <h1 className="m-0 text-4xl leading-tight sm:text-5xl">我的资产</h1>
          <p className="section-lead max-w-3xl">集中查看卡时资产、不可变账本、租金与佣金收益，以及卡时充值状态。</p>
        </div>
      </header>
      <div className="shell py-12 sm:py-16">
        <AccountRequired purpose="查看我的资产">
          <CardHourAccountPanel />
        </AccountRequired>
      </div>
    </>
  );
}
