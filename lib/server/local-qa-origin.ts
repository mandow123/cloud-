type Environment = Record<string, string | undefined>;

const LOCAL_QA_HOSTS = new Set([
  "buyer.localhost",
  "supplier.localhost",
  "root.localhost",
  "finance.localhost",
]);

export function isExplicitLocalQaHost(hostname: string, environment: Environment = typeof process === "undefined" ? {} : process.env) {
  return environment.KAI_ENVIRONMENT === "LOCAL"
    && environment.KAI_HOSTING_LOCAL_ACCEPTANCE === "1"
    && environment.KAI_ADMIN_LOCAL_AUTH === "1"
    && environment.KAI_ADMIN_LOCAL_MULTI_ROLE_QA === "1"
    && LOCAL_QA_HOSTS.has(hostname.toLowerCase());
}

export function isAllowedLocalQaOrigin(request: Request, origin: URL, environment: Environment = typeof process === "undefined" ? {} : process.env) {
  if (environment.NODE_ENV === "production"
    || environment.KAI_ADMIN_LOCAL_AUTH !== "1"
    || environment.KAI_ADMIN_LOCAL_MULTI_ROLE_QA !== "1") return false;
  const requestUrl = new URL(request.url);
  return LOCAL_QA_HOSTS.has(requestUrl.hostname)
    && origin.hostname === requestUrl.hostname
    && origin.protocol === requestUrl.protocol
    && origin.port === requestUrl.port;
}
