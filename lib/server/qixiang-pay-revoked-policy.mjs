import { createHash } from "node:crypto";

const REVOKED_MERCHANT_KEY_DIGESTS = new Set([
  "4d81683f5583c963560a31d39b8fcadfd7fa686b97519e26d9feaa6b7d523956",
  // Non-secret regression fixture used to prove the exception gate stays fail-closed.
  "48b179abed3a6cbe4f69dfacfeaea8eeec6cc9a405144fb23727fbdb6f37c94b",
]);

export function qixiangMerchantKeyDigest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function isRevokedQixiangMerchantKey(value) {
  return REVOKED_MERCHANT_KEY_DIGESTS.has(qixiangMerchantKeyDigest(value));
}

export function isRevokedQixiangMerchantKeyDigest(value) {
  return REVOKED_MERCHANT_KEY_DIGESTS.has(value);
}
