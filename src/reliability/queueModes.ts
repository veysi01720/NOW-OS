export type WebhookQueueMode = "off" | "dual_write" | "queue_only";
export type OutboundQueueMode = "off" | "enqueue_shadow" | "queue_only";

export interface ReliabilityModeFlags {
  webhookQueueMode: WebhookQueueMode;
  outboundQueueMode: OutboundQueueMode;
  fastAckEnabled: boolean;
  workersEnabled: boolean;
}

export function productionSafeModeDefaults(): ReliabilityModeFlags {
  return {
    webhookQueueMode: "off",
    outboundQueueMode: "off",
    fastAckEnabled: false,
    workersEnabled: false,
  };
}

export function isInboundDualWriteEnabled(mode: WebhookQueueMode): boolean {
  return mode === "dual_write";
}

export function isOutboundShadowEnabled(mode: OutboundQueueMode): boolean {
  return mode === "enqueue_shadow";
}
