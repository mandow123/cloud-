import { PricingPrototypeError, fail } from "./errors.mjs";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function fetchText(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    fail("NETWORK_UNAVAILABLE", "No fetch implementation is available", { retryable: true });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: options.accept ?? "text/plain,*/*;q=0.8" },
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch (error) {
    if (error instanceof PricingPrototypeError) throw error;
    fail("NETWORK_FAILURE", `Could not fetch ${url}`, { cause: error, retryable: true });
  }

  if (!response || typeof response.text !== "function") {
    fail("NETWORK_FAILURE", `Fetch implementation returned an invalid response for ${url}`, { retryable: true });
  }
  if (!response.ok) {
    fail("HTTP_ERROR", `${url} returned HTTP ${response.status}`, {
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    });
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    fail("RESPONSE_TOO_LARGE", `${url} exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (text.length === 0) {
    fail("EMPTY_RESPONSE", `${url} returned an empty response`, { retryable: true });
  }
  return { text, contentType: response.headers?.get?.("content-type") ?? "" };
}
