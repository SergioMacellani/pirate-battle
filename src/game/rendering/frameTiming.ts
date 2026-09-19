export function clampFrameDelta(deltaSeconds: number, maxDeltaSeconds = 1 / 30): number {
  if (!Number.isFinite(deltaSeconds)) {
    return 0;
  }

  if (deltaSeconds <= 0) {
    return 0;
  }

  return Math.min(deltaSeconds, maxDeltaSeconds);
}
