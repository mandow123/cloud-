const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class MarketFetchError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "MarketFetchError";
    this.code = code;
    this.retryable = retryable;
  }
}

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function shouldRetryStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("request timeout")), timeoutMs);
  timeout.unref?.();
  return { signal: controller.signal, dispose: () => clearTimeout(timeout) };
}

export async function fetchTextWithRetry(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  if (typeof fetchImpl !== "function") {
    throw new MarketFetchError("FETCH_UNAVAILABLE", "No fetch implementation is available", { retryable: true });
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 8) {
    throw new TypeError("attempts must be an integer between 1 and 8");
  }

  let lastFailure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const timeout = timeoutSignal(timeoutMs);
    try {
      const response = await fetchImpl(url, {
        headers: { accept: options.accept ?? "text/plain,*/*;q=0.8" },
        signal: timeout.signal,
      });
      if (!response || typeof response.text !== "function") {
        throw new MarketFetchError("INVALID_RESPONSE", `Invalid response from ${url}`, { retryable: true });
      }
      if (!response.ok) {
        throw new MarketFetchError("HTTP_ERROR", `${url} returned HTTP ${response.status}`, {
          retryable: shouldRetryStatus(response.status),
        });
      }
      const text = await response.text();
      if (text.length === 0) {
        throw new MarketFetchError("EMPTY_RESPONSE", `${url} returned an empty response`, { retryable: true });
      }
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
        throw new MarketFetchError("RESPONSE_TOO_LARGE", `${url} exceeded ${MAX_RESPONSE_BYTES} bytes`);
      }
      return Object.freeze({
        text,
        contentType: response.headers?.get?.("content-type") ?? "",
        attempts: attempt,
      });
    } catch (error) {
      lastFailure = error instanceof MarketFetchError
        ? error
        : new MarketFetchError("NETWORK_FAILURE", `Could not fetch ${url}`, { retryable: true, cause: error });
      if (!lastFailure.retryable || attempt === attempts) throw lastFailure;
      await sleepImpl(baseDelayMs * (2 ** (attempt - 1)));
    } finally {
      timeout.dispose();
    }
  }
  throw lastFailure;
}

export async function fetchJsonWithRetry(url, options = {}) {
  const result = await fetchTextWithRetry(url, {
    ...options,
    accept: "application/json",
  });
  try {
    return Object.freeze({ ...result, value: JSON.parse(result.text) });
  } catch (error) {
    throw new MarketFetchError("INVALID_JSON", `${url} did not return valid JSON`, { cause: error });
  }
}
