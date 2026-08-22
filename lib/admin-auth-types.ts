export const ADMIN_ROLES = [
  "ROOT",
  "ROLE_ADMIN",
  "INTAKE_OPERATOR",
  "INVENTORY_OPERATOR",
  "VERIFICATION_REVIEWER",
  "MARKET_OPERATOR",
  "FULFILLMENT_OPERATOR",
  "FINANCE_OPERATOR",
  "FINANCE_APPROVER",
  "SUPPORT_READONLY",
  "AUDITOR",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = [
  "ROOT_CONTROL",
  "ADMIN_PANEL_READ",
  "IDENTITY_READ",
  "IDENTITY_MANAGE",
  "MEMBERSHIP_MANAGE",
  "SUPPLY_INTAKE_READ",
  "SUPPLY_INTAKE_REVIEW",
  "KAI_SELF_INVENTORY_READ",
  "KAI_SELF_INVENTORY_WRITE",
  "VERIFICATION_QUEUE_READ",
  "VERIFICATION_REVIEW",
  "MARKET_READ",
  "MARKET_PUBLISH",
  "FULFILLMENT_READ",
  "FULFILLMENT_OPERATE",
  "PAYMENT_READ",
  "PAYMENT_OPERATE",
  "SETTLEMENT_OPERATE",
  "REFUND_REQUEST",
  "REFUND_APPROVE",
  "SUPPORT_READ",
  "APPEAL_READ",
  "APPEAL_HANDLE",
  "APPEAL_EVIDENCE_READ",
  "OFFLINE_REFUND_RECORD",
  "OFFLINE_REFUND_VERIFY",
  "AUDIT_READ",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export type UserAccount = Readonly<{
  id: string;
  displayName: string;
  primaryEmail: string | null;
  status: "ACTIVE" | "SUSPENDED";
}>;

export type Organization = Readonly<{
  id: string;
  name: string;
  externalKey: string;
  status: "ACTIVE" | "SUSPENDED";
}>;

export type Membership = Readonly<{
  id: string;
  accountId: string;
  organizationId: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  roles: readonly AdminRole[];
}>;

export type AdminPrincipal = Readonly<{
  id: string;
  displayName: string;
  roles: readonly AdminRole[];
  permissions: readonly AdminPermission[];
  status: "ACTIVE";
}>;

export type AdminAuthContext = Readonly<{
  principal: AdminPrincipal;
  account: UserAccount;
  organization: Organization;
  sessionId: string;
}>;

export type AdminAuthMethod = "LARK_OAUTH" | "EMAIL_OTP" | "LOCAL_TEST" | "KAI_IDENTITY_OIDC" | "ADMIN_PASSWORD";
