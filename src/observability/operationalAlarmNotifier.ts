import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "./logger.js";
import { redactSecrets } from "../utils/redaction.js";

export type OperationalAlarmKind = "outbound_dead_letter" | "outbox_backlog" | "outbox_recovered";

export interface OperationalAlarmNotifier {
  send(input: { kind: OperationalAlarmKind; pending: number; dead_letters: number; occurred_at: string }): Promise<{ delivered: boolean }>;
}

export class SmtpOperationalAlarmNotifier implements OperationalAlarmNotifier {
  private readonly transporter?: Pick<Transporter, "sendMail">;

  constructor(private readonly options: {
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
  }) {
    this.transporter = options.transporter ?? (this.configured()
      ? nodemailer.createTransport({
          host: options.host,
          port: options.port,
          secure: options.secure,
          requireTLS: !options.secure,
          disableFileAccess: true,
          disableUrlAccess: true,
          auth: options.username && options.password ? { user: options.username, pass: options.password } : undefined,
        })
      : undefined);
  }

  async send(input: { kind: OperationalAlarmKind; pending: number; dead_letters: number; occurred_at: string }): Promise<{ delivered: boolean }> {
    if (!this.configured() || !this.transporter) return { delivered: false };
    try {
      await this.transporter.sendMail({
        from: this.options.from,
        to: this.options.recipients.join(","),
        subject: `[NOW OS] ${input.kind}`,
        text: `Alarm: ${input.kind}\nPending: ${input.pending}\nDead letters: ${input.dead_letters}\nTime: ${input.occurred_at}`,
      });
      this.options.logger.info({ event_type: "OPERATIONAL_EMAIL_ALARM_SENT", alarm_kind: input.kind });
      return { delivered: true };
    } catch (error) {
      this.options.logger.error({
        event_type: "OPERATIONAL_EMAIL_ALARM_FAILED",
        alarm_kind: input.kind,
        error: redactSecrets(error instanceof Error ? error.message : "smtp_send_failed"),
      });
      return { delivered: false };
    }
  }

  private configured(): boolean {
    return this.options.enabled && Boolean(this.options.host) && Boolean(this.options.from) && this.options.recipients.length > 0;
  }
}
