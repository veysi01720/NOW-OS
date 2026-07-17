import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "../utils/logger.js";
import type { MessageDedupeStore } from "./messageDedupeStore.js";
import type { ConversationMemory, MemoryStore } from "./memoryStore.js";
import type { ThreadStore } from "./threadStore.js";
import { defaultUserState } from "./types.js";
import type {
  EventLogInput,
  EventLogStore,
  CandidateReportState,
  ProcessedMessageMetadata,
  QueueItem,
  QueueItemPriority,
  QueueItemReason,
  QueueItemUpsertInput,
  QueueStore,
  QueueSummary,
  ReportDataSource,
  UserIdentityInput,
  UserState,
  UserStateStore,
  Publisher,
  PublisherStore,
  PublisherActivityStatus,
  PublisherUpdateResult,
  DailyReportState,
  DailyReportStore
} from "./types.js";

interface PersistedUser {
  user_id: string;
  normalized_phone_or_jid: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

interface PersistedThread {
  user_id: string;
  openai_thread_id: string;
  created_at: string;
  updated_at: string;
}

interface PersistedState extends UserState {
  user_id: string;
  updated_at: string;
}

interface PersistedMemory extends ConversationMemory {
  user_id: string;
  updated_at: string;
}

interface PersistedProcessedMessage {
  message_id: string;
  sender_id: string;
  remote_jid: string;
  first_seen_at: string;
  expires_at: string;
  correlation_id: string;
  status: string;
}

interface PersistedEventLog extends EventLogInput {
  created_at: string;
}

interface PersistedQueueItem extends QueueItem {}

interface PersistedPublisher extends Publisher {}

interface PersistedDailyReportState extends DailyReportState {}

interface StoreData {
  users: Record<string, PersistedUser>;
  threads: Record<string, PersistedThread>;
  states: Record<string, PersistedState>;
  memories: Record<string, PersistedMemory>;
  processed_messages: Record<string, PersistedProcessedMessage>;
  queue_items: Record<string, PersistedQueueItem>;
  event_logs: PersistedEventLog[];
  publishers: Record<string, PersistedPublisher>;
  daily_reports: Record<string, PersistedDailyReportState>;
  scheduled_report_configs?: Record<string, any>;
  scheduled_report_runs?: any[];
}

function emptyData(): StoreData {
  return {
    users: {},
    threads: {},
    states: {},
    memories: {},
    processed_messages: {},
    queue_items: {},
    event_logs: [],
    publishers: {},
    daily_reports: {},
    scheduled_report_configs: {},
    scheduled_report_runs: []
  };
}

const MISSING_INFO_REASONS = new Set<QueueItemReason>([
  "missing_selected_app",
  "missing_phone_type",
  "missing_selected_app_and_phone_type"
]);

function maskIdentifier(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 3) {
    return `${digits.slice(0, 3)}***`;
  }
  return value.includes("@g.us") ? "<group>@g.us" : "***";
}

function emptyMemory(): ConversationMemory {
  return {
    conversation_summary: "",
    last_5_user_messages: [],
    last_5_bot_replies: [],
    last_10_messages: [],
    last_intent: null,
    summary: null
  };
}

function cloneMemory(memory: ConversationMemory): ConversationMemory {
  return {
    conversation_summary: memory.conversation_summary,
    last_5_user_messages: [...memory.last_5_user_messages],
    last_5_bot_replies: [...memory.last_5_bot_replies],
    last_10_messages: [...memory.last_10_messages],
    last_intent: memory.last_intent ?? null,
    summary: memory.summary ?? null
  };
}

function cloneState(state: UserState): UserState {
  const defaults = defaultUserState();
  return {
    ...defaults,
    ...state,
    current_state: state.current_state,
    selected_app: state.selected_app,
    phone_type: state.phone_type,
    age: state.age ?? defaults.age,
    gender: state.gender ?? defaults.gender,
    daily_hours: state.daily_hours ?? defaults.daily_hours,
    eligibility_status: state.eligibility_status ?? defaults.eligibility_status,
    work_model_disclosed: state.work_model_disclosed ?? defaults.work_model_disclosed,
    model_acceptance: state.model_acceptance ?? defaults.model_acceptance,
    installation_status: state.installation_status,
    training_status: state.training_status,
    missing_fields: [...state.missing_fields],
    expected_next_step: state.expected_next_step,
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

function cloneQueueItem(item: QueueItem): QueueItem {
  return {
    ...item,
    missing_fields: [...item.missing_fields]
  };
}

function clonePublisher(publisher: Publisher): Publisher {
  return { ...publisher };
}

function migrateMemory(value: Partial<ConversationMemory> | undefined): ConversationMemory {
  return {
    conversation_summary: value?.conversation_summary ?? "",
    last_5_user_messages: [...(value?.last_5_user_messages ?? [])].slice(-5),
    last_5_bot_replies: [...(value?.last_5_bot_replies ?? [])].slice(-5),
    last_10_messages: [...(value?.last_10_messages ?? [])].slice(-10),
    last_intent: value?.last_intent ?? null,
    summary: value?.summary ?? null
  };
}

class PersistentJsonRepository {
  private data: StoreData;

  constructor(
    private readonly filePath = resolve("data", "now-os-store.json"),
    private readonly dedupeTtlMs = 24 * 60 * 60 * 1000
  ) {
    this.data = this.load();
    this.backfillSafeRefs();
    this.pruneProcessedMessages();
    this.persist();
  }

  private backfillSafeRefs(): void {
    let needsPersist = false;
    for (const item of Object.values(this.data.queue_items)) {
      if (!item.safe_ref) {
        item.safe_ref = this.generateQueueSafeRef();
        needsPersist = true;
      }
    }
    for (const pub of Object.values(this.data.publishers)) {
      if (!pub.safe_ref) {
        pub.safe_ref = this.generatePublisherSafeRef();
        needsPersist = true;
      }
    }
    if (needsPersist) {
      this.persist();
    }
  }

  private generateQueueSafeRef(): string {
    const existingRefs = new Set<string>();
    for (const item of Object.values(this.data.queue_items)) {
      if (item.safe_ref) existingRefs.add(item.safe_ref);
    }
    for (let i = 0; i < 10; i++) {
      const candidate = `Q-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      if (!existingRefs.has(candidate)) return candidate;
    }
    throw new Error("Failed to generate unique safe_ref for queue item");
  }

  private generatePublisherSafeRef(): string {
    const existingRefs = new Set<string>();
    for (const item of Object.values(this.data.publishers)) {
      if (item.safe_ref) existingRefs.add(item.safe_ref);
    }
    for (let i = 0; i < 10; i++) {
      const candidate = `PUB-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      if (!existingRefs.has(candidate)) return candidate;
    }
    throw new Error("Failed to generate unique safe_ref for publisher");
  }

  get dataPath(): string {
    return this.filePath;
  }

  getMemory(key: string): ConversationMemory {
    this.touchUser(key);
    const existing = this.data.memories[key];
    return existing === undefined ? emptyMemory() : cloneMemory(migrateMemory(existing));
  }

  appendUserMessage(key: string, message: string): void {
    const current = this.data.memories[key] ?? this.createMemory(key);
    current.last_5_user_messages = [...current.last_5_user_messages, message].slice(-5);
    current.last_10_messages = [...current.last_10_messages, `user: ${message}`].slice(-10);
    current.updated_at = new Date().toISOString();
    this.touchUser(key);
    this.persist();
  }

  appendBotReply(key: string, reply: string): void {
    const current = this.data.memories[key] ?? this.createMemory(key);
    current.last_5_bot_replies = [...current.last_5_bot_replies, reply].slice(-5);
    current.last_10_messages = [...current.last_10_messages, `assistant: ${reply}`].slice(-10);
    current.updated_at = new Date().toISOString();
    this.touchUser(key);
    this.persist();
  }

  getThread(key: string): string | undefined {
    this.touchUser(key);
    return this.data.threads[key]?.openai_thread_id;
  }

  setThread(key: string, threadId: string): void {
    this.touchUser(key);
    const now = new Date().toISOString();
    const existing = this.data.threads[key];
    this.data.threads[key] = {
      user_id: key,
      openai_thread_id: threadId,
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    this.persist();
  }

  getOrCreateState(userId: string, defaults: UserState, identity?: UserIdentityInput): UserState {
    this.touchUser(userId, identity);
    const existing = this.data.states[userId];
    if (existing !== undefined) {
      return cloneState(existing);
    }

    const state = cloneState(defaults);
    this.data.states[userId] = {
      user_id: userId,
      ...state,
      updated_at: new Date().toISOString()
    };
    this.persist();
    return state;
  }

  updateState(userId: string, state: UserState, identity?: UserIdentityInput): void {
    this.touchUser(userId, identity);
    this.data.states[userId] = {
      user_id: userId,
      ...cloneState(state),
      updated_at: new Date().toISOString()
    };
    this.persist();
  }

  isDuplicate(key: string): boolean {
    this.pruneProcessedMessages();
    return this.data.processed_messages[key] !== undefined;
  }

  markSeen(key: string, metadata?: ProcessedMessageMetadata): void {
    this.pruneProcessedMessages();
    this.data.processed_messages[key] = {
      message_id: metadata?.message_id ?? key,
      sender_id: metadata?.sender_id ?? "",
      remote_jid: metadata?.remote_jid ?? "",
      first_seen_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.dedupeTtlMs).toISOString(),
      correlation_id: metadata?.correlation_id ?? "",
      status: metadata?.status ?? "seen"
    };
    this.persist();
  }

  recordEvent(event: EventLogInput): void {
    this.data.event_logs.push({
      ...event,
      created_at: new Date().toISOString()
    });
    this.data.event_logs = this.data.event_logs.slice(-1000);
    this.persist();
  }

  upsertOpenQueueItem(input: QueueItemUpsertInput): QueueItem {
    this.touchUser(input.user_id, { normalized_phone_or_jid: input.user_id });
    const now = new Date().toISOString();
    
    const existing = Object.values(this.data.queue_items).find((item) => {
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

    if (existing !== undefined) {
      const updated: PersistedQueueItem = {
        ...existing,
        sender_masked: input.sender_masked,
        priority: input.priority,
        current_state: input.current_state,
        missing_fields: [...input.missing_fields],
        expected_next_step: input.expected_next_step,
        last_seen_at: input.last_seen_at,
        last_user_message_preview: input.last_user_message_preview,
        suggested_operator_action: input.suggested_operator_action,
        updated_at: now
      };
      this.data.queue_items[existing.queue_item_id] = updated;
      this.persist();
      return cloneQueueItem(updated);
    }

    const queueItem: PersistedQueueItem = {
      queue_item_id: `qi_${randomUUID()}`,
      ...input,
      safe_ref: input.safe_ref ?? this.generateQueueSafeRef(),
      missing_fields: [...input.missing_fields],
      created_at: now,
      updated_at: now,
      status: "open"
    };
    this.data.queue_items[queueItem.queue_item_id] = queueItem;
    this.persist();
    return cloneQueueItem(queueItem);
  }

  resolveOpenQueueItems(userId: string, reasons: QueueItemReason[], now = new Date().toISOString()): QueueItem[] {
    const reasonSet = new Set(reasons);
    const resolved: QueueItem[] = [];
    for (const item of Object.values(this.data.queue_items)) {
      if (item.user_id !== userId || item.status !== "open" || !reasonSet.has(item.reason)) {
        continue;
      }

      const updated: PersistedQueueItem = {
        ...item,
        status: "resolved",
        updated_at: now
      };
      this.data.queue_items[item.queue_item_id] = updated;
      resolved.push(cloneQueueItem(updated));
    }

    if (resolved.length > 0) {
      this.persist();
    }

    return resolved;
  }

  resolveOpenQueueItemBySafeRef(safeRef: string, now = new Date().toISOString()): QueueItem | null {
    for (const item of Object.values(this.data.queue_items)) {
      if (item.safe_ref === safeRef) {
        if (item.status !== "open") {
          return cloneQueueItem(item);
        }
        const updated: PersistedQueueItem = {
          ...item,
          status: "resolved",
          updated_at: now
        };
        this.data.queue_items[item.queue_item_id] = updated;
        this.persist();
        return cloneQueueItem(updated);
      }
    }
    return null;
  }

  listQueueItems(): QueueItem[] {
    return Object.values(this.data.queue_items).map(cloneQueueItem);
  }

  getOpenQueueItemsForUser(userId: string): QueueItem[] {
    return Object.values(this.data.queue_items)
      .filter((item) => item.user_id === userId && item.status === "open")
      .map(cloneQueueItem);
  }

  getQueueSummary(): QueueSummary {
    const openItems = Object.values(this.data.queue_items).filter((item) => item.status === "open");
    const priorityCounts: Record<QueueItemPriority, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    const reasonCounts: Partial<Record<QueueItemReason, number>> = {};
    const usersWaitingSelectedApp = new Set<string>();
    const usersWaitingPhoneType = new Set<string>();
    const usersReadyForInstallation = new Set<string>();

    for (const item of openItems) {
      priorityCounts[item.priority] += 1;
      reasonCounts[item.reason] = (reasonCounts[item.reason] ?? 0) + 1;

      if (item.reason === "missing_selected_app" || item.reason === "missing_selected_app_and_phone_type") {
        usersWaitingSelectedApp.add(item.user_id);
      }
      if (item.reason === "missing_phone_type" || item.reason === "missing_selected_app_and_phone_type") {
        usersWaitingPhoneType.add(item.user_id);
      }
      if (item.reason === "ready_for_installation_followup") {
        usersReadyForInstallation.add(item.user_id);
      }
    }

    return {
      open_missing_info_count: openItems.filter((item) => MISSING_INFO_REASONS.has(item.reason)).length,
      open_follow_up_count: openItems.filter((item) => !MISSING_INFO_REASONS.has(item.reason)).length,
      high_priority_count: priorityCounts.HIGH,
      users_waiting_selected_app: usersWaitingSelectedApp.size,
      users_waiting_phone_type: usersWaitingPhoneType.size,
      users_ready_for_installation: usersReadyForInstallation.size,
      open_items_by_priority: priorityCounts,
      open_items_by_reason: reasonCounts
    };
  }

  listCandidateStates(): CandidateReportState[] {
    return Object.values(this.data.states).map((state) => {
      const user = this.data.users[state.user_id];
      return {
        user_id: state.user_id,
        sender_masked: maskIdentifier(user?.normalized_phone_or_jid ?? state.user_id),
        current_state: state.current_state,
        selected_app: state.selected_app,
        phone_type: state.phone_type,
        missing_fields: [...state.missing_fields],
        expected_next_step: state.expected_next_step,
        last_seen_at: user?.last_seen_at ?? state.updated_at
      };
    });
  }

  getPublisher(userId: string): Publisher | undefined {
    const existing = this.data.publishers[userId];
    return existing ? clonePublisher(existing) : undefined;
  }

  updatePublisherStatusBySafeRef(safeRef: string, status: PublisherActivityStatus): PublisherUpdateResult {
    const publisher = Object.values(this.data.publishers).find(p => p.safe_ref === safeRef);
    if (!publisher) {
      return { found: false, already_current: false };
    }
    if (publisher.activity_status === status) {
      return { 
        found: true, 
        already_current: true,
        previous_status: publisher.activity_status,
        new_status: publisher.activity_status,
        publisher_safe_ref: safeRef
      };
    }
    const previous = publisher.activity_status;
    publisher.activity_status = status;
    publisher.updated_at = new Date().toISOString();
    this.persist();
    return {
      found: true,
      already_current: false,
      previous_status: previous,
      new_status: status,
      publisher_safe_ref: safeRef
    };
  }

  upsertPublisher(input: Partial<Publisher> & { user_id: string }): Publisher {
    this.touchUser(input.user_id);
    const now = new Date().toISOString();
    const existing = this.data.publishers[input.user_id];

    if (existing) {
      const updated: PersistedPublisher = {
        ...existing,
        ...input,
        updated_at: now
      };
      this.data.publishers[input.user_id] = updated;
      this.persist();
      return clonePublisher(updated);
    }

    const publisherId = input.publisher_id ?? `pub_${randomUUID()}`;
    const newPublisher: PersistedPublisher = {
      publisher_id: publisherId,
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
      updated_at: now,
      safe_ref: input.safe_ref ?? this.generatePublisherSafeRef()
    };

    this.data.publishers[input.user_id] = newPublisher;
    this.persist();
    return clonePublisher(newPublisher);
  }

  listPublishers(): Publisher[] {
    return Object.values(this.data.publishers).map(clonePublisher);
  }

  markDailyReportGenerated(state: DailyReportState): void {
    const key = `${state.report_date}_${state.delivery_mode}_${state.sent_to_role}`;
    this.data.daily_reports[key] = {
      ...state,
      created_at: this.data.daily_reports[key]?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    this.persist();
  }

  checkDailyReportDuplicate(reportDate: string, deliveryMode: string, sentToRole: string): boolean {
    const key = `${reportDate}_${deliveryMode}_${sentToRole}`;
    const report = this.data.daily_reports[key];
    return report !== undefined;
  }

  private createMemory(key: string): PersistedMemory {
    const memory: PersistedMemory = {
      user_id: key,
      ...emptyMemory(),
      updated_at: new Date().toISOString()
    };
    this.data.memories[key] = memory;
    return memory;
  }

  private touchUser(userId: string, identity?: UserIdentityInput): void {
    const now = new Date().toISOString();
    const existing = this.data.users[userId];
    this.data.users[userId] = {
      user_id: userId,
      normalized_phone_or_jid: identity?.normalized_phone_or_jid ?? existing?.normalized_phone_or_jid ?? userId,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_seen_at: now
    };
  }

  private pruneProcessedMessages(): void {
    const now = Date.now();
    let changed = false;
    for (const [key, message] of Object.entries(this.data.processed_messages)) {
      if (Date.parse(message.expires_at) <= now) {
        delete this.data.processed_messages[key];
        changed = true;
      }
    }
    if (changed) {
      this.persist();
    }
  }

  private load(): StoreData {
    try {
      const content = readFileSync(this.filePath, "utf8");
      try {
        const parsed = JSON.parse(content) as Partial<StoreData>;
        return {
          ...emptyData(),
          ...parsed,
          queue_items: Object.fromEntries(
            Object.entries(parsed.queue_items ?? {}).map(([key, value]) => [
              key,
              {
                ...value,
                missing_fields: [...(value.missing_fields ?? [])]
              }
            ])
          ),
          memories: Object.fromEntries(
            Object.entries(parsed.memories ?? {}).map(([key, value]) => [
              key,
              {
                user_id: key,
                ...migrateMemory(value),
                updated_at: value.updated_at ?? new Date().toISOString()
              }
            ])
          ),
          publishers: parsed.publishers ?? {},
          daily_reports: parsed.daily_reports ?? {}
        };
      } catch (parseError) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const corruptedPath = `${this.filePath}.corrupted-${timestamp}`;
        renameSync(this.filePath, corruptedPath);
        logger.warn(`JSON Parse error in ${this.filePath}. Corrupted file moved to ${corruptedPath}. Falling back to empty state.`, parseError);
        return emptyData();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyData();
      }
      throw error;
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
}

class PersistentMemoryStore implements MemoryStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  get(key: string): ConversationMemory {
    return this.repository.getMemory(key);
  }

  appendUserMessage(key: string, message: string): void {
    this.repository.appendUserMessage(key, message);
  }

  appendBotReply(key: string, reply: string): void {
    this.repository.appendBotReply(key, reply);
  }
}

class PersistentThreadStore implements ThreadStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  get(key: string): string | undefined {
    return this.repository.getThread(key);
  }

  set(key: string, threadId: string): void {
    this.repository.setThread(key, threadId);
  }

  async getOrCreate(key: string, createThread: () => Promise<string>): Promise<string> {
    const existing = this.repository.getThread(key);
    if (existing !== undefined) {
      return existing;
    }

    const created = await createThread();
    this.repository.setThread(key, created);
    return created;
  }
}

class PersistentMessageDedupeStore implements MessageDedupeStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  isDuplicate(key: string): boolean {
    return this.repository.isDuplicate(key);
  }

  markSeen(key: string, metadata?: ProcessedMessageMetadata): void {
    this.repository.markSeen(key, metadata);
  }
}

class PersistentUserStateStore implements UserStateStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  getOrCreateState(userId: string, defaults: UserState, identity?: UserIdentityInput): UserState {
    return this.repository.getOrCreateState(userId, defaults, identity);
  }

  updateState(userId: string, state: UserState, identity?: UserIdentityInput): void {
    this.repository.updateState(userId, state, identity);
  }
}

class PersistentEventLogStore implements EventLogStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  recordEvent(event: EventLogInput): void {
    this.repository.recordEvent(event);
  }
}

class PersistentQueueStore implements QueueStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  upsertOpenItem(input: QueueItemUpsertInput): QueueItem {
    return this.repository.upsertOpenQueueItem(input);
  }

  resolveOpenItems(userId: string, reasons: QueueItemReason[], now?: string): QueueItem[] {
    return this.repository.resolveOpenQueueItems(userId, reasons, now);
  }

  resolveOpenItemBySafeRef(safeRef: string, now?: string): QueueItem | null {
    return this.repository.resolveOpenQueueItemBySafeRef(safeRef, now);
  }

  listItems(): QueueItem[] {
    return this.repository.listQueueItems();
  }

  getOpenItemsForUser(userId: string): QueueItem[] {
    return this.repository.getOpenQueueItemsForUser(userId);
  }

  getSummary(): QueueSummary {
    return this.repository.getQueueSummary();
  }
}

class PersistentPublisherStore implements PublisherStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  upsertPublisher(input: Partial<Publisher> & { user_id: string }): Publisher {
    return this.repository.upsertPublisher(input);
  }

  listPublishers(): Publisher[] {
    return this.repository.listPublishers();
  }

  getPublisher(userId: string): Publisher | undefined {
    return this.repository.getPublisher(userId);
  }

  updatePublisherStatusBySafeRef(safeRef: string, status: PublisherActivityStatus): PublisherUpdateResult {
    return this.repository.updatePublisherStatusBySafeRef(safeRef, status);
  }
}

class PersistentReportDataSource implements ReportDataSource {
  constructor(private readonly repository: PersistentJsonRepository) {}

  listCandidateStates(): CandidateReportState[] {
    return this.repository.listCandidateStates();
  }

  listQueueItems(): QueueItem[] {
    return this.repository.listQueueItems();
  }

  getQueueSummary(): QueueSummary {
    return this.repository.getQueueSummary();
  }

  listPublishers(): Publisher[] {
    return this.repository.listPublishers();
  }
}

class PersistentDailyReportStore implements DailyReportStore {
  constructor(private readonly repository: PersistentJsonRepository) {}

  markDailyReportGenerated(state: DailyReportState): void {
    this.repository.markDailyReportGenerated(state);
  }

  checkDailyReportDuplicate(reportDate: string, deliveryMode: string, sentToRole: string): boolean {
    return this.repository.checkDailyReportDuplicate(reportDate, deliveryMode, sentToRole);
  }
}

export interface PersistentStoreBundle {
  dataPath: string;
  memoryStore: MemoryStore;
  threadStore: ThreadStore;
  messageDedupeStore: MessageDedupeStore;
  userStateStore: UserStateStore;
  eventLogStore: EventLogStore;
  queueStore: QueueStore;
  reportDataSource: ReportDataSource;
  publisherStore: PublisherStore;
  dailyReportStore: DailyReportStore;
}

export function createPersistentJsonStore(filePath?: string, dedupeTtlMs?: number): PersistentStoreBundle {
  const repository = new PersistentJsonRepository(filePath, dedupeTtlMs);
  return {
    dataPath: repository.dataPath,
    memoryStore: new PersistentMemoryStore(repository),
    threadStore: new PersistentThreadStore(repository),
    messageDedupeStore: new PersistentMessageDedupeStore(repository),
    userStateStore: new PersistentUserStateStore(repository),
    eventLogStore: new PersistentEventLogStore(repository),
    queueStore: new PersistentQueueStore(repository),
    reportDataSource: new PersistentReportDataSource(repository),
    publisherStore: new PersistentPublisherStore(repository),
    dailyReportStore: new PersistentDailyReportStore(repository)
  };
}
