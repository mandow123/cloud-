import { cnyCentsToCardHourMicros, formatCardHourDisplayMicros, topupAmountCents } from "../card-hours.ts";
import { AccountAuthError, type AccountSessionContext } from "./account-auth.ts";
import { alipayReadiness, createAlipayCheckoutUrl, type AlipayEnvironment } from "./alipay-live.ts";
import { mutationHash } from "./api-guard.ts";
import { getCardHourStore, type CardHourStore } from "./card-hour-store.ts";

type Dependencies = Readonly<{
  environment?: AlipayEnvironment;
  getStore?: () => Promise<CardHourStore>;
}>;

function runtimeEnvironment(): AlipayEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

export async function createCardHourTopupOrder(input: {
  account: AccountSessionContext;
  cardHourMicros: number;
  idempotencyKey: string;
  now: Date;
}, dependencies: Dependencies = {}) {
  const environment = dependencies.environment ?? runtimeEnvironment();
  const readiness = alipayReadiness(environment);
  if (!readiness.canCreatePayment) {
    throw new AccountAuthError(
      "TOPUP_CLOSED",
      503,
      "卡时充值暂未开放。支付通道、退款、发票与资金规则完成验收后开放；当前试运营卡时由平台审核发放。 ",
    );
  }

  const amountCents = topupAmountCents(input.cardHourMicros);
  const store = await (dependencies.getStore ?? getCardHourStore)();
  const result = await store.createTopup({
    account: input.account,
    cardHourMicros: input.cardHourMicros,
    amountCents,
    idempotencyKey: input.idempotencyKey,
    payloadHash: await mutationHash({ cardHourMicros: input.cardHourMicros, amountCents }),
    now: input.now.toISOString(),
    expiresAt: new Date(input.now.getTime() + 15 * 60_000).toISOString(),
  });
  const record = result.record as { id: string };
  const checkout = createAlipayCheckoutUrl({
    orderId: record.id,
    amountCents,
    subject: `KAI Cloud 购买 ${formatCardHourDisplayMicros(input.cardHourMicros)} 卡时`,
    expiresMinutes: 15,
    returnPath: "/member/assets?topup=return#topup",
  }, environment);
  return {
    record: result.record,
    checkoutUrl: checkout.checkoutUrl,
    rate: { cardHours: "1", cny: "1.002" },
    referenceMicrosForOneYuan: cnyCentsToCardHourMicros(100),
    replayed: result.replayed,
  } as const;
}
