import type {
  KaiHoursAccountEnvelope as ServiceKaiHoursAccountEnvelope,
  KaiStandardQuote as ServiceKaiStandardQuote,
  KaiStandardQuoteEnvelope as ServiceKaiStandardQuoteEnvelope,
  StandardizationProductCode,
  StandardizationSnapshotStatus,
} from "./standardization.ts";

export type SnapshotStatus = StandardizationSnapshotStatus;
export type KaiStandardPolicy = ServiceKaiStandardQuoteEnvelope["policy"];
export type KaiStandardQuote = ServiceKaiStandardQuote;
export type KaiStandardQuoteEnvelope = ServiceKaiStandardQuoteEnvelope;
export type KaiHoursAccountEnvelope = ServiceKaiHoursAccountEnvelope;
export type KaiHoursPosition = ServiceKaiHoursAccountEnvelope["positions"][number];

const STANDARDIZATION_PRODUCT_CODES = new Set<StandardizationProductCode>([
  "GPU_COMPUTE",
  "MODEL_INSTANCE",
  "TOKEN_THROUGHPUT",
  "NAS_STORAGE",
  "RACK_SPACE",
]);

export class KaiStandardContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KaiStandardContractError";
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KaiStandardContractError(`${field} 不是对象。`);
  return value as JsonRecord;
}

function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new KaiStandardContractError(`${field} 缺少有效文本。`);
  return value.trim();
}

function dateTime(value: unknown, field: string) {
  const valueText = text(value, field);
  if (!Number.isFinite(Date.parse(valueText))) throw new KaiStandardContractError(`${field} 不是有效时间。`);
  return valueText;
}

function status(value: unknown, field: string): SnapshotStatus {
  if (value !== "CURRENT" && value !== "STALE" && value !== "UNAVAILABLE") throw new KaiStandardContractError(`${field} 不是支持的状态。`);
  return value;
}

function productCode(value: unknown, field: string): StandardizationProductCode {
  if (typeof value !== "string" || !STANDARDIZATION_PRODUCT_CODES.has(value as StandardizationProductCode)) {
    throw new KaiStandardContractError(`${field} 不是支持的资源类型。`);
  }
  return value as StandardizationProductCode;
}

function nonNegativeDecimal(value: unknown, field: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new KaiStandardContractError(`${field} 不是非负十进制字符串。`);
  }
  return value;
}

function optionalIntegerString(value: unknown, field: string) {
  if (value == null) return null;
  return integerString(value, field);
}

function nonNegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new KaiStandardContractError(`${field} 不是安全的非负整数。`);
  }
  return value;
}

function integerString(value: unknown, field: string) {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    throw new KaiStandardContractError(`${field} 不是非负整数字符串。`);
  }
  return value;
}

function array(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new KaiStandardContractError(`${field} 不是数组。`);
  return value;
}

function decimalOrder(left: string, right: string) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(`${leftInteger}${leftFraction.padEnd(scale, "0")}`);
  const rightValue = BigInt(`${rightInteger}${rightFraction.padEnd(scale, "0")}`);
  return leftValue <= rightValue;
}

export function parseKaiStandardQuoteEnvelope(value: unknown): KaiStandardQuoteEnvelope {
  const root = record(value, "响应");
  const policyValue = record(root.policy, "policy");
  const policy: KaiStandardPolicy = {
    version: text(policyValue.version, "policy.version"),
    unitCode: text(policyValue.unitCode, "policy.unitCode"),
    benchmarkLabel: text(policyValue.benchmarkLabel, "policy.benchmarkLabel"),
  };
  const snapshotValue = record(root.snapshot, "snapshot");
  const snapshot = {
    asOf: dateTime(snapshotValue.asOf, "snapshot.asOf"),
    expiresAt: dateTime(snapshotValue.expiresAt, "snapshot.expiresAt"),
    status: status(snapshotValue.status, "snapshot.status"),
    p25CnyMicros: optionalIntegerString(snapshotValue.p25CnyMicros, "snapshot.p25CnyMicros"),
    p50CnyMicros: optionalIntegerString(snapshotValue.p50CnyMicros, "snapshot.p50CnyMicros"),
    p75CnyMicros: optionalIntegerString(snapshotValue.p75CnyMicros, "snapshot.p75CnyMicros"),
    sampleCount: nonNegativeInteger(snapshotValue.sampleCount, "snapshot.sampleCount"),
  } as const;
  if (snapshot.status !== "UNAVAILABLE") {
    if (Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.asOf)) throw new KaiStandardContractError("有效行情的 expiresAt 必须晚于 asOf。");
    if (snapshot.sampleCount < 1 || snapshot.p25CnyMicros == null || snapshot.p50CnyMicros == null || snapshot.p75CnyMicros == null) {
      throw new KaiStandardContractError("有效行情缺少价格分位或样本。");
    }
    if (!decimalOrder(snapshot.p25CnyMicros, snapshot.p50CnyMicros) || !decimalOrder(snapshot.p50CnyMicros, snapshot.p75CnyMicros)) {
      throw new KaiStandardContractError("行情人民币价格分位顺序无效。");
    }
  }
  const quotes = array(root.quotes, "quotes").map((item, index): KaiStandardQuote => {
    const quote = record(item, `quotes[${index}]`);
    const policyVersion = text(quote.policyVersion, `quotes[${index}].policyVersion`);
    if (policyVersion !== policy.version) throw new KaiStandardContractError(`quotes[${index}] 的政策版本不一致。`);
    const parsedQuote = {
      productCode: productCode(quote.productCode, `quotes[${index}].productCode`),
      productVersionId: text(quote.productVersionId, `quotes[${index}].productVersionId`),
      productLabel: text(quote.productLabel, `quotes[${index}].productLabel`),
      nativeUnitCode: text(quote.nativeUnitCode, `quotes[${index}].nativeUnitCode`),
      nativeUnitLabel: text(quote.nativeUnitLabel, `quotes[${index}].nativeUnitLabel`),
      region: text(quote.region, `quotes[${index}].region`),
      p25KaiSch: nonNegativeDecimal(quote.p25KaiSch, `quotes[${index}].p25KaiSch`),
      p50KaiSch: nonNegativeDecimal(quote.p50KaiSch, `quotes[${index}].p50KaiSch`),
      p75KaiSch: nonNegativeDecimal(quote.p75KaiSch, `quotes[${index}].p75KaiSch`),
      sampleCount: nonNegativeInteger(quote.sampleCount, `quotes[${index}].sampleCount`),
      asOf: dateTime(quote.asOf, `quotes[${index}].asOf`),
      expiresAt: dateTime(quote.expiresAt, `quotes[${index}].expiresAt`),
      policyVersion,
    };
    if (parsedQuote.sampleCount < 1 || Date.parse(parsedQuote.expiresAt) <= Date.parse(parsedQuote.asOf)) {
      throw new KaiStandardContractError(`quotes[${index}] 缺少有效样本或有效期。`);
    }
    if (!decimalOrder(parsedQuote.p25KaiSch, parsedQuote.p50KaiSch) || !decimalOrder(parsedQuote.p50KaiSch, parsedQuote.p75KaiSch)) {
      throw new KaiStandardContractError(`quotes[${index}] 的 KAI-SCH 分位顺序无效。`);
    }
    return parsedQuote;
  });
  return { policy, snapshot, quotes };
}

export function parseKaiHoursAccountEnvelope(value: unknown): KaiHoursAccountEnvelope {
  const root = record(value, "响应");
  const summary = record(root.summary, "summary");
  const income = record(root.income, "income");
  const parsed = {
    policyVersion: text(root.policyVersion, "policyVersion"),
    asOf: dateTime(root.asOf, "asOf"),
    expiresAt: dateTime(root.expiresAt, "expiresAt"),
    status: status(root.status, "status"),
    summary: {
      depositedKaiSch: nonNegativeDecimal(summary.depositedKaiSch, "summary.depositedKaiSch"),
      availableKaiSch: nonNegativeDecimal(summary.availableKaiSch, "summary.availableKaiSch"),
      earnedKaiSch: nonNegativeDecimal(summary.earnedKaiSch, "summary.earnedKaiSch"),
      settlementCnyCents: integerString(summary.settlementCnyCents, "summary.settlementCnyCents"),
    },
    positions: array(root.positions, "positions").map((item, index): KaiHoursPosition => {
      const position = record(item, `positions[${index}]`);
      return {
        productCode: productCode(position.productCode, `positions[${index}].productCode`),
        productVersionId: text(position.productVersionId, `positions[${index}].productVersionId`),
        productLabel: text(position.productLabel, `positions[${index}].productLabel`),
        nativeAmount: nonNegativeDecimal(position.nativeAmount, `positions[${index}].nativeAmount`),
        nativeUnitLabel: text(position.nativeUnitLabel, `positions[${index}].nativeUnitLabel`),
        availableKaiSch: nonNegativeDecimal(position.availableKaiSch, `positions[${index}].availableKaiSch`),
        heldKaiSch: nonNegativeDecimal(position.heldKaiSch, `positions[${index}].heldKaiSch`),
      };
    }),
    income: {
      pendingCnyCents: integerString(income.pendingCnyCents, "income.pendingCnyCents"),
      payableCnyCents: integerString(income.payableCnyCents, "income.payableCnyCents"),
      settledCnyCents: integerString(income.settledCnyCents, "income.settledCnyCents"),
    },
  } as const;
  if (parsed.status !== "UNAVAILABLE" && Date.parse(parsed.expiresAt) <= Date.parse(parsed.asOf)) {
    throw new KaiStandardContractError("有效账户快照的 expiresAt 必须晚于 asOf。");
  }
  return parsed;
}

export function snapshotIsExpired(expiresAt: string, now = new Date()) {
  return Date.parse(expiresAt) <= now.getTime();
}

export type KaiStandardPresentationState = "UNAVAILABLE" | "STALE" | "EMPTY" | "READY";

export function quotePresentationState(
  data: KaiStandardQuoteEnvelope,
  now = new Date(),
): KaiStandardPresentationState {
  if (data.snapshot.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (data.snapshot.status === "STALE" || snapshotIsExpired(data.snapshot.expiresAt, now)) return "STALE";
  return data.quotes.length === 0 ? "EMPTY" : "READY";
}

export function accountPresentationState(
  data: KaiHoursAccountEnvelope,
  now = new Date(),
): KaiStandardPresentationState {
  if (data.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (data.status === "STALE" || snapshotIsExpired(data.expiresAt, now)) return "STALE";
  return data.positions.length === 0 ? "EMPTY" : "READY";
}

export type MemberResponseState = "SIGNED_OUT" | "FORBIDDEN" | "READY" | "ERROR";

export function memberResponseState(httpStatus: number): MemberResponseState {
  if (httpStatus === 401) return "SIGNED_OUT";
  if (httpStatus === 403) return "FORBIDDEN";
  if (httpStatus >= 200 && httpStatus < 300) return "READY";
  return "ERROR";
}

export function formatKaiDecimal(value: string) {
  const [integer, fraction = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const visibleFraction = fraction.slice(0, 4).replace(/0+$/u, "");
  return visibleFraction ? `${grouped}.${visibleFraction}` : grouped;
}

export function formatKaiSchDisplay(value: string) {
  const [integer, fraction = ""] = value.split(".");
  let hundredths = BigInt(integer) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if ((fraction[2] ?? "0") >= "5") hundredths += 1n;
  const whole = (hundredths / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${whole}.${(hundredths % 100n).toString().padStart(2, "0")}`;
}

export function formatCnyCents(value: string) {
  const cents = BigInt(value);
  const centsPerYuan = BigInt(100);
  return `¥${(cents / centsPerYuan).toLocaleString("zh-CN")}.${(cents % centsPerYuan).toString().padStart(2, "0")}`;
}

export function formatCnyMicros(value: string | null) {
  if (value == null) return "—";
  const micros = BigInt(value);
  const cents = (micros + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `¥${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

export function formatKaiDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
}
