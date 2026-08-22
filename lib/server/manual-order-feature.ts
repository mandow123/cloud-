import { AccountAuthError } from "./account-auth.ts";
export function manualOrderFlowEnabled(environment:Record<string,string|undefined>=process.env){return environment.KAI_MANUAL_ORDER_FLOW_V1?.trim()==="1";}
export function requireManualOrderFlowEnabled(environment:Record<string,string|undefined>=process.env){if(!manualOrderFlowEnabled(environment))throw new AccountAuthError("MANUAL_ORDER_FLOW_NOT_FOUND",404,"人工算力订单功能尚未开放。 ");}
