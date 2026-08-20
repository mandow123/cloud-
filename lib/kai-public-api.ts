export type KaiPublicVerificationStatus = "pending" | "running" | "passed" | "failed" | "revoked";

export type KaiPublicVerification = Readonly<{
  id: string;
  organizationReference: string;
  resourceReference: string;
  productCode: string;
  region: string;
  specifications: Readonly<Record<string, unknown>>;
  deviceId: string | null;
  commandId: string | null;
  version: number;
  status: KaiPublicVerificationStatus;
  failure: Readonly<{ code: string; message: string }> | null;
  createdAt: string;
  updatedAt: string;
}>;

export type KaiPublicDevice = Readonly<{
  id: string;
  status: "registering" | "checking" | "ready" | "offline" | "revoked";
  lastHeartbeatAt: string | null;
  updatedAt: string;
}>;

export type KaiPublicWebhookDelivery = Readonly<{
  deliveryId: string;
  clientId: string;
  verificationId: string;
  eventVersion: number;
  payload: Readonly<Record<string, unknown>>;
  attempt: number;
  nextAttemptAt: string;
}>;
