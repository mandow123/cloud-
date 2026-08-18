import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ProductionEnvironmentError, validateProductionEnvironment } from "../scripts/ops/validate-production-env.mjs";

const base = {
  KAI_CURSOR_SECRET: "6f0d91c82243a7e5b314cd86f05129ea7b8c42d366a9e501fc83bd0471a259de",
  KAI_PUBLIC_ORIGIN: "https://cloud.kai.com",
  KAI_RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
  KAI_IMAGE_REFERENCE: `registry.example.test/kai-cloud-market@sha256:${"1a2b".repeat(16)}`,
  KAI_TRUST_PROXY: "1",
  KAI_REQUIRE_HTTPS_WRITES: "1",
  KAI_ENABLE_HSTS: "0",
  KAI_DB_DIR: "/app/db",
  KAI_MARKET_DATA_DIR: "/app/market",
  KAI_ALIPAY_ENABLED: "0",
  KAI_HOSTING_V2: "0",
  KAI_HOSTING_V2_SETUP: "0",
  KAI_HOSTING_DEVICE_RETIREMENT: "0",
};
const ROOT_HASH = `pbkdf2-sha256:310000:AAAAAAAAAAAAAAAAAAAAAA==:${"A".repeat(43)}=`;
const APPROVER_HASH = `pbkdf2-sha256:310000:QkJCQkJCQkJCQkJCQkJCQg==:${"B".repeat(43)}=`;

function rejection(environment, expected) {
  assert.throws(
    () => validateProductionEnvironment(environment),
    (error) => error instanceof ProductionEnvironmentError && error.message.includes(expected),
  );
}

test("production trial gate keeps Alipay disabled even if credentials are present", () => {
  validateProductionEnvironment({ ...base, KAI_ALIPAY_APP_ID: "configured-but-closed" });
  rejection({ ...base, KAI_ALIPAY_ENABLED: "1" }, "KAI_ALIPAY_ENABLED");
});

test("Hosting V2 cannot start without identity, immutable image and terms policy", () => {
  rejection({ ...base, KAI_HOSTING_V2: "1" }, "KAI_HOSTING_APPROVED_IMAGES");
  const enabled = {
    ...base,
    KAI_HOSTING_V2: "1",
    KAI_HOSTING_APPROVED_IMAGES: `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`,
    KAI_HOSTING_TERMS_VERSION: "KAI_HOSTING_TERMS_2026_08",
    KAI_ACCOUNT_OIDC_CLIENT_ID: "kaic_gqLnfmgdF_tmAc5Xcvg1J_F1UsCUDrGOM83ZigHh1MQ",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "67fc59de0a8d976f89aa95f61e7c0d8944e9e5ad39f0cbdf5316aa8c3e4ab0fa",
    KAI_ADMIN_USERNAME: "kai-root",
    KAI_ADMIN_PASSWORD_HASH: ROOT_HASH,
    KAI_ADMIN_APPROVER_USERNAME: "kai-finance-approver",
    KAI_ADMIN_APPROVER_PASSWORD_HASH: APPROVER_HASH,
  };
  assert.equal(validateProductionEnvironment(enabled).hostingV2Enabled, true);
  assert.equal(validateProductionEnvironment(enabled).hostingV2SetupEnabled, true);
  rejection({ ...enabled, KAI_HOSTING_APPROVED_IMAGES: "ghcr.io/kai-cloud/cuda-pytorch:latest" }, "KAI_HOSTING_APPROVED_IMAGES");
  rejection({ ...enabled, KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "replace-me-with-a-secret-that-is-long" }, "KAI_ACCOUNT_OIDC_TRANSACTION_SECRET");
  rejection({ ...enabled, KAI_ADMIN_APPROVER_USERNAME: "kai-root" }, "KAI_ADMIN_APPROVER_USERNAME");
  rejection({ ...enabled, KAI_ADMIN_APPROVER_PASSWORD_HASH: ROOT_HASH }, "different password");
});

test("Hosting V2 setup validates every production dependency without opening trading", () => {
  const setup = {
    ...base,
    KAI_HOSTING_V2_SETUP: "1",
    KAI_HOSTING_APPROVED_IMAGES: `ghcr.io/mandow123/kai-cloud-gpu-workload@sha256:${"a".repeat(64)}`,
    KAI_HOSTING_TERMS_VERSION: "KAI_HOSTING_TERMS_2026_08",
    KAI_ACCOUNT_OIDC_CLIENT_ID: "kaic_gqLnfmgdF_tmAc5Xcvg1J_F1UsCUDrGOM83ZigHh1MQ",
    KAI_ACCOUNT_OIDC_TRANSACTION_SECRET: "67fc59de0a8d976f89aa95f61e7c0d8944e9e5ad39f0cbdf5316aa8c3e4ab0fa",
    KAI_ADMIN_USERNAME: "kai-root",
    KAI_ADMIN_PASSWORD_HASH: ROOT_HASH,
    KAI_ADMIN_APPROVER_USERNAME: "kai-finance-approver",
    KAI_ADMIN_APPROVER_PASSWORD_HASH: APPROVER_HASH,
  };
  const validated = validateProductionEnvironment(setup);
  assert.equal(validated.hostingV2Enabled, false);
  assert.equal(validated.hostingV2SetupEnabled, true);
  assert.equal(validated.hostingDeviceRetirementEnabled, false);
  assert.equal(validateProductionEnvironment({ ...setup, KAI_HOSTING_DEVICE_RETIREMENT: "1" }).hostingDeviceRetirementEnabled, true);
  rejection({ ...base, KAI_HOSTING_DEVICE_RETIREMENT: "1" }, "requires Hosting V2 setup");
  rejection({ ...base, KAI_HOSTING_V2_SETUP: "1" }, "KAI_HOSTING_APPROVED_IMAGES");
});

test("production templates carry the rollback and payment gates into the container", () => {
  const compose = readFileSync(new URL("../deploy/compose.production.yml", import.meta.url), "utf8");
  const environment = readFileSync(new URL("../deploy/kai-cloud-app.env.example", import.meta.url), "utf8");
  assert.match(compose, /KAI_HOSTING_V2: "\$\{KAI_HOSTING_V2:-0\}"/u);
  assert.match(compose, /KAI_MARKET_V1: "\$\{KAI_MARKET_V1:-1\}"/u);
  assert.match(compose, /KAI_HOSTING_V2_SETUP: "\$\{KAI_HOSTING_V2_SETUP:-0\}"/u);
  assert.match(compose, /KAI_HOSTING_DEVICE_RETIREMENT: "\$\{KAI_HOSTING_DEVICE_RETIREMENT:-0\}"/u);
  assert.match(compose, /KAI_ALIPAY_ENABLED: "\$\{KAI_ALIPAY_ENABLED:-0\}"/u);
  assert.match(compose, /KAI_ADMIN_APPROVER_USERNAME/u);
  assert.match(compose, /KAI_ADMIN_APPROVER_PASSWORD_HASH/u);
  assert.match(environment, /^KAI_HOSTING_V2=0$/mu);
  assert.match(environment, /^KAI_MARKET_V1=1$/mu);
  assert.match(environment, /^KAI_HOSTING_V2_SETUP=0$/mu);
  assert.match(environment, /^KAI_HOSTING_DEVICE_RETIREMENT=0$/mu);
  assert.match(environment, /^KAI_ALIPAY_ENABLED=0$/mu);
  assert.match(environment, /^KAI_ADMIN_APPROVER_USERNAME=/mu);
  assert.match(environment, /^KAI_ADMIN_APPROVER_PASSWORD_HASH=/mu);
});
