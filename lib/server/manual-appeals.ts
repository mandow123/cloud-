import { AccountAuthError } from "./account-auth.ts";
import type { AdminManualAppealCase } from "./admin-store.ts";

export function manualAppealsEnabled(environment:Record<string,string|undefined>=process.env){return environment.KAI_MANUAL_APPEALS_V1?.trim()==="1";}
export function requireManualAppealsEnabled(environment:Record<string,string|undefined>=process.env){if(!manualAppealsEnabled(environment))throw new AccountAuthError("MANUAL_APPEALS_NOT_FOUND",404,"申诉通道尚未开放。 ");}
export function rejectAppealEvidence(value:unknown){if(Array.isArray(value)&&value.length===0)return;if(value!=null)throw new AccountAuthError("MANUAL_APPEAL_EVIDENCE_UNAVAILABLE",422,"私有证据上传尚未开放，本期仅支持文本说明。 ");}
export function redactAdminManualAppealEvidence(record:AdminManualAppealCase){return{...record,offlineRefunds:record.offlineRefunds.map((item)=>({id:item.id,status:item.status,amountMinor:item.amountMinor,currency:item.currency,methodLabel:item.methodLabel,maskedReference:item.maskedReference,proofSubmittedAt:item.proofSubmittedAt,proofVerifiedAt:item.proofVerifiedAt}))};}
export function redactAdminManualAppealMutation<T extends {record:AdminManualAppealCase}>(result:T){return{...result,record:redactAdminManualAppealEvidence(result.record)};}
