export interface HumanReplyDelayOptions {
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const MIN_DELAY_MS = 1_500;
const MAX_DELAY_MS = 4_000;
const LENGTH_FOR_MAX_DELAY = 400;

export function calculateHumanReplyDelayMs(text: string, random = Math.random): number {
  const lengthRatio = Math.min(text.trim().length, LENGTH_FOR_MAX_DELAY) / LENGTH_FOR_MAX_DELAY;
  const maximumForLength = MIN_DELAY_MS + Math.round((MAX_DELAY_MS - MIN_DELAY_MS) * lengthRatio);
  const randomUnit = Math.max(0, Math.min(0.999999, random()));
  return MIN_DELAY_MS + Math.floor(randomUnit * (maximumForLength - MIN_DELAY_MS + 1));
}

export async function waitForHumanReplyDelay(
  text: string,
  options: HumanReplyDelayOptions = {},
): Promise<number> {
  const delayMs = calculateHumanReplyDelayMs(text, options.random);
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  await sleep(delayMs);
  return delayMs;
}
