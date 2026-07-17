import { logger } from "./logger.js";

export const DEFAULT_TIMEZONE = "Europe/Istanbul";

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch (err) {
    return false;
  }
}

export function getSafeTimezone(timezone?: string): string {
  if (!timezone) return DEFAULT_TIMEZONE;
  if (isValidTimezone(timezone)) return timezone;
  logger.warn(`Invalid timezone provided: ${timezone}. Falling back to default: ${DEFAULT_TIMEZONE}`);
  return DEFAULT_TIMEZONE;
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const safeTimezone = getSafeTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      partMap[part.type] = parseInt(part.value, 10);
    }
  }

  // Handle hour 24 -> 0
  if (partMap.hour === 24) partMap.hour = 0;

  return {
    year: partMap.year,
    month: partMap.month,
    day: partMap.day,
    hour: partMap.hour,
    minute: partMap.minute,
  };
}

export function getDateBucket(date: Date, timezone: string): string {
  const parts = getZonedDateParts(date, timezone);
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

export interface SchedulerConfigLike {
  timezone?: string;
  configured_hour: number;
  configured_minute: number;
}

export function isConfiguredTimeDue(now: Date, config: SchedulerConfigLike): boolean {
  const parts = getZonedDateParts(now, config.timezone || DEFAULT_TIMEZONE);
  if (parts.hour > config.configured_hour) return true;
  if (parts.hour === config.configured_hour && parts.minute >= config.configured_minute) return true;
  return false;
}

export function computeNextRunAt(config: SchedulerConfigLike, fromDate: Date = new Date()): string {
  const safeTimezone = getSafeTimezone(config.timezone);
  const parts = getZonedDateParts(fromDate, safeTimezone);
  
  const isDueToday = parts.hour < config.configured_hour || 
                    (parts.hour === config.configured_hour && parts.minute < config.configured_minute);
  
  let targetYear = parts.year;
  let targetMonth = parts.month;
  let targetDay = parts.day;
  
  if (!isDueToday) {
    const d = new Date(fromDate);
    d.setUTCDate(d.getUTCDate() + 1);
    const nextParts = getZonedDateParts(d, safeTimezone);
    targetYear = nextParts.year;
    targetMonth = nextParts.month;
    targetDay = nextParts.day;
  }
  
  const mm = String(targetMonth).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  const HH = String(config.configured_hour).padStart(2, "0");
  const mm_min = String(config.configured_minute).padStart(2, "0");
  
  return `${targetYear}-${mm}-${dd}T${HH}:${mm_min}:00 [${safeTimezone}]`;
}
