export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface LogEvent {
  level: LogLevel;
  event_type: string;
  correlation_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface LogInput {
  event_type: string;
  correlation_id?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(event: LogInput): void;
  info(event: LogInput): void;
  warn(event: LogInput): void;
  error(event: LogInput): void;
  fatal(event: LogInput): void;
}

function emit(level: LogLevel, event: LogInput): void {
  const payload: LogEvent = {
    ...event,
    level,
    created_at: new Date().toISOString()
  };
  const line = JSON.stringify(payload);

  if (level === "ERROR" || level === "FATAL") {
    console.error(line);
    return;
  }

  console.log(line);
}

export const logger: Logger = {
  debug: (event) => emit("DEBUG", event),
  info: (event) => emit("INFO", event),
  warn: (event) => emit("WARN", event),
  error: (event) => emit("ERROR", event),
  fatal: (event) => emit("FATAL", event)
};
