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
