export interface BehaviorCanaryApproval {
  approved: boolean;
  scope: "single_internal_owner" | "tenant_allowlist";
  issuedAt: string;
  expiresAt: string;
  approvalId: string;
  approvedByRole: "owner";
  maximum_observed_messages?: number;
}

export interface TenantCanarySubject {
  subjectKey: string;
  maxMessages: number;
}

export interface TenantCanaryApproval {
  approved: boolean;
  scope: 'explicit_user_allowlist';
  issuedAt: string;
  expiresAt: string;
  approvalId: string;
  approvedByRole: 'owner';
  users: TenantCanarySubject[];
}

export interface CanaryObservationRecord {
  eventKey: string;
  scope: "owner" | "tenant";
  subjectKey: string;
  reservedAt: string;
  finalizedAt?: string;
  terminalStatus?:
    | "SUCCESS_SENT"
    | "FAILED_PROVIDER"
    | "FAILED_TIMEOUT"
    | "FAILED_CANCELLED"
    | "FAILED_CONTRACT"
    | "FAILED_SEND";
}

export interface CanaryObservationState {
  schemaVersion: 1;
  approvalId: string;
  observations: CanaryObservationRecord[];
}
