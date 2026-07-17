import type { EnvConfig } from "../config/env.js";
import type { AssistantClient } from "../assistant/openaiAssistantClient.js";
import type { Logger } from "../observability/logger.js";
import type {
  QueueItem,
  QueueItemReason,
  QueueItemUpsertInput,
  QueueStore,
  QueueSummary,
  CandidateReportState,
  ReportDataSource,
  Publisher,
  PublisherStore
} from "../storage/types.js";
import { defaultUserState, type UserIdentityInput, type UserState, type UserStateStore } from "../storage/types.js";
import type { IngestionJob, LearningSuggestion, LearningSuggestionStatus } from "../storage/ingestionTypes.js";
import { EvolutionSendTextError, type EvolutionSender, type SendTextInput } from "../bridge/sendTextMessage.js";

export function createTestEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    port: 3000,
    evolutionApiBaseUrl: "http://evolution.local",
    evolutionInstance: "antigravity",
    evolutionApiKey: "test-evolution-key",
    openaiApiKey: "test-openai-key",
    openaiAssistantId: "asst_test",
    realOpenaiPublishEnabled: false,
    dashboardAdminToken: "test_token",
    dashboardOwnerToken: "owner_secret",
    dashboardManagerToken: "manager_secret",
    ownerPhoneNumbers: ["905111111111"],
    managerPhoneNumbers: ["905222222222"],
    approvedApps: [],
    webhookQueueMode: "off",
    outboundQueueMode: "off",
    fastAckEnabled: false,
    workersEnabled: false,
    behaviorOrchestratorEnabled: false,
    behaviorCanaryMode: "off",
    behaviorCanaryTenants: [],
    behaviorCanaryRoles: ["owner", "manager"],
    behaviorTenantCanaryEnabled: false,
    modelAdapterLayerEnabled: false,
    modelAdapterCanaryMode: "off",
    modelAdapterCanaryTenants: [],
    modelAdapterCanaryRoles: ["owner", "manager"],
    modelExecutionTimeoutEnabled: false,
    modelExecutionTimeoutMs: 45_000,
    responsesShadowEnabled: false,
    responsesShadowMode: "off",
    responsesShadowTenants: [],
    responsesShadowRoles: [],
    responsesShadowTimeoutMs: 15_000,
    conversationDecisionV2Enabled: false,
    versions: {
      assistant_response_contract_version: "1.0",
      system_prompt_version: "1.0.0",
      knowledge_base_version: "2026.07.04",
      backend_context_version: "1.0",
      state_machine_version: "1.0"
    },
    ...overrides
  };
}

export class InMemoryUserStateStore implements UserStateStore {
  public states = new Map<string, UserState>();

  getOrCreateState(userId: string, defaults: UserState = defaultUserState(), _identity?: UserIdentityInput): UserState {
    const existing = this.states.get(userId);
    if (existing !== undefined) return this.clone(existing);
    const created = this.clone(defaults);
    this.states.set(userId, created);
    return this.clone(created);
  }

  updateState(userId: string, state: UserState, _identity?: UserIdentityInput): void {
    this.states.set(userId, this.clone(state));
  }

  private clone(state: UserState): UserState {
    return {
      ...defaultUserState(),
      ...state,
      missing_fields: [...state.missing_fields],
      behavior_conversation_state: state.behavior_conversation_state
        ? {
            ...state.behavior_conversation_state,
            unresolvedObjections: [...state.behavior_conversation_state.unresolvedObjections],
            completedTopics: [...state.behavior_conversation_state.completedTopics],
            pendingTopics: [...state.behavior_conversation_state.pendingTopics]
          }
        : undefined
    };
  }
}

export class FakeAssistantClient implements AssistantClient {
  public createThreadCalls = 0;
  public runCalls: Array<{ threadId: string; content: string }> = [];

  constructor(private readonly responses: string[] = []) {}

  async createThread(): Promise<string> {
    this.createThreadCalls += 1;
    return `thread_${this.createThreadCalls}`;
  }

  async runAssistant(threadId: string, content: string): Promise<string> {
    this.runCalls.push({ threadId, content });
    return this.responses.shift() ?? '{"contract_version":"1.0","reply":"Tamam","internal_boss_note":""}';
  }
}

export class FakeSender implements EvolutionSender {
  public sends: SendTextInput[] = [];

  async sendText(input: SendTextInput): Promise<void> {
    this.sends.push(input);
  }
}

export class FailingSender implements EvolutionSender {
  public sends: SendTextInput[] = [];

  constructor(private readonly httpStatus = 401) {}

  async sendText(input: SendTextInput): Promise<void> {
    this.sends.push(input);
    throw new EvolutionSendTextError(`send failed ${this.httpStatus}`, this.httpStatus);
  }
}

export function createSilentLogger(): Logger & { events: Array<Record<string, unknown>> } {
  const events: Array<Record<string, unknown>> = [];
  return {
    events,
    debug: (event) => events.push({ level: "DEBUG", ...event }),
    info: (event) => events.push({ level: "INFO", ...event }),
    warn: (event) => events.push({ level: "WARN", ...event }),
    error: (event) => events.push({ level: "ERROR", ...event }),
    fatal: (event) => events.push({ level: "FATAL", ...event })
  };
}

export class InMemoryQueueStore implements QueueStore {
  public items = new Map<string, QueueItem>();
  private sequence = 0;

  upsertOpenItem(input: QueueItemUpsertInput): QueueItem {
    const existing = [...this.items.values()].find((item) => {
      if (item.status !== "open") return false;
      if (item.reason !== input.reason) return false;
      
      if (input.scope_type === "group" || item.scope_type === "group") {
        return (
          item.scope_type === input.scope_type &&
          item.group_id_hash === input.group_id_hash &&
          item.sender_id_hash === input.sender_id_hash
        );
      }
      
      return item.user_id === input.user_id;
    });
    const now = new Date().toISOString();

    if (existing !== undefined) {
      const updated: QueueItem = {
        ...existing,
        ...input,
        missing_fields: [...input.missing_fields],
        updated_at: now
      };
      this.items.set(existing.queue_item_id, updated);
      return this.clone(updated);
    }

    this.sequence += 1;
    const item: QueueItem = {
      queue_item_id: `qi_test_${this.sequence}`,
      ...input,
      safe_ref: input.safe_ref ?? `Q-TEST${this.sequence}`,
      missing_fields: [...input.missing_fields],
      created_at: now,
      updated_at: now,
      status: "open"
    };
    this.items.set(item.queue_item_id, item);
    return this.clone(item);
  }

  resolveOpenItems(userId: string, reasons: QueueItemReason[], now = new Date().toISOString()): QueueItem[] {
    const reasonSet = new Set(reasons);
    const resolved: QueueItem[] = [];
    for (const item of this.items.values()) {
      if (item.user_id === userId && item.status === "open" && reasonSet.has(item.reason)) {
        const updated: QueueItem = { ...item, status: "resolved", updated_at: now };
        this.items.set(item.queue_item_id, updated);
        resolved.push(this.clone(updated));
      }
    }
    return resolved;
  }

  resolveOpenItemBySafeRef(safeRef: string, now = new Date().toISOString()): QueueItem | null {
    for (const item of this.items.values()) {
      if (item.safe_ref === safeRef) {
        if (item.status !== "open") return this.clone(item);
        const updated: QueueItem = { ...item, status: "resolved", updated_at: now };
        this.items.set(item.queue_item_id, updated);
        return this.clone(updated);
      }
    }
    return null;
  }

  listItems(): QueueItem[] {
    return [...this.items.values()].map((item) => this.clone(item));
  }

  getOpenItemsForUser(userId: string): QueueItem[] {
    return [...this.items.values()].filter((item) => item.user_id === userId && item.status === "open").map((item) => this.clone(item));
  }

  getSummary(): QueueSummary {
    const open = [...this.items.values()].filter((item) => item.status === "open");
    const openItemsByPriority = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const openItemsByReason: QueueSummary["open_items_by_reason"] = {};
    const selectedAppUsers = new Set<string>();
    const phoneTypeUsers = new Set<string>();
    const readyUsers = new Set<string>();

    for (const item of open) {
      openItemsByPriority[item.priority] += 1;
      openItemsByReason[item.reason] = (openItemsByReason[item.reason] ?? 0) + 1;
      if (item.reason === "missing_selected_app" || item.reason === "missing_selected_app_and_phone_type") {
        selectedAppUsers.add(item.user_id);
      }
      if (item.reason === "missing_phone_type" || item.reason === "missing_selected_app_and_phone_type") {
        phoneTypeUsers.add(item.user_id);
      }
      if (item.reason === "ready_for_installation_followup") {
        readyUsers.add(item.user_id);
      }
    }

    return {
      open_missing_info_count: open.filter((item) =>
        ["missing_selected_app", "missing_phone_type", "missing_selected_app_and_phone_type"].includes(item.reason)
      ).length,
      open_follow_up_count: open.filter(
        (item) => !["missing_selected_app", "missing_phone_type", "missing_selected_app_and_phone_type"].includes(item.reason)
      ).length,
      high_priority_count: openItemsByPriority.HIGH,
      users_waiting_selected_app: selectedAppUsers.size,
      users_waiting_phone_type: phoneTypeUsers.size,
      users_ready_for_installation: readyUsers.size,
      open_items_by_priority: openItemsByPriority,
      open_items_by_reason: openItemsByReason
    };
  }

  private clone(item: QueueItem): QueueItem {
    return { ...item, missing_fields: [...item.missing_fields] };
  }
}

export class InMemoryPublisherStore implements PublisherStore {
  public publishers = new Map<string, Publisher>();
  private sequence = 0;

  upsertPublisher(input: Partial<Publisher> & { user_id: string }): Publisher {
    const existing = this.publishers.get(input.user_id);
    const now = new Date().toISOString();

    if (existing !== undefined) {
      const updated: Publisher = {
        ...existing,
        ...input,
        updated_at: now
      };
      this.publishers.set(input.user_id, updated);
      return this.clone(updated);
    }

    this.sequence += 1;
    const publisher: Publisher = {
      publisher_id: input.publisher_id ?? `pub_test_${this.sequence}`,
      user_id: input.user_id,
      display_name: input.display_name ?? "",
      selected_app: input.selected_app ?? "",
      phone_type: input.phone_type ?? "",
      onboarding_status: input.onboarding_status ?? "in_progress",
      installation_status: input.installation_status ?? "pending",
      training_status: input.training_status ?? "pending",
      activity_status: input.activity_status ?? "new",
      last_seen_at: input.last_seen_at ?? now,
      last_operator_action: input.last_operator_action ?? "",
      notes: input.notes ?? "",
      source_platform: input.source_platform ?? "whatsapp",
      created_at: now,
      updated_at: now
    };
    this.publishers.set(input.user_id, publisher);
    return this.clone(publisher);
  }

  listPublishers(): Publisher[] {
    return [...this.publishers.values()].map((p) => this.clone(p));
  }

  getPublisher(userId: string): Publisher | undefined {
    const existing = this.publishers.get(userId);
    return existing ? this.clone(existing) : undefined;
  }

  updatePublisherStatusBySafeRef(safeRef: string, status: import("../storage/types.js").PublisherActivityStatus): import("../storage/types.js").PublisherUpdateResult {
    for (const p of this.publishers.values()) {
      if (p.safe_ref === safeRef) {
        if (p.activity_status === status) {
          return { found: true, already_current: true, previous_status: p.activity_status, publisher_safe_ref: p.safe_ref };
        }
        const prev = p.activity_status;
        p.activity_status = status;
        return { found: true, already_current: false, previous_status: prev, new_status: status, publisher_safe_ref: p.safe_ref };
      }
    }
    return { found: false, already_current: false };
  }

  private clone(publisher: Publisher): Publisher {
    return { ...publisher };
  }
}

export class InMemoryReportDataSource implements ReportDataSource {
  constructor(
    private readonly candidateStates: CandidateReportState[] = [],
    public readonly mutableQueueStore = new InMemoryQueueStore(),
    private readonly publisherStore = new InMemoryPublisherStore(),
    private readonly ingestionJobs: any[] = [],
    private readonly learningSuggestions: any[] = []
  ) {}

  listCandidateStates(): CandidateReportState[] {
    return this.candidateStates.map((state) => ({ ...state, missing_fields: [...state.missing_fields] }));
  }

  listQueueItems(): QueueItem[] {
    return this.mutableQueueStore.listItems();
  }

  getQueueSummary(): QueueSummary {
    return this.mutableQueueStore.getSummary();
  }

  listPublishers(): Publisher[] {
    return this.publisherStore.listPublishers();
  }

  listIngestionJobs(): any[] {
    return this.ingestionJobs;
  }

  listLearningSuggestions(): any[] {
    return this.learningSuggestions;
  }
}

export class InMemoryIngestionStore {
  public jobs = new Map<string, IngestionJob>();
  public suggestions = new Map<string, LearningSuggestion>();
  public hashes = new Set<string>();

  getJob(jobId: string): IngestionJob | undefined {
    return this.jobs.get(jobId);
  }

  saveJob(job: IngestionJob): void {
    this.jobs.set(job.job_id, job);
  }

  listJobs(): IngestionJob[] {
    return Array.from(this.jobs.values());
  }

  hasMessageHash(hash: string): boolean {
    return this.hashes.has(hash);
  }

  markMessageHash(hash: string): void {
    this.hashes.add(hash);
  }

  saveLearningSuggestion(suggestion: LearningSuggestion): void {
    if (!suggestion.short_ref) {
      let nextId = 1;
      for (const item of this.suggestions.values()) {
        if (item.short_ref && item.short_ref.startsWith("LRN-")) {
          const num = parseInt(item.short_ref.replace("LRN-", ""), 10);
          if (!isNaN(num) && num >= nextId) {
            nextId = num + 1;
          }
        }
      }
      suggestion.short_ref = `LRN-${nextId}`;
    }
    this.suggestions.set(suggestion.suggestion_id, suggestion);
  }

  getLearningSuggestion(id: string): LearningSuggestion | undefined {
    return this.suggestions.get(id);
  }

  getLearningSuggestionByShortRef(shortRef: string): LearningSuggestion | undefined {
    const upper = shortRef.toUpperCase();
    return Array.from(this.suggestions.values()).find(s => s.short_ref === upper);
  }

  updateLearningSuggestionStatus(id: string, newStatus: LearningSuggestionStatus, reviewedBy: string): boolean {
    const suggestion = this.suggestions.get(id);
    if (!suggestion) return false;
    suggestion.status = newStatus;
    suggestion.reviewed_by = reviewedBy;
    suggestion.reviewed_at = new Date().toISOString();
    return true;
  }

  listLearningSuggestions(): LearningSuggestion[] {
    return Array.from(this.suggestions.values());
  }
}
