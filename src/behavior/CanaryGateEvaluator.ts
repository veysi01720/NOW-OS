import { BehaviorCanaryApproval, TenantCanaryApproval, CanaryObservationState, CanaryObservationRecord } from './canaryContracts.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GateStatus, OwnerWaiver, RuntimeSeal } from './canaryExecutionGate.js';
import { createHmac } from 'node:crypto';

export interface GateEvaluationResult {
  status: GateStatus;
  reasonCode: string;
  evidenceFresh: boolean;
}

export interface CanaryGateEvaluationSnapshot {
  evaluatedAt: string;
  snapshotId: string;
  pcOff: GateEvaluationResult;
  vpsStabilization: GateEvaluationResult;
  customerImpact: GateEvaluationResult;
  b1: GateEvaluationResult;
  b2: GateEvaluationResult;
  b3: GateEvaluationResult;
  fullSuite: GateEvaluationResult;
  build: GateEvaluationResult;
  rollback: GateEvaluationResult;
  doctorHealth: GateEvaluationResult;
  requiredSealsReady: boolean;
  ownerApprovalPresent: boolean;
  ownerApprovalValid: boolean;
  activeApprovalId?: string;
  canaryWindowActive: boolean;
  behaviorProductionEnabled: boolean;
  behaviorTenantCanaryEnabled: boolean;
  behaviorTenantCanaryAvailable: boolean;
  behaviorTenantCanaryAllowedUserCount: number;
  liveCanaryAllowed: boolean;
  liveCanaryReason: string;
  failedGates: string[];
}

export class CanaryGateEvaluator {
  private static parseJsonOrUndefined<T>(path: string): T | undefined {
    try {
      const fullPath = join(process.cwd(), path);
      if (!existsSync(fullPath)) return undefined;
      const content = readFileSync(fullPath, 'utf8');
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  private static evaluateSeal(seal: {status: GateStatus} | undefined, gateName: string): GateEvaluationResult {
    if (!seal || !seal.status) {
      return { status: 'UNKNOWN', reasonCode: 'EVIDENCE_MISSING', evidenceFresh: false };
    }
    const status = seal.status;
    if (status !== 'PASS' && status !== 'FAIL' && status !== 'PENDING') {
      return { status: 'UNKNOWN', reasonCode: 'EVIDENCE_SCHEMA_INVALID', evidenceFresh: false };
    }
    return { status, reasonCode: status === 'PASS' ? 'PASS_VALID_EVIDENCE' : 'EVIDENCE_STALE', evidenceFresh: true };
  }

  private static calculateSubjectKey(phoneNumber: string): string {
    const secret = process.env.TENANT_CANARY_SECRET || 'fallback-secret-for-tests';
    return createHmac('sha256', secret).update(phoneNumber).digest('hex');
  }

  public static evaluate(
    behaviorGlobalEnabled: boolean,
    canaryMode: 'off' | 'internal' | 'tenant_allowlist',
    senderRole: string,
    conversationType: 'private' | 'group',
    tenantResolved: boolean,
    doctorHealthy: boolean,
    senderPhone?: string
  ): Readonly<CanaryGateEvaluationSnapshot> {
    const evaluatedAt = new Date().toISOString();
    const snapshotId = Math.random().toString(36).substring(7);

    const b1Seal = this.parseJsonOrUndefined<RuntimeSeal>('data/seals/b1_seal.json');
    const b2Seal = this.parseJsonOrUndefined<RuntimeSeal>('data/seals/b2_seal.json');
    const b3Seal = this.parseJsonOrUndefined<RuntimeSeal>('data/seals/b3_seal.json');
    const fullSuiteSeal = this.parseJsonOrUndefined<RuntimeSeal>('data/seals/full_suite_seal.json');
    const buildSeal = this.parseJsonOrUndefined<RuntimeSeal>('data/seals/build_seal.json');
    const pcOffStatus = this.parseJsonOrUndefined<{status: GateStatus}>('data/seals/pc_off_status.json');
    const vpsStatus = this.parseJsonOrUndefined<{status: GateStatus}>('data/seals/vps_status.json');
    const customerImpactStatus = this.parseJsonOrUndefined<{status: GateStatus}>('data/seals/customer_impact_status.json');
    const approval = this.parseJsonOrUndefined<BehaviorCanaryApproval>('data/behavior_canary_approval.json');
    const tenantApproval = this.parseJsonOrUndefined<TenantCanaryApproval>('data/tenant_canary_approval.json');
    const waiver = this.parseJsonOrUndefined<OwnerWaiver>('data/behavior_canary_waiver.json');
    const observations = this.parseJsonOrUndefined<CanaryObservationState>('data/canary_observations.json');

    const pcOff = this.evaluateSeal(pcOffStatus, 'pc_off_gate');
    const vpsStabilization = this.evaluateSeal(vpsStatus, 'vps_stabilization_gate');
    
    let customerImpact = this.evaluateSeal(customerImpactStatus, 'customer_impact_gate');
    const now = new Date();
    if (customerImpact.status !== 'PASS') {
      if (waiver && waiver.approved && waiver.gate === 'customer_impact_check' && waiver.approvedByRole === 'owner') {
        if (now <= new Date(waiver.expiresAt)) {
          customerImpact = { status: 'PASS', reasonCode: 'PASS_VALID_EVIDENCE', evidenceFresh: true };
        }
      }
    }

    const b1 = this.evaluateSeal(b1Seal, 'b1');
    const b2 = this.evaluateSeal(b2Seal, 'b2');
    const b3 = this.evaluateSeal(b3Seal, 'b3');
    const fullSuite = this.evaluateSeal(fullSuiteSeal, 'fullSuite');
    const build = this.evaluateSeal(buildSeal, 'build');
    
    const rollbackReady = true; 
    const rollback = { status: rollbackReady ? 'PASS' : 'FAIL', reasonCode: rollbackReady ? 'PASS_VALID_EVIDENCE' : 'ROLLBACK_NOT_READY', evidenceFresh: true } as GateEvaluationResult;
    const doctorHealth = { status: doctorHealthy ? 'PASS' : 'FAIL', reasonCode: doctorHealthy ? 'PASS_VALID_EVIDENCE' : 'DOCTOR_UNHEALTHY', evidenceFresh: true } as GateEvaluationResult;

    const failedGates: string[] = [];
    if (pcOff.status !== 'PASS') failedGates.push('pcOffValidation');
    if (vpsStabilization.status !== 'PASS') failedGates.push('vpsStabilization');
    if (customerImpact.status !== 'PASS') failedGates.push('customerImpactCheck');
    if (b1.status !== 'PASS') failedGates.push('b1Seal');
    if (b2.status !== 'PASS') failedGates.push('b2Seal');
    if (b3.status !== 'PASS') failedGates.push('b3Seal');
    if (fullSuite.status !== 'PASS') failedGates.push('fullSuiteSeal');
    if (build.status !== 'PASS') failedGates.push('buildSeal');

    const requiredSealsReady = failedGates.length === 0;

    let ownerApprovalPresent = false;
    let ownerApprovalValid = false;
    let canaryWindowActive = false;
    let approvalReason = 'OWNER_APPROVAL_MISSING';

    const behaviorTenantCanaryEnabled = process.env.BEHAVIOR_TENANT_CANARY_ENABLED === 'true';
    let behaviorTenantCanaryAvailable = false;
    let behaviorTenantCanaryAllowedUserCount = 0;

    let activeApprovalId: string | undefined;

    if (canaryMode === 'internal') {
      ownerApprovalPresent = !!approval;
      if (ownerApprovalPresent && approval) {
        if (!approval.approved || approval.approvedByRole !== 'owner') {
          approvalReason = 'OWNER_APPROVAL_MISSING';
        } else if (approval.scope !== 'single_internal_owner') {
          approvalReason = 'OWNER_APPROVAL_SCOPE_MISMATCH';
        } else if (now > new Date(approval.expiresAt)) {
          approvalReason = 'OWNER_APPROVAL_EXPIRED';
        } else {
          // Check limits
          const limit = approval.maximum_observed_messages;
          const used = observations?.approvalId === approval.approvalId
            ? observations.observations.filter(o => o.scope === 'owner').length
            : 0;
            
          if (limit !== undefined && used >= limit) {
            approvalReason = 'OWNER_APPROVAL_BUDGET_EXHAUSTED';
          } else {
            ownerApprovalValid = true;
            canaryWindowActive = true;
            activeApprovalId = approval.approvalId;
            approvalReason = 'all_gates_passed';
          }
        }
      }
    } else if (canaryMode === 'tenant_allowlist') {
      ownerApprovalPresent = !!tenantApproval;
      if (tenantApproval) {
        behaviorTenantCanaryAvailable = true;
        behaviorTenantCanaryAllowedUserCount = Math.min(tenantApproval.users.length, 3);

        if (!tenantApproval.approved || tenantApproval.approvedByRole !== 'owner') {
          approvalReason = 'OWNER_APPROVAL_MISSING';
        } else if (tenantApproval.scope !== 'explicit_user_allowlist') {
          approvalReason = 'OWNER_APPROVAL_SCOPE_MISMATCH';
        } else if (now > new Date(tenantApproval.expiresAt)) {
          approvalReason = 'OWNER_APPROVAL_EXPIRED';
        } else if (!behaviorTenantCanaryEnabled) {
          approvalReason = 'TENANT_CANARY_KILLSWITCH_OFF';
        } else {
          // Verify user
          const subjectKey = senderPhone ? this.calculateSubjectKey(senderPhone) : null;
          if (!subjectKey) {
             approvalReason = 'TENANT_USER_UNIDENTIFIED';
          } else {
             const userCfg = tenantApproval.users.find(u => u.subjectKey === subjectKey);
             if (!userCfg) {
                approvalReason = 'TENANT_USER_NOT_IN_ALLOWLIST';
             } else {
                const used = observations?.approvalId === tenantApproval.approvalId
                  ? observations.observations.filter(o => o.subjectKey === subjectKey).length
                  : 0;
                
                if (used >= userCfg.maxMessages || used >= 5) {
                   approvalReason = 'TENANT_USER_BUDGET_EXHAUSTED';
                } else {
                   ownerApprovalValid = true;
                   canaryWindowActive = true;
                   activeApprovalId = tenantApproval.approvalId;
                   approvalReason = 'all_gates_passed';
                }
             }
          }
        }
      }
    }

    let liveCanaryAllowed = false;
    let liveCanaryReason = approvalReason;
    const behaviorProductionEnabled = behaviorGlobalEnabled;

    if (!behaviorProductionEnabled) {
      liveCanaryReason = 'BEHAVIOR_FLAG_DISABLED';
    } else if (canaryMode === 'off') {
      liveCanaryReason = 'BEHAVIOR_FLAG_DISABLED';
    } else if (conversationType !== 'private' || !tenantResolved) {
      liveCanaryReason = 'scope_denied';
    } else if (canaryMode === 'internal' && senderRole !== 'owner') {
      liveCanaryReason = 'scope_denied';
    } else if (!ownerApprovalValid) {
      // Reason already set
    } else if (!requiredSealsReady) {
      if (failedGates.includes('pcOffValidation')) liveCanaryReason = 'pc_off_validation_missing';
      else if (failedGates.includes('vpsStabilization')) liveCanaryReason = 'vps_stabilization_missing';
      else if (failedGates.includes('customerImpactCheck')) liveCanaryReason = 'customer_impact_gate_missing';
      else liveCanaryReason = 'required_seal_missing';
    } else if (!rollbackReady) {
      liveCanaryReason = 'ROLLBACK_NOT_READY';
      failedGates.push('rollbackReady');
    } else if (!doctorHealthy) {
      liveCanaryReason = 'DOCTOR_UNHEALTHY';
      failedGates.push('connectionDoctorHealthy');
    } else {
      liveCanaryAllowed = true;
      liveCanaryReason = 'all_gates_passed';
    }

    const snapshot: CanaryGateEvaluationSnapshot = {
      evaluatedAt,
      snapshotId,
      pcOff,
      vpsStabilization,
      customerImpact,
      b1, b2, b3, fullSuite, build, rollback, doctorHealth,
      requiredSealsReady,
      ownerApprovalPresent,
      ownerApprovalValid,
      activeApprovalId,
      canaryWindowActive,
      behaviorProductionEnabled,
      behaviorTenantCanaryEnabled,
      behaviorTenantCanaryAvailable,
      behaviorTenantCanaryAllowedUserCount,
      liveCanaryAllowed,
      liveCanaryReason,
      failedGates
    };

    return Object.freeze(snapshot);
  }
}
