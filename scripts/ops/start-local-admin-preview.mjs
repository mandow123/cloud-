const rawPort = process.argv[2] ?? "3014";
if (!/^\d{4,5}$/u.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) {
  throw new Error("LOCAL_PREVIEW_PORT_INVALID");
}

process.loadEnvFile?.(".env.local");
if (!process.env.KAI_ADMIN_USERNAME || !process.env.KAI_ADMIN_PASSWORD_HASH?.startsWith("pbkdf2-sha256:")) {
  throw new Error("ADMIN_PASSWORD_ENV_REQUIRED");
}

process.env.HOSTNAME = "127.0.0.1";
process.env.HOST = "127.0.0.1";
process.env.PORT = rawPort;
process.env.KAI_PUBLIC_ORIGIN = `http://127.0.0.1:${rawPort}`;
process.env.KAI_ENVIRONMENT = "LOCAL";
process.env.KAI_HOSTING_LOCAL_ACCEPTANCE ??= "1";
process.env.KAI_HOSTING_LOCAL_REACHABILITY_SIMULATION ??= "1";

await import("../../dist/standalone/server.js");
