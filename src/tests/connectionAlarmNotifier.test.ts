import { SmtpConnectionAlarmNotifier } from "../observability/connectionAlarmNotifier.js";
import { createSilentLogger } from "./testDoubles.js";

describe("SmtpConnectionAlarmNotifier", () => {
  it("submits an alarm through SMTP and logs success only after transport acceptance", async () => {
    const logger = createSilentLogger();
    const sent: Array<Record<string, unknown>> = [];
    const notifier = new SmtpConnectionAlarmNotifier({
      enabled: true,
      host: "smtp.example.test",
      port: 587,
      secure: false,
      username: "smtp-user",
      password: "smtp-secret",
      from: "alerts@example.test",
      recipients: ["owner@example.test"],
      logger,
      transporter: {
        sendMail: async (message) => {
          sent.push(message as Record<string, unknown>);
          return { messageId: "smtp-message-1" } as never;
        },
      },
    });

    const result = await notifier.send({
      kind: "logged_out_401",
      instance: "nowakademi_bot",
      state: "close",
      status_reason: 401,
      occurred_at: "2026-08-20T10:00:00.000Z",
    });

    expect(result).toEqual({ delivered: true, message_id: "smtp-message-1" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "owner@example.test" });
    expect(JSON.stringify(logger.events)).toContain("EVOLUTION_CONNECTION_EMAIL_ALARM_SENT");
    expect(JSON.stringify(logger.events)).not.toContain("smtp-secret");
  });

  it("reports failure instead of a false success when SMTP is unavailable", async () => {
    const logger = createSilentLogger();
    const notifier = new SmtpConnectionAlarmNotifier({
      enabled: false,
      port: 587,
      secure: false,
      recipients: [],
      logger,
    });

    expect(await notifier.send({
      kind: "circuit_breaker_open",
      instance: "nowakademi_bot",
      state: "connecting",
      occurred_at: "2026-08-20T10:00:00.000Z",
    })).toEqual({ delivered: false });
    expect(JSON.stringify(logger.events)).toContain("EVOLUTION_CONNECTION_EMAIL_ALARM_FAILED");
    expect(JSON.stringify(logger.events)).not.toContain("EVOLUTION_CONNECTION_EMAIL_ALARM_SENT");
  });
});
