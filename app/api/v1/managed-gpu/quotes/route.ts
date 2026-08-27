import { apiErrorResponse, beginApiRequest, jsonResponse } from "@/lib/server/api-guard";
import { managedGpuChoice, managedGpuCountry, managedGpuCurrency, managedGpuInteger, managedGpuMemberMutation, managedGpuReadBody, managedGpuRejectFields, managedGpuString } from "@/lib/server/managed-gpu-api";
import { requireManagedGpuFeature } from "@/lib/server/managed-gpu-feature";
import { getManagedGpuStore } from "@/lib/server/managed-gpu-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const context = beginApiRequest(request);
  try {
    requireManagedGpuFeature();
    const body = await managedGpuReadBody(request);
    managedGpuRejectFields(body, ["id", "organizationId", "accountId", "status", "unitAmountMinor", "totalAmountMinor", "issuedCurrency", "version", "annualReturn", "guaranteedReturn"]);
    const { context: mutation } = await managedGpuMemberMutation(request, body);
    const fulfillmentChoice = managedGpuChoice(body);
    const facilityId = fulfillmentChoice === "BEIDOU_HOSTING" ? managedGpuString(body, "facilityId", 8, 100) : null;
    const destinationCountryCode = fulfillmentChoice === "GLOBAL_SHIPPING" ? managedGpuCountry(body.destinationCountryCode, "destinationCountryCode") : null;
    const result = await (await getManagedGpuStore()).createQuote(mutation, { productVersionId: managedGpuString(body, "productVersionId", 8, 100), facilityId, quantity: managedGpuInteger(body, "quantity", 1, 100), fulfillmentChoice, requestedCurrency: managedGpuCurrency(body, "requestedCurrency"), destinationCountryCode });
    return jsonResponse(result, result.replayed ? 200 : 201, { "idempotency-replayed": String(result.replayed) }, context);
  } catch (error) { return apiErrorResponse(error, undefined, context); }
}
