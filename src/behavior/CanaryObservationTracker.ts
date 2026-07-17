import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHmac } from 'node:crypto';
import { CanaryObservationState, CanaryObservationRecord } from './canaryContracts.js';

export type CanaryObservationReservationResult = "reserved" | "duplicate";
export type CanaryObservationFinalizeResult = "finalized" | "missing" | "already_finalized";

export class CanaryObservationTracker {
  private static readonly activeReservations = new Set<string>();

  private static filePath(): string {
    return process.env.CANARY_OBSERVATION_STORE_PATH || join(process.cwd(), 'data/canary_observations.json');
  }

  private static readState(): CanaryObservationState | null {
    try {
      const filePath = this.filePath();
      if (!existsSync(filePath)) return null;
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  private static writeState(state: CanaryObservationState): void {
    const filePath = this.filePath();
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = filePath + '.tmp';
    writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o644 });
    renameSync(tempPath, filePath);
  }

  public static calculateSubjectKey(phoneNumber: string): string {
    const secret = process.env.TENANT_CANARY_SECRET || 'fallback-secret-for-tests';
    return createHmac('sha256', secret).update(phoneNumber).digest('hex');
  }

  public static reserveObservation(
    eventKey: string,
    scope: 'owner' | 'tenant',
    approvalId: string,
    phoneNumber?: string
  ): CanaryObservationReservationResult {
    const lockKey = `${approvalId}:${eventKey}`;
    if (this.activeReservations.has(lockKey)) return "duplicate";
    this.activeReservations.add(lockKey);
    let state = this.readState();
    if (!state || state.approvalId !== approvalId) {
      state = {
        schemaVersion: 1,
        approvalId,
        observations: []
      };
    }

    if (state.observations.some(o => o.eventKey === eventKey)) {
      return "duplicate";
    }

    const subjectKey = scope === 'tenant' && phoneNumber 
      ? this.calculateSubjectKey(phoneNumber) 
      : 'owner_subject';

    const record: CanaryObservationRecord = {
      eventKey,
      scope,
      subjectKey,
      reservedAt: new Date().toISOString()
    };

    state.observations.push(record);
    this.writeState(state);
    return "reserved";
  }

  public static finalizeObservation(
    eventKey: string,
    terminalStatus: CanaryObservationRecord['terminalStatus']
  ): CanaryObservationFinalizeResult {
    const state = this.readState();
    if (!state) return "missing";

    const record = state.observations.find(o => o.eventKey === eventKey);
    if (!record) return "missing";
    if (record.terminalStatus) return "already_finalized";

    record.terminalStatus = terminalStatus;
    record.finalizedAt = new Date().toISOString();
    
    this.writeState(state);
    return "finalized";
  }
}
