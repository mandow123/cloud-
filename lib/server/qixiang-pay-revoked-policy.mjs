import { createHash } from "node:crypto";

const REVOKED_MERCHANT_KEY_DIGESTS = new Set([
  "4d81683f5583c963560a31d39b8fcadfd7fa686b97519e26d9feaa6b7d523956",
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
