// Pure policies for Android foreground/network recovery; no messages are buffered or replayed.
export function isForegroundResume(previous, next) {
  return next === 'active' && (previous === 'inactive' || previous === 'background');
}

export function reconnectDelayMs(attempt) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.min(5, Math.trunc(attempt))) : 0;
  return Math.min(30000, 1000 * 2 ** safeAttempt);
}
