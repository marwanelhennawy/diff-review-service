// Token bucket: capacity allows a small burst above the sustained rate,
// refills continuously so a steady 30/min never gets rejected.
const RATE_PER_MINUTE = 30;
const BURST_CAPACITY = 30;
const REFILL_PER_MS = RATE_PER_MINUTE / 60000;

let tokens = BURST_CAPACITY;
let lastRefill = Date.now();

export function tryConsume() {
  const now = Date.now();
  const elapsed = now - lastRefill;
  tokens = Math.min(BURST_CAPACITY, tokens + elapsed * REFILL_PER_MS);
  lastRefill = now;

  if (tokens >= 1) {
    tokens -= 1;
    return { allowed: true };
  }
  const deficit = 1 - tokens;
  const retryAfterSec = Math.max(1, Math.ceil(deficit / REFILL_PER_MS / 1000));
  return { allowed: false, retryAfterSec };
}

export const RATE_LIMIT_PER_MINUTE = RATE_PER_MINUTE;
export const BURST = BURST_CAPACITY;
