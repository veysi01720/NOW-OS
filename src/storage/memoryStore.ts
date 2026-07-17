export interface ConversationMemory {
  conversation_summary: string;
  last_5_user_messages: string[];
  last_5_bot_replies: string[];
  last_10_messages: string[];
  last_intent?: string | null;
  summary?: string | null;
}

export interface MemoryStore {
  get(key: string): ConversationMemory;
  appendUserMessage(key: string, message: string): void;
  appendBotReply(key: string, reply: string): void;
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

export class InMemoryStore implements MemoryStore {
  private readonly memories = new Map<string, ConversationMemory>();

  get(key: string): ConversationMemory {
    const existing = this.memories.get(key);
    if (existing !== undefined) {
      return {
        conversation_summary: existing.conversation_summary,
        last_5_user_messages: [...existing.last_5_user_messages],
        last_5_bot_replies: [...existing.last_5_bot_replies],
        last_10_messages: [...existing.last_10_messages],
        last_intent: existing.last_intent ?? null,
        summary: existing.summary ?? null
      };
    }

    return emptyMemory();
  }

  appendUserMessage(key: string, message: string): void {
    const current = this.memories.get(key) ?? emptyMemory();
    current.last_5_user_messages = [...current.last_5_user_messages, message].slice(-5);
    current.last_10_messages = [...current.last_10_messages, `user: ${message}`].slice(-10);
    this.memories.set(key, current);
  }

  appendBotReply(key: string, reply: string): void {
    const current = this.memories.get(key) ?? emptyMemory();
    current.last_5_bot_replies = [...current.last_5_bot_replies, reply].slice(-5);
    current.last_10_messages = [...current.last_10_messages, `assistant: ${reply}`].slice(-10);
    this.memories.set(key, current);
  }
}
