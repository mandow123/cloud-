import type { Metadata } from "next";
import { MemberWorkspace } from "@/components/member-workspace";

export const metadata: Metadata = {
  title: "演示会员中心",
  description: "体验 KAI Cloud 需求方与供应方工作台；无需密码，所有操作仅保存在当前浏览器。",
};

export default function MemberPage() {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">Member workspace</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">一处体验需求与供给两侧流程</h1>
              <p className="section-lead">需求方查看关注、需求与标准化方案；供应方维护草稿、匹配需求并提交演示报价。</p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">无密码演示</strong>
              没有真实账号、后台或消息发送。请勿输入任何个人资料或商业机密。
            </div>
          </div>
        </div>
      </header>
      <div className="shell py-12 sm:py-16">
        <MemberWorkspace />
      </div>
    </>
  );
}
