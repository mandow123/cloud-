export function isAgentTelemetryV1Enabled(environment: Record<string, string | undefined> = process.env) {
  return environment.KAI_AGENT_TELEMETRY_V1?.trim() === "1";
}
