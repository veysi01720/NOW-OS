import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
export type HumanHandoffStatus = "pending"|"acknowledged"|"resolved"|"suppressed";
export interface HumanHandoffRecord {
 handoff_id:string; tenant_id:string; reason_code:string; urgency:"low"|"medium"|"high";
 conversation_key_hash:string; source_correlation_id:string; status:HumanHandoffStatus;
 notification_enabled:boolean; notification_status:"disabled"|"pending"|"sent"|"failed";
 created_at:string; updated_at:string;
 audit:Array<{event:"created"|"status_changed";actor:string;at:string;from?:string;to?:string}>;
}
export interface HumanHandoffStore {
 create(input:{tenant_id:string;reason_code:string;urgency?:"low"|"medium"|"high";conversation_key_hash:string;source_correlation_id:string}):{created:boolean;record:HumanHandoffRecord};
 list(limit?:number):HumanHandoffRecord[];
 stats():{pending_count:number;total_count:number;oldest_pending_at:string|null};
}
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
export class PersistentHumanHandoffStore implements HumanHandoffStore {
 private records:HumanHandoffRecord[]=[]; constructor(private readonly path:string){this.load();}
 private load(){try{const x=JSON.parse(readFileSync(this.path,"utf8")) as unknown;this.records=Array.isArray(x)?x:[];}catch{}}
 private save(){mkdirSync(dirname(this.path),{recursive:true});const tmp=`${this.path}.tmp`;writeFileSync(tmp,JSON.stringify(this.records,null,2),{encoding:"utf8",mode:0o600});renameSync(tmp,this.path);}
 create(input:{tenant_id:string;reason_code:string;urgency?:"low"|"medium"|"high";conversation_key_hash:string;source_correlation_id:string}){
  const key=hash([input.tenant_id,input.conversation_key_hash,input.reason_code].join("|"));
  const old=this.records.find(x=>x.conversation_key_hash===key&&x.status!=="resolved");
  if(old)return {created:false,record:old};
  const now=new Date().toISOString();const record:HumanHandoffRecord={
   handoff_id:randomUUID(),tenant_id:input.tenant_id,reason_code:input.reason_code,urgency:input.urgency??"medium",
   conversation_key_hash:key,source_correlation_id:input.source_correlation_id,status:"pending",
   notification_enabled:input.reason_code === "conversational_escalation_claim",
   notification_status:input.reason_code === "conversational_escalation_claim" ? "pending" : "disabled",created_at:now,updated_at:now,
   audit:[{event:"created",actor:"system",at:now}]};
  this.records.unshift(record);this.records=this.records.slice(0,5000);this.save();return {created:true,record};
 }
 list(limit=100){return this.records.slice(0,Math.max(1,Math.min(limit,500)));}
 stats(){const p=this.records.filter(x=>x.status==="pending");return {pending_count:p.length,total_count:this.records.length,oldest_pending_at:p.length?p[p.length-1].created_at:null};}
}
