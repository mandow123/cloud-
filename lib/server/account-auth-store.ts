import { ADMIN_IDENTITY_SCHEMA_VERSION, adminIdentitySchemaStatements } from "../../db/admin-identity-schema.ts";
import { ADMIN_ROLES, type AdminAuthMethod, type AdminRole, type Membership, type Organization, type UserAccount } from "../admin-auth-types.ts";

export type AuthSql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export type AuthRunResult = Readonly<{ changes: number }>;

export interface AccountAuthDatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  run(sql: string, values?: readonly unknown[]): Promise<AuthRunResult>;
  batch(statements: readonly AuthSql[]): Promise<AuthRunResult[]>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

export type StoredSession = Readonly<{
  id: string;
  accountId: string;
  organizationId: string;
  authMethod: AdminAuthMethod;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}>;

export type ResolvedIdentity = Readonly<{
  account: UserAccount;
  organization: Organization;
  membership: Membership;
}>;

export type ResolvedSession = ResolvedIdentity & Readonly<{ session: StoredSession }>;

export type OtpChallenge = Readonly<{
  id: string;
  normalizedEmail: string;
  otpDigest: string;
  attempts: number;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}>;

export interface AccountAuthStore {
  createOAuthTransaction(input: { stateHash: string; returnPath: string; createdAt: string; expiresAt: string }): Promise<void>;
  consumeOAuthTransaction(stateHash: string, consumedAt: string): Promise<{ returnPath: string } | null>;
  resolveOrCreateIdentity(input: {
    provider: "LARK" | "EMAIL" | "LOCAL";
    tenantKey: string;
    subject: string;
    displayName: string;
    normalizedEmail: string | null;
    organizationExternalKey: string;
    organizationName: string;
    verifiedAt: string;
  }): Promise<ResolvedIdentity>;
  listMemberships(accountId: string): Promise<Array<Membership & { organization: Organization }>>;
  getMembership(accountId: string, organizationId: string): Promise<(Membership & { organization: Organization }) | null>;
  activateMembership(membershipId: string, roles: readonly AdminRole[], updatedAt: string): Promise<void>;
  isAdminBootstrapClosed(): Promise<boolean>;
  bootstrapAdminMembership(input: { membershipId: string; accountId: string; organizationId: string; sessionId: string; claimedAt: string }): Promise<boolean>;
  createSession(input: { tokenHash: string; accountId: string; organizationId: string; authMethod: AdminAuthMethod; now: string; idleExpiresAt: string; absoluteExpiresAt: string }): Promise<StoredSession>;
  resolveSession(tokenHash: string): Promise<ResolvedSession | null>;
  touchSession(sessionId: string, now: string, idleExpiresAt: string): Promise<boolean>;
  revokeSession(sessionId: string, revokedAt: string): Promise<boolean>;
  countRecentOtp(normalizedEmail: string, since: string): Promise<number>;
  latestOpenOtp(normalizedEmail: string): Promise<OtpChallenge | null>;
  createOtpChallenge(input: { id: string; normalizedEmail: string; otpDigest: string; requestFingerprint: string; createdAt: string; expiresAt: string }): Promise<void>;
  recordOtpFailure(id: string): Promise<boolean>;
  consumeOtp(id: string, consumedAt: string): Promise<boolean>;
  recordAudit(input: { accountId?: string; organizationId?: string; sessionId?: string; eventType: string; outcome: "ALLOWED" | "DENIED" | "ERROR"; target?: string; metadata?: Record<string, unknown>; occurredAt: string }): Promise<void>;
}

type Row = Record<string, unknown>;

function text(row: Row, key: string) { return String(row[key]); }
function nullableText(row: Row, key: string) { return row[key] == null ? null : String(row[key]); }

async function digestId(prefix: string, value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${hex.slice(0, 40)}`;
}

function validRoles(values: readonly string[]): AdminRole[] {
  const allowed = new Set<string>(ADMIN_ROLES);
  const roles = [...new Set(values)];
  if (roles.some((role) => !allowed.has(role))) throw new Error("ADMIN_ROLE_INVALID");
  return roles as AdminRole[];
}

function account(row: Row): UserAccount {
  return { id: text(row, "account_id"), displayName: text(row, "display_name"), primaryEmail: nullableText(row, "primary_email"), status: text(row, "account_status") as UserAccount["status"] };
}

function organization(row: Row): Organization {
  return { id: text(row, "organization_id"), name: text(row, "organization_name"), externalKey: text(row, "external_key"), status: text(row, "organization_status") as Organization["status"] };
}

async function readIdentity(db: AccountAuthDatabaseAdapter, provider: string, tenantKey: string, subject: string): Promise<ResolvedIdentity | null> {
  const row = await db.first<Row>(`SELECT a.id AS account_id,a.display_name,a.primary_email,a.status AS account_status,
      o.id AS organization_id,o.name AS organization_name,o.external_key,o.status AS organization_status,
      m.id AS membership_id,m.status AS membership_status
    FROM admin_account_identities i
    JOIN admin_user_accounts a ON a.id=i.account_id
    JOIN admin_organizations o ON o.id=i.organization_id
    JOIN admin_memberships m ON m.account_id=a.id AND m.organization_id=o.id
    WHERE i.provider=? AND i.tenant_key=? AND i.provider_subject=?`, [provider, tenantKey, subject]);
  if (!row) return null;
  const roleRows = await db.all<Row>("SELECT role FROM admin_membership_roles WHERE membership_id=? ORDER BY role", [text(row, "membership_id")]);
  return {
    account: account(row), organization: organization(row),
    membership: { id: text(row, "membership_id"), accountId: text(row, "account_id"), organizationId: text(row, "organization_id"), status: text(row, "membership_status") as Membership["status"], roles: validRoles(roleRows.map((item) => text(item, "role"))) },
  };
}

export async function createAccountAuthStore(db: AccountAuthDatabaseAdapter): Promise<AccountAuthStore> {
  await db.ensureSchema(adminIdentitySchemaStatements, ADMIN_IDENTITY_SCHEMA_VERSION);
  const readMemberships = async (accountId: string) => {
    const rows = await db.all<Row>(`SELECT m.id AS membership_id,m.account_id,m.organization_id,m.status AS membership_status,
        o.name AS organization_name,o.external_key,o.status AS organization_status
      FROM admin_memberships m JOIN admin_organizations o ON o.id=m.organization_id
      WHERE m.account_id=? ORDER BY o.name,o.id`, [accountId]);
    const results: Array<Membership & { organization: Organization }> = [];
    for (const row of rows) {
      const membershipId = text(row, "membership_id");
      const roleRows = await db.all<Row>("SELECT role FROM admin_membership_roles WHERE membership_id=? ORDER BY role", [membershipId]);
      results.push({
        id: membershipId, accountId: text(row, "account_id"), organizationId: text(row, "organization_id"),
        status: text(row, "membership_status") as Membership["status"], roles: validRoles(roleRows.map((item) => text(item, "role"))),
        organization: { id: text(row, "organization_id"), name: text(row, "organization_name"), externalKey: text(row, "external_key"), status: text(row, "organization_status") as Organization["status"] },
      });
    }
    return results;
  };
  return {
    async createOAuthTransaction(input) {
      await db.run("INSERT INTO admin_oauth_transactions(id,provider,state_hash,return_path,created_at,expires_at,consumed_at) VALUES(?,'LARK',?,?,?,?,NULL)", [crypto.randomUUID(), input.stateHash, input.returnPath, input.createdAt, input.expiresAt]);
    },
    async consumeOAuthTransaction(stateHash, consumedAt) {
      const row = await db.first<Row>("SELECT id,return_path FROM admin_oauth_transactions WHERE state_hash=? AND consumed_at IS NULL AND expires_at>?", [stateHash, consumedAt]);
      if (!row) return null;
      const result = await db.run("UPDATE admin_oauth_transactions SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?", [consumedAt, text(row, "id"), consumedAt]);
      return result.changes === 1 ? { returnPath: text(row, "return_path") } : null;
    },
    async resolveOrCreateIdentity(input) {
      const existing = await readIdentity(db, input.provider, input.tenantKey, input.subject);
      if (existing) return existing;
      const accountId = await digestId("acct", `${input.provider}:${input.tenantKey}:${input.subject}`);
      const organizationId = await digestId("org", input.organizationExternalKey);
      const membershipId = await digestId("mbr", `${accountId}:${organizationId}`);
      const identityId = await digestId("ident", `${input.provider}:${input.tenantKey}:${input.subject}`);
      const email = input.provider === "EMAIL" ? input.normalizedEmail : null;
      await db.batch([
        { sql: "INSERT OR IGNORE INTO admin_organizations(id,name,external_key,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)", values: [organizationId, input.organizationName, input.organizationExternalKey, input.verifiedAt, input.verifiedAt] },
        { sql: "INSERT OR IGNORE INTO admin_user_accounts(id,display_name,primary_email,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)", values: [accountId, input.displayName, email, input.verifiedAt, input.verifiedAt] },
        { sql: "INSERT OR IGNORE INTO admin_memberships(id,account_id,organization_id,status,created_at,updated_at) VALUES(?,?,?,'PENDING',?,?)", values: [membershipId, accountId, organizationId, input.verifiedAt, input.verifiedAt] },
        { sql: "INSERT OR IGNORE INTO admin_account_identities(id,account_id,organization_id,provider,tenant_key,provider_subject,normalized_email,verified_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)", values: [identityId, accountId, organizationId, input.provider, input.tenantKey, input.subject, input.normalizedEmail, input.verifiedAt, input.verifiedAt] },
      ]);
      const created = await readIdentity(db, input.provider, input.tenantKey, input.subject);
      if (!created) throw new Error("ADMIN_IDENTITY_CREATE_FAILED");
      return created;
    },
    async listMemberships(accountId) {
      return readMemberships(accountId);
    },
    async getMembership(accountId, organizationId) {
      return (await readMemberships(accountId)).find((item) => item.organizationId === organizationId) ?? null;
    },
    async activateMembership(membershipId, roles, updatedAt) {
      const normalized = validRoles(roles);
      const statements: AuthSql[] = [
        { sql: "UPDATE admin_memberships SET status='ACTIVE',updated_at=? WHERE id=?", values: [updatedAt, membershipId] },
        { sql: "DELETE FROM admin_membership_roles WHERE membership_id=?", values: [membershipId] },
        ...normalized.map((role) => ({ sql: "INSERT INTO admin_membership_roles(membership_id,role,granted_at,granted_by) VALUES(?,?,?,NULL)", values: [membershipId, role, updatedAt] })),
      ];
      const results = await db.batch(statements);
      if (results[0]?.changes !== 1) throw new Error("ADMIN_MEMBERSHIP_NOT_FOUND");
    },
    async isAdminBootstrapClosed() {
      const row = await db.first<{ closed: number }>(`SELECT 1 AS closed FROM admin_bootstrap_claim
        UNION ALL
        SELECT 1 AS closed FROM admin_membership_roles r
        JOIN admin_memberships m ON m.id=r.membership_id
        WHERE r.role='ROLE_ADMIN' AND m.status='ACTIVE'
        LIMIT 1`);
      return row != null;
    },
    async bootstrapAdminMembership(input) {
      const result = await db.run(`INSERT OR IGNORE INTO admin_bootstrap_claim(singleton,membership_id,account_id,organization_id,session_id,claimed_at)
        SELECT 1,m.id,m.account_id,m.organization_id,?,?
        FROM admin_memberships m
        JOIN admin_user_accounts a ON a.id=m.account_id
        JOIN admin_organizations o ON o.id=m.organization_id
        WHERE m.id=? AND m.account_id=? AND m.organization_id=?
          AND m.status IN ('PENDING','ACTIVE') AND a.status='ACTIVE' AND o.status='ACTIVE'
          AND NOT EXISTS (SELECT 1 FROM admin_bootstrap_claim)
          AND NOT EXISTS (
            SELECT 1 FROM admin_membership_roles r
            JOIN admin_memberships existing ON existing.id=r.membership_id
            WHERE r.role='ROLE_ADMIN' AND existing.status='ACTIVE'
          )`, [input.sessionId, input.claimedAt, input.membershipId, input.accountId, input.organizationId]);
      return result.changes > 0;
    },
    async createSession(input) {
      const id = `as_${crypto.randomUUID()}`;
      await db.run(`INSERT INTO admin_account_sessions(id,account_id,organization_id,token_hash,auth_method,created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at)
        VALUES(?,?,?,?,?,?,?,?,?,NULL)`, [id, input.accountId, input.organizationId, input.tokenHash, input.authMethod, input.now, input.now, input.idleExpiresAt, input.absoluteExpiresAt]);
      return { id, accountId: input.accountId, organizationId: input.organizationId, authMethod: input.authMethod, createdAt: input.now, lastSeenAt: input.now, idleExpiresAt: input.idleExpiresAt, absoluteExpiresAt: input.absoluteExpiresAt };
    },
    async resolveSession(tokenHash) {
      const row = await db.first<Row>(`SELECT s.id AS session_id,s.account_id,s.organization_id,s.auth_method,s.created_at AS session_created_at,s.last_seen_at,s.idle_expires_at,s.absolute_expires_at,s.revoked_at,
          a.display_name,a.primary_email,a.status AS account_status,o.name AS organization_name,o.external_key,o.status AS organization_status,
          m.id AS membership_id,m.status AS membership_status
        FROM admin_account_sessions s JOIN admin_user_accounts a ON a.id=s.account_id
        JOIN admin_organizations o ON o.id=s.organization_id
        JOIN admin_memberships m ON m.account_id=s.account_id AND m.organization_id=s.organization_id
        WHERE s.token_hash=?`, [tokenHash]);
      if (!row || row.revoked_at != null) return null;
      const roleRows = await db.all<Row>("SELECT role FROM admin_membership_roles WHERE membership_id=? ORDER BY role", [text(row, "membership_id")]);
      return {
        account: account(row), organization: organization(row),
        membership: { id: text(row, "membership_id"), accountId: text(row, "account_id"), organizationId: text(row, "organization_id"), status: text(row, "membership_status") as Membership["status"], roles: validRoles(roleRows.map((item) => text(item, "role"))) },
        session: { id: text(row, "session_id"), accountId: text(row, "account_id"), organizationId: text(row, "organization_id"), authMethod: text(row, "auth_method") as AdminAuthMethod, createdAt: text(row, "session_created_at"), lastSeenAt: text(row, "last_seen_at"), idleExpiresAt: text(row, "idle_expires_at"), absoluteExpiresAt: text(row, "absolute_expires_at") },
      };
    },
    async touchSession(sessionId, now, idleExpiresAt) {
      return (await db.run("UPDATE admin_account_sessions SET last_seen_at=?,idle_expires_at=? WHERE id=? AND revoked_at IS NULL AND idle_expires_at>? AND absolute_expires_at>?", [now, idleExpiresAt, sessionId, now, now])).changes === 1;
    },
    async revokeSession(sessionId, revokedAt) {
      return (await db.run("UPDATE admin_account_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL", [revokedAt, sessionId])).changes === 1;
    },
    async countRecentOtp(normalizedEmail, since) {
      const row = await db.first<{ count: number }>("SELECT COUNT(*) AS count FROM admin_email_otp_challenges WHERE normalized_email=? AND created_at>=?", [normalizedEmail, since]);
      return Number(row?.count ?? 0);
    },
    async latestOpenOtp(normalizedEmail) {
      const row = await db.first<Row>("SELECT * FROM admin_email_otp_challenges WHERE normalized_email=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1", [normalizedEmail]);
      return row ? { id: text(row, "id"), normalizedEmail: text(row, "normalized_email"), otpDigest: text(row, "otp_digest"), attempts: Number(row.attempts), createdAt: text(row, "created_at"), expiresAt: text(row, "expires_at"), consumedAt: nullableText(row, "consumed_at") } : null;
    },
    async createOtpChallenge(input) {
      await db.run("INSERT INTO admin_email_otp_challenges(id,normalized_email,otp_digest,request_fingerprint,attempts,created_at,expires_at,consumed_at) VALUES(?,?,?,?,0,?,?,NULL)", [input.id, input.normalizedEmail, input.otpDigest, input.requestFingerprint, input.createdAt, input.expiresAt]);
    },
    async recordOtpFailure(id) {
      return (await db.run("UPDATE admin_email_otp_challenges SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5", [id])).changes === 1;
    },
    async consumeOtp(id, consumedAt) {
      return (await db.run("UPDATE admin_email_otp_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>?", [consumedAt, id, consumedAt])).changes === 1;
    },
    async recordAudit(input) {
      await db.run(`INSERT INTO admin_auth_audit_events(id,account_id,organization_id,session_id,event_type,outcome,target,metadata_json,occurred_at)
        VALUES(?,?,?,?,?,?,?,?,?)`, [`aae_${crypto.randomUUID()}`, input.accountId ?? null, input.organizationId ?? null, input.sessionId ?? null, input.eventType, input.outcome, input.target ?? null, JSON.stringify(input.metadata ?? {}), input.occurredAt]);
    },
  };
}

declare global { var __kaiAccountAuthStorePromise: Promise<AccountAuthStore> | undefined; }

async function resolveAccountAuthStore(): Promise<AccountAuthStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) {
      const { createD1AccountAuthStore } = await import("./account-auth-d1.ts");
      return createD1AccountAuthStore(cloudflare.env.DB);
    }
  } catch { /* Node runtime. */ }
  const { createSqliteAccountAuthStore } = await import("./account-auth-sqlite.ts");
  return createSqliteAccountAuthStore();
}

export function getAccountAuthStore() {
  globalThis.__kaiAccountAuthStorePromise ??= resolveAccountAuthStore().catch((error) => {
    globalThis.__kaiAccountAuthStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiAccountAuthStorePromise;
}
