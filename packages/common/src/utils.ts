export function now(): number {
  return Date.now();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(base: number, range: number): number {
  return base + (Math.random() * range * 2 - range);
}

export function deadlineHit(enqueue: number, end: number, deadlineMs: number): boolean {
  return end - enqueue <= deadlineMs;
}

export function ewma(prev: number, x: number, alpha: number): number {
  return alpha * x + (1 - alpha) * prev;
}
