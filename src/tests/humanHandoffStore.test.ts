import {describe,expect,it} from "vitest";
import {mkdtempSync} from "node:fs"; import {tmpdir} from "node:os"; import {join} from "node:path";
import {PersistentHumanHandoffStore} from "../store/humanHandoffStore.js";
describe("human handoff store",()=>{it("deduplicates and persists",()=>{
 const d=mkdtempSync(join(tmpdir(),"handoff-"));const s=new PersistentHumanHandoffStore(join(d,"handoffs.json"));
 const a=s.create({tenant_id:"now_os",reason_code:"MODEL_UNABLE_TO_COMPLETE",conversation_key_hash:"hash",source_correlation_id:"c1"});
 const b=s.create({tenant_id:"now_os",reason_code:"MODEL_UNABLE_TO_COMPLETE",conversation_key_hash:"hash",source_correlation_id:"c2"});
 expect(a.created).toBe(true);expect(b.created).toBe(false);expect(s.stats().pending_count).toBe(1);expect(s.list()[0].notification_enabled).toBe(false);
});});

describe("handoff notification policy",()=>{it("enables owner notification only for conversational escalation claims",()=>{
 const d=mkdtempSync(join(tmpdir(),"handoff-notification-"));const s=new PersistentHumanHandoffStore(join(d,"handoffs.json"));
 const escalation=s.create({tenant_id:"now_os",reason_code:"conversational_escalation_claim",conversation_key_hash:"escalation",source_correlation_id:"c1"});
 const other=s.create({tenant_id:"now_os",reason_code:"post_install_training_gate",conversation_key_hash:"training",source_correlation_id:"c2"});
 expect(escalation.record.notification_enabled).toBe(true);expect(escalation.record.notification_status).toBe("pending");
 expect(other.record.notification_enabled).toBe(false);expect(other.record.notification_status).toBe("disabled");
});});

describe("owner answer-required handoffs",()=>{it("stores a sanitized candidate question and resolves it",()=>{
 const d=mkdtempSync(join(tmpdir(),"handoff-owner-query-"));const s=new PersistentHumanHandoffStore(join(d,"handoffs.json"));
 const query=s.createOwnerQuery({tenant_id:"now_os",conversation_key_hash:"candidate",source_correlation_id:"c1",candidate_phone:"905333333333",question_sanitized:"Kurulum kodu neden gerekli?",failure_reason:"verified_knowledge_missing_or_unavailable"});
 expect(query.created).toBe(true);expect(query.record.reason_code).toBe("owner_answer_required");expect(s.findPendingOwnerQuery()?.owner_query?.question_sanitized).toContain("Kurulum");
 expect(s.markOwnerNotification(query.record.handoff_id,"sent")).toBe(true);
 expect(s.resolveOwnerQuery(query.record.handoff_id)).toBe(true);expect(s.findPendingOwnerQuery()).toBeNull();
});});

describe("owner-query escalation reason preservation",()=>{it("keeps the original conversational reason while enabling owner relay",()=>{
 const d=mkdtempSync(join(tmpdir(),"handoff-conversational-query-"));const s=new PersistentHumanHandoffStore(join(d,"handoffs.json"));
 const query=s.createOwnerQuery({tenant_id:"now_os",reason_code:"conversational_escalation_claim",conversation_key_hash:"candidate",source_correlation_id:"c1",candidate_phone:"905333333333",question_sanitized:"Bu akış ne demek?",failure_reason:"model_response_needs_owner_review"});
 expect(query.created).toBe(true);expect(query.record.reason_code).toBe("conversational_escalation_claim");expect(query.record.notification_enabled).toBe(true);expect(s.findPendingOwnerQuery()?.handoff_id).toBe(query.record.handoff_id);
});});

describe("legacy conversational escalation upgrade",()=>{it("turns an old non-query handoff into a notifiable owner query",()=>{
 const d=mkdtempSync(join(tmpdir(),"handoff-conversational-upgrade-"));const s=new PersistentHumanHandoffStore(join(d,"handoffs.json"));
 const old=s.create({tenant_id:"now_os",reason_code:"conversational_escalation_claim",conversation_key_hash:"candidate",source_correlation_id:"old"});
 const query=s.createOwnerQuery({tenant_id:"now_os",reason_code:"conversational_escalation_claim",conversation_key_hash:"candidate",source_correlation_id:"new",candidate_phone:"905333333333",question_sanitized:"Bu akış ne demek?",failure_reason:"model_response_needs_owner_review"});
 expect(old.created).toBe(true);expect(query.created).toBe(true);expect(query.record.handoff_id).toBe(old.record.handoff_id);expect(query.record.owner_query?.candidate_phone).toBe("905333333333");expect(query.record.notification_status).toBe("pending");
});});

describe("owner-query lookup",()=>{it("does not mistake a regular handoff for an owner question",()=>{
 const d=mkdtempSync(join(tmpdir(),"handoff-query-filter-"));const s=new PersistentHumanHandoffStore(join(d,"handoffs.json"));
 s.create({tenant_id:"now_os",reason_code:"ASSISTANT_RESPONSE_INVALID",conversation_key_hash:"candidate",source_correlation_id:"c1"});
 expect(s.findPendingOwnerQuery()).toBeNull();
});});
