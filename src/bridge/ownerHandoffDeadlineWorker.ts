import type { Logger } from "../observability/logger.js";
import type { HumanHandoffRecord, HumanHandoffStore } from "../store/humanHandoffStore.js";
import type { EvolutionSender } from "./sendTextMessage.js";
import type { NormalizedIncomingMessage } from "./normalizeEvolutionMessage.js";

function deadlineMessage(phone: string, handoffId: string, purpose: string): NormalizedIncomingMessage {
  const correlationId = `owner-handoff-deadline-${handoffId}`;
  return {
    correlation_id: correlationId,
    sender_id: phone,
    phone_number: phone,
    remote_jid: `${phone}@s.whatsapp.net`,
    message_id: `system-${handoffId}-${purpose}`,
    message_type: "text",
    text: "",
    chat_type: "private",
    is_from_me: false,
    is_group: false,
    received_at: new Date().toISOString(),
  };
}

export class OwnerHandoffDeadlineWorker {
  constructor(private readonly deps: {
    store: HumanHandoffStore;
    sender: EvolutionSender;
    teamPhoneNumbers: string[];
    logger: Logger;
  }) {}

  async runOnce(now = new Date()): Promise<{ due: number; escalated: number; failed: number }> {
    const due = this.deps.store.listDueOwnerQueries(now);
    let escalated = 0;
    let failed = 0;
    for (const record of due) {
      const succeeded = await this.escalate(record);
      if (succeeded && this.deps.store.markOwnerQueryTeamEscalated(record.handoff_id)) escalated += 1;
      else failed += 1;
    }
    return { due: due.length, escalated, failed };
  }

  private async escalate(record: HumanHandoffRecord): Promise<boolean> {
    const query = record.owner_query;
    if (!query) return false;
    const suffix = query.candidate_phone.slice(-4);
    let allAccepted = this.deps.teamPhoneNumbers.length > 0;
    if (this.deps.teamPhoneNumbers.length === 0) {
      this.deps.logger.warn({
        event_type: "OWNER_ANSWER_REQUIRED_TEAM_ESCALATION_FAILED",
        correlation_id: record.source_correlation_id,
        handoff_id: record.handoff_id,
        reason: "team_recipient_missing",
        raw_text_logged: false,
      });
    }
    for (const [index, phone] of this.deps.teamPhoneNumbers.entries()) {
      try {
        const text = `Aday ${suffix} için owner yanıtı 15 dakika içinde gelmedi. Kayıt açık ve yanıt bekliyor.`;
        await this.deps.sender.sendText({
          message: deadlineMessage(phone, record.handoff_id, `team-${index + 1}`),
          text,
        });
      } catch (error) {
        allAccepted = false;
        this.deps.logger.warn({
          event_type: "OWNER_ANSWER_REQUIRED_TEAM_ESCALATION_FAILED",
          correlation_id: record.source_correlation_id,
          handoff_id: record.handoff_id,
          recipient_index: index + 1,
          error: error instanceof Error ? error.message : String(error),
          raw_text_logged: false,
        });
      }
    }
    try {
      const text = "Kontrol biraz uzadı; sorununu destek hattına da yönlendirdim. Yanıt gelene kadar kaydın açık kalacak.";
      await this.deps.sender.sendText({
        message: deadlineMessage(query.candidate_phone, record.handoff_id, "candidate"),
        text,
      });
    } catch (error) {
      allAccepted = false;
      this.deps.logger.warn({
        event_type: "OWNER_ANSWER_REQUIRED_CANDIDATE_NOTICE_FAILED",
        correlation_id: record.source_correlation_id,
        handoff_id: record.handoff_id,
        error: error instanceof Error ? error.message : String(error),
        raw_text_logged: false,
      });
    }
    if (allAccepted) {
      this.deps.logger.warn({
        event_type: "OWNER_ANSWER_REQUIRED_TEAM_ESCALATED",
        correlation_id: record.source_correlation_id,
        handoff_id: record.handoff_id,
        candidate_last4: suffix,
        remains_pending: true,
        raw_text_logged: false,
      });
    }
    return allAccepted;
  }
}
