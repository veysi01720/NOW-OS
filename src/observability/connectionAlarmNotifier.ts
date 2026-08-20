import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "./logger.js";
import type { EvolutionConnectionAlarmKind } from "./evolutionConnectionControlStore.js";
import { redactSecrets } from "../utils/redaction.js";

export interface ConnectionAlarmInput {
  kind: EvolutionConnectionAlarmKind;
  instance: string;
  state: string | null;
  status_reason?: number;
  occurred_at: string;
}

export interface ConnectionAlarmNotifier {
  isConfigured(): boolean;
  send(input: ConnectionAlarmInput): Promise<{ delivered: boolean; message_id?: string }>;
}

export interface SmtpConnectionAlarmNotifierOptions {
  enabled: boolean;
  host?: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  from?: string;
  recipients: string[];
  logger: Logger;
  transporter?: Pick<Transporter, "sendMail">;
}

const subjects: Record<EvolutionConnectionAlarmKind, string> = {
  logged_out_401: "P0 WhatsApp session logged out (401)",
  repeated_refused_428: "P0 WhatsApp connection repeatedly refused (428)",
  circuit_breaker_open: "P0 WhatsApp reconnect circuit breaker opened",
  inbound_message_missing: "P0 WhatsApp inbound message was not delivered to NOW OS",
  connection_recovered: "WhatsApp connection recovered",
};

export class SmtpConnectionAlarmNotifier implements ConnectionAlarmNotifier {
  private readonly transporter?: Pick<Transporter, "sendMail">;

  constructor(private readonly options: SmtpConnectionAlarmNotifierOptions) {
    this.transporter = options.transporter ?? (this.isConfigured()
      ? nodemailer.createTransport({
          host: options.host,
          port: options.port,
          secure: options.secure,
          requireTLS: !options.secure,
          disableFileAccess: true,
          disableUrlAccess: true,
          auth: options.username && options.password
            ? { user: options.username, pass: options.password }
            : undefined,
        })
      : undefined);
  }

  isConfigured(): boolean {
    return this.options.enabled
      && Boolean(this.options.host)
      && Boolean(this.options.from)
      && this.options.recipients.length > 0;
  }

  async send(input: ConnectionAlarmInput): Promise<{ delivered: boolean; message_id?: string }> {
    if (!this.isConfigured() || !this.transporter) {
      this.options.logger.error({
        event_type: "EVOLUTION_CONNECTION_EMAIL_ALARM_FAILED",
        alarm_kind: input.kind,
        reason: "smtp_not_configured",
      });
      return { delivered: false };
    }
    try {
      const result = await this.transporter.sendMail({
        from: this.options.from,
        to: this.options.recipients.join(","),
        subject: `[NOW OS] ${subjects[input.kind]}`,
        text: [
          `Alarm: ${input.kind}`,
          `Instance: ${input.instance}`,
          `State: ${input.state ?? "unknown"}`,
          `Status reason: ${input.status_reason ?? "none"}`,
          `Time: ${input.occurred_at}`,
        ].join("\n"),
      });
      this.options.logger.info({
        event_type: "EVOLUTION_CONNECTION_EMAIL_ALARM_SENT",
        alarm_kind: input.kind,
        recipient_count: this.options.recipients.length,
      });
      return { delivered: true, message_id: typeof result.messageId === "string" ? result.messageId : undefined };
    } catch (error) {
      this.options.logger.error({
        event_type: "EVOLUTION_CONNECTION_EMAIL_ALARM_FAILED",
        alarm_kind: input.kind,
        error: redactSecrets(error instanceof Error ? error.message : "smtp_send_failed"),
      });
      return { delivered: false };
    }
  }
}
