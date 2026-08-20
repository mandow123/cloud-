import { kaiPublicApiClients } from "./public-api-auth.ts";
import type { KaiPublicApiStore } from "./public-api-store.ts";
import { getKaiPublicApiStore } from "./public-api-store.ts";

type Environment = Record<string, string | undefined>;
const encoder = new TextEncoder();
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

function allowedHosts(environment: Environment) {
  const values = (environment.KAI_PUBLIC_API_WEBHOOK_ALLOWED_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (values.length > 100 || values.some((value) => !HOSTNAME.test(value))) throw new Error("WEBHOOK_TARGET_REJECTED");
  return new Set(values);
}

function safeTarget(value: string, environment: Environment) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const production = (environment.KAI_ENVIRONMENT ?? environment.NODE_ENV ?? "").trim().toUpperCase() === "PRODUCTION";
  const allowlist = allowedHosts(environment);
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(host);
  const ipv6 = host.startsWith("[") || host.includes(":");
  if (url.protocol !== "https:" || url.username || url.password || url.hash || ipv4 || ipv6
    || host === "localhost" || host.endsWith(".localhost")
    || (allowlist.size > 0 && !allowlist.has(host)) || (production && allowlist.size === 0)) throw new Error("WEBHOOK_TARGET_REJECTED");
  return url;
}

async function signature(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
  return `sha256=${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function deliverOneKaiPublicWebhook(options: { store?: KaiPublicApiStore; http?: typeof fetch; now?: Date; environment?: Environment } = {}) {
  const store = options.store ?? await getKaiPublicApiStore();
  const now = options.now ?? new Date();
  const environment = options.environment ?? process.env;
  const delivery = await store.nextWebhook(now.toISOString());
  if (!delivery) return null;
  const client = kaiPublicApiClients(environment).find((candidate) => candidate.clientId === delivery.clientId);
  if (!client?.webhookUrl || !client.webhookSecret) {
    await store.failWebhook(delivery.deliveryId, "WEBHOOK_NOT_CONFIGURED", now.toISOString(), true);
    return { deliveryId: delivery.deliveryId, delivered: false, terminal: true };
  }
  try {
    const target = safeTarget(client.webhookUrl, environment);
    const body = JSON.stringify(delivery.payload);
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const response = await (options.http ?? fetch)(target, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { "content-type": "application/json", "x-kai-delivery-id": delivery.deliveryId, "x-kai-timestamp": timestamp, "x-kai-signature": await signature(client.webhookSecret, timestamp, body) },
      body,
    });
    if (response.status >= 200 && response.status < 300) {
      await store.completeWebhook(delivery.deliveryId, now.toISOString());
      return { deliveryId: delivery.deliveryId, delivered: true, terminal: false };
    }
    const terminal = delivery.attempt >= 7 || (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429);
    const delay = Math.min(3_600, 2 ** Math.min(delivery.attempt, 10) * 5);
    await store.failWebhook(delivery.deliveryId, `WEBHOOK_HTTP_${response.status}`, new Date(now.getTime() + delay * 1_000).toISOString(), terminal);
    return { deliveryId: delivery.deliveryId, delivered: false, terminal };
  } catch (error) {
    const terminal = delivery.attempt >= 7 || (error instanceof Error && error.message === "WEBHOOK_TARGET_REJECTED");
    const delay = Math.min(3_600, 2 ** Math.min(delivery.attempt, 10) * 5);
    await store.failWebhook(delivery.deliveryId, error instanceof Error && error.message === "WEBHOOK_TARGET_REJECTED" ? "WEBHOOK_TARGET_REJECTED" : "WEBHOOK_DELIVERY_FAILED", new Date(now.getTime() + delay * 1_000).toISOString(), terminal);
    return { deliveryId: delivery.deliveryId, delivered: false, terminal };
  }
}
