import Link from "next/link";

export function AdminLoading({ label = "正在读取服务端数据…" }: { label?: string }) {
  return <div className="admin-state admin-state-loading" role="status"><span className="admin-loader" aria-hidden="true" />{label}</div>;
}

export function AdminEmpty({ title, description }: { title: string; description: string }) {
  return <div className="admin-state"><strong>{title}</strong><p>{description}</p></div>;
}

export function AdminError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="admin-state admin-state-error" role="alert">
      <strong>数据读取失败</strong>
      <p>{message}</p>
      {onRetry ? <button className="admin-button secondary" onClick={onRetry} type="button">重新读取</button> : null}
    </div>
  );
}

export function AdminLoginRequired({ forbidden = false }: { forbidden?: boolean }) {
  return (
    <div className="admin-state admin-auth-required" role="alert">
      <span className="admin-state-code">{forbidden ? "403" : "401"}</span>
      <strong>{forbidden ? "当前账号没有管理员权限" : "管理员会话尚未建立"}</strong>
      <p>{forbidden ? "当前账户不是唯一 Root；页面不会降级展示未授权数据。" : "请使用独立管理员账号密码登录，服务端会再次校验唯一 Root 权限。"}</p>
      <Link className="admin-button primary" href="/admin/login">前往管理员登录</Link>
    </div>
  );
}
