const rawPort = process.argv[2] ?? "3014";
if (!/^\d{4,5}$/u.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) {
  throw new Error("LOCAL_PREVIEW_PORT_INVALID");
}

process.env.HOSTNAME = "127.0.0.1";
process.env.HOST = "127.0.0.1";
process.env.PORT = rawPort;
process.env.KAI_PUBLIC_ORIGIN = `http://127.0.0.1:${rawPort}`;
process.env.KAI_ENVIRONMENT = "LOCAL";
process.env.KAI_ADMIN_LOCAL_AUTH = "1";
process.env.KAI_ADMIN_LOCAL_ROLES = "ROLE_ADMIN";
process.env.KAI_ADMIN_LOCAL_SUBJECT = "local-preview-admin";
process.env.KAI_ADMIN_LOCAL_DISPLAY_NAME = "KAI 本地管理员";

await import("../../dist/standalone/server.js");
