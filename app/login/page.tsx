import type { Metadata } from "next";
import { EmailLogin } from "@/components/email-login";

export const metadata: Metadata = {
  title: "登录 KAI Cloud",
  description: "使用邮箱验证码登录 KAI Cloud 买家或供应商账户。",
};

export default function LoginPage() {
  return (
    <div className="login-page shell">
      <EmailLogin />
      <aside className="login-aside" aria-label="登录说明">
        <p className="kicker">ACCOUNT BOUNDARY</p>
        <h2>先确认主体，再开始交易</h2>
        <ol>
          <li>登录后选择个人、企业、IDC 或云厂商主体。</li>
          <li>上架、需求和订单都归属于所选主体。</li>
          <li>旧匿名记录不会自动并入新账户，可单独申请认领。</li>
        </ol>
        <p>正式环境缺少邮件服务配置时，验证码发送会安全阻断，不会在页面显示验证码。</p>
      </aside>
    </div>
  );
}

