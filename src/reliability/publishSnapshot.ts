import { createHash } from "node:crypto";

export interface PublishSnapshotPointer {
  active_manifest_hash: string;
  candidate_manifest_hash: string;
  rollback_pointer_ready: boolean;
  real_publish_triggered: false;
}

export function buildDryRunRollbackPointer(activeManifestContent: string, candidateManifestContent: string): PublishSnapshotPointer {
  return {
    active_manifest_hash: sha256(activeManifestContent),
    candidate_manifest_hash: sha256(candidateManifestContent),
    rollback_pointer_ready: activeManifestContent.trim().length > 0 && candidateManifestContent.trim().length > 0,
    real_publish_triggered: false,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
