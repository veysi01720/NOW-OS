import { loadEnv } from '../config/env.js';
import { CanaryGateEvaluator, CanaryGateEvaluationSnapshot } from './CanaryGateEvaluator.js';

export type GateStatus = 'PASS' | 'FAIL' | 'PENDING' | 'UNKNOWN';

export type OwnerWaiver = {
  approved: boolean;
  gate: 'customer_impact_check';
  reasonCategory: 'deferred_after_canary' | 'separate_operational_workstream';
  issuedAt: string;
  expiresAt: string;
  approvedByRole: 'owner';
};

export type RuntimeSeal = {
  name: string;
  status: 'PASS' | 'FAIL';
  version?: string;
  testCount?: number;
  buildId?: string;
  createdAt?: string;
};

export type BehaviorCanaryGateInput = {
  snapshot: Readonly<CanaryGateEvaluationSnapshot>;
};

export type BehaviorCanaryGateResult = {
  allowed: boolean;
  reason: string;
  failedGates: string[];
  approvedScope?: 'single_internal_owner' | 'explicit_user_allowlist';
};

export function evaluateCanaryExecutionGate(input: BehaviorCanaryGateInput): BehaviorCanaryGateResult {
  const s = input.snapshot;
  
  if (s.liveCanaryAllowed) {
    return { allowed: true, reason: 'all_gates_passed', failedGates: [], approvedScope: s.behaviorTenantCanaryEnabled ? 'explicit_user_allowlist' : 'single_internal_owner' };
  } else {
    return { allowed: false, reason: s.liveCanaryReason, failedGates: s.failedGates };
  }
}

export function buildGateInputFromRuntime(
  senderRole: string, 
  conversationType: 'private'|'group', 
  tenantResolved: boolean, 
  doctorHealthy: boolean,
  senderPhone?: string
): BehaviorCanaryGateInput {
  const env = loadEnv();
  const behaviorGlobalEnabled = env.behaviorOrchestratorEnabled;
  const canaryMode = (process.env.BEHAVIOR_CANARY_MODE as any) || 'off';
  
  const snapshot = CanaryGateEvaluator.evaluate(
    behaviorGlobalEnabled,
    canaryMode,
    senderRole,
    conversationType,
    tenantResolved,
    doctorHealthy,
    senderPhone
  );

  return { snapshot };
}
