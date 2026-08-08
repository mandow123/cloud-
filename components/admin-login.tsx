"use client";

import { useState } from "react";
import { adminErrorMessage, bootstrapRootAccount, localAdminLogin } from "@/components/admin-api-client";

export function AdminLogin({ environment, localLoginEnabled }: { environment: string; localLoginEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [error, setError] = useState("");
  const isLocal = environment.toUpperCase() === "LOCAL";

  async function loginLocally() {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await localAdminLogin());
    } catch (loginError) {
      setError(adminErrorMessage(loginError, "LOCAL 测试登录暂时不可用。"));
      setBusy(false);
    }
  }

  async function bootstrapRoot() {
    setBootstrapBusy(true);
    setError("");
    try {
      await bootstrapRootAccount(bootstrapCode);
      window.location.assign("/admin");
    } catch (bootstrapError) {
      setError(adminErrorMessage(bootstrapError, "Root 初始化未完成。"));
      setBootstrapBusy(false);
    }
  }

  return (
    <div className="admin-login-main">
      <section className="admin-login-card" aria-labelledby="admin-login-title">
        <p className="admin-kicker">Protected operations</p>
        <h1 id="admin-login-title">登录 KAI 管理后台</h1>
        <p>后台包含供应、需求、订单、支付与交付运营数据。登录成功后，服务端仍会逐请求检查管理员角色和权限范围。</p>

        {error ? <div className="admin-inline-error" role="alert"><strong>登录未完成</strong><span>{error}</span></div> : null}

        <div className="admin-login-actions">
          <a className="admin-button primary" href="/api/auth/lark/start?returnTo=%2Fadmin">使用飞书登录</a>
          {!isLocal ? <a className="admin-button secondary" href="/login?returnTo=%2Fadmin%2Flogin">使用邮箱登录</a> : null}
          {isLocal && localLoginEnabled ? <button className="admin-button secondary" disabled={busy} onClick={() => void loginLocally()} type="button">{busy ? "正在建立 LOCAL 会话…" : "LOCAL 受控测试登录"}</button> : null}
        </div>

        {isLocal ? (
          <div className="admin-local-panel">
            <strong>LOCAL 环境</strong>
            <p>{localLoginEnabled ? "测试登录只调用受控 `/api/auth/local`，唯一 Root 身份来自服务端配置；前端不会要求密钥，也不会指定或伪造管理员身份。" : "LOCAL Root 登录未由服务端显式开启；请配置本地认证服务后再试。"}</p>
          </div>
        ) : null}

        {!isLocal ? (
          <div className="admin-local-panel">
            <strong>首次初始化唯一 Root</strong>
            <p>先使用飞书或邮箱完成正式登录，再输入服务器生成的一次性引导码。Root 建立后该入口会永久关闭，不能再创建第二个 Root。</p>
            <label><span>一次性 Root 引导码</span><input autoComplete="off" onChange={(event) => setBootstrapCode(event.target.value)} type="password" value={bootstrapCode} /></label>
            <button className="admin-button secondary" disabled={bootstrapBusy || bootstrapCode.length < 32} onClick={() => void bootstrapRoot()} type="button">{bootstrapBusy ? "正在建立 Root…" : "建立唯一 Root 账号"}</button>
          </div>
        ) : null}

        <dl className="admin-login-rules">
          <div><dt>未登录</dt><dd>不读取任何后台业务数据</dd></div>
          <div><dt>无权限</dt><dd>显示 403，不降级到普通用户数据</dd></div>
          <div><dt>操作记录</dt><dd>写操作必须包含理由并进入审计</dd></div>
        </dl>
      </section>
    </div>
  );
}
