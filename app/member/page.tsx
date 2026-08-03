import type { Metadata } from "next";
import { MemberWorkspace } from "@/components/member-workspace";

export const metadata: Metadata = {
  title: "会员工作台",
  description: "使用 KAI Cloud 需求方与供应方工作台；无需密码，需求、草稿与报价由服务端保存。",
};

export default function MemberPage() {
  return (
    <>
      <header className="border-b border-[var(--border)] bg-[var(--info-bg)]">
        <div className="shell py-12 sm:py-16">
          <p className="kicker">Member workspace</p>
          <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <h1 className="m-0 max-w-4xl text-4xl leading-tight sm:text-5xl">一处管理需求与供给两侧流程</h1>
              <p className="section-lead">需求方查看关注、需求与标准化方案；供应方维护草稿、匹配需求并提交报价。</p>
            </div>
            <div className="border-l-2 border-[var(--accent)] pl-5 text-sm text-[var(--text)]">
              <strong className="block text-[var(--ink)]">无密码访客工作台</strong>
              需求、草稿与报价由服务器按匿名会话保存，关注与工作视角留在本机。请勿输入个人资料、商业机密或访问凭据。
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
