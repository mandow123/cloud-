export function manualDeliveryIntakeEnabled(environment: Record<string, string | undefined> = process.env) {
  return environment.KAI_MANUAL_DELIVERY_INTAKE?.trim() === "1";
}
