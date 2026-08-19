type AccountConsoleEnvironment = Record<string, string | undefined>;

function enabled(value: string | undefined) {
  return ["1", "true"].includes((value ?? "").trim().toLowerCase());
}

export function isAccountConsoleV2EnabledForEnvironment(environment: AccountConsoleEnvironment) {
  return enabled(environment.KAI_ACCOUNT_CONSOLE_V2);
}

export function isAccountConsoleV2Enabled() {
  return typeof process !== "undefined" && isAccountConsoleV2EnabledForEnvironment(process.env);
}

export function supplyHostingPageRedirectForEnvironment(environment: AccountConsoleEnvironment) {
  const hostingConfigurationEnabled = [environment.KAI_HOSTING_V2, environment.KAI_HOSTING_V2_SETUP]
    .some((value) => enabled(value));
  return isAccountConsoleV2EnabledForEnvironment(environment) && !hostingConfigurationEnabled
    ? "/supply"
    : null;
}
