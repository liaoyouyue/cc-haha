// Session list grouping for the home screen, mirroring the upstream H5
// mobile redesign: "waiting for you" first, then by recency.
// Pure functions; tested in tests/sessionGroups.test.mjs.

export function dayLabel(iso) {
  if (!iso) return '更早';
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return '更早';
}

// A session "needs attention" when it has a message we cannot render as
// finished work: pending approvals happen per session in the chat view, but a
// session whose last run ended mid-flight (last message is incomplete) or one
// that has no title yet is a hint. Keep the rule cheap and local: no extra
// server calls.
export function needsAttention(session) {
  return Boolean(session && !session.title);
}

/**
 * sessions: array from GET /api/sessions (has id/title/modifiedAt/...).
 * Returns ordered groups: [{key, label, sessions:[...]}].
 * Order: needs-attention -> today -> yesterday -> N days ago -> older.
 */
export function groupSessions(sessions, { search = '' } = {}) {
  const q = search.trim().toLowerCase();
  const list = Array.isArray(sessions) ? sessions : [];
  const filtered = q
    ? list.filter((s) =>
        `${s.title ?? ''} ${s.projectPath ?? ''}`.toLowerCase().includes(q),
      )
    : list;

  const buckets = new Map();
  for (const s of filtered) {
    if (needsAttention(s)) {
      if (!buckets.has('attention')) buckets.set('attention', []);
      buckets.get('attention').push(s);
      continue;
    }
    const label = dayLabel(s.modifiedAt ?? s.createdAt);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(s);
  }

  const order = ['attention', '今天', '昨天', '2 天前', '3 天前', '4 天前', '5 天前', '6 天前', '更早'];
  const groups = [];
  // Keep sessions within a bucket in recency order, most recent first.
  const byRecency = (a, b) =>
    new Date(b.modifiedAt ?? b.createdAt ?? 0) - new Date(a.modifiedAt ?? a.createdAt ?? 0);
  for (const key of order) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    groups.push({ key, label: key === 'attention' ? '需要你' : key, sessions: bucket.sort(byRecency) });
  }
  for (const [key, bucket] of buckets) {
    if (!order.includes(key)) groups.push({ key, label: key, sessions: bucket.sort(byRecency) });
  }
  return groups;
}