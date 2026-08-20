export function isBuyCatalogV2EnabledForEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return environment.KAI_BUY_CATALOG_V2 === "1";
}

export function isBuyCatalogV2Enabled() {
  return isBuyCatalogV2EnabledForEnvironment();
}
