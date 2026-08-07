import type { ReactNode } from "react";

export function AdminPageHeader({ kicker, title, description, actions }: { kicker: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="admin-page-header">
      <div>
        <p>{kicker}</p>
        <h1>{title}</h1>
        <span>{description}</span>
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </header>
  );
}
