import type { Metadata } from "next";
import { AccountWorkspace } from "@/components/account-workspace";
import { KaiStandardSlot } from "@/components/kai-standard-slot";

export const metadata: Metadata = {
  title: "交易工作台",
  description: "使用 KAI Cloud 正式账户查看买方需求、供应资源、报价与交易状态。",
};

export default function MemberPage() {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">交易记录</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">算力交易工作台</h1>
              <p className="section-lead">需求方查看采购与置换进度；供应方登记可供容量、匹配需求并提交报价。</p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">当前设备会话</strong>
              需求、可供资源与报价按当前会话保存，关注列表和需求方/供应方视角留在本机。请勿输入个人资料、商业机密或访问凭据。
              <KaiStandardSlot slot="member-kai-hours-v1" />
            </div>
          </div>
        </div>
      </header>
      <div className="shell py-12 sm:py-16">
        <AccountWorkspace />
      </div>
    </>
  );
}
