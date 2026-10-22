import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, groupSessions, needsAttention } from '../sessionGroups.mjs';

test('dayLabel buckets today/yesterday/days-ago', () => {
  const now = new Date();
  const iso = (offsetDays) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString();
  };
  assert.equal(dayLabel(iso(0)), '今天');
  assert.equal(dayLabel(iso(1)), '昨天');
  assert.equal(dayLabel(iso(2)), '2 天前');
  assert.equal(dayLabel(null), '更早');
  assert.equal(dayLabel(undefined), '更早');
});

test('needsAttention flags untitled sessions', () => {
  assert.equal(needsAttention({ id: 'a', title: 'hello' }), false);
  assert.equal(needsAttention({ id: 'a', title: '' }), true);
  assert.equal(needsAttention({ id: 'a' }), true);
  assert.equal(needsAttention(null), false);
});

test('groupSessions orders attention first then recency', () => {
  const sessions = [
    { id: 'old', title: 'old one', modifiedAt: '2026-01-01T00:00:00Z' },
    { id: 'today', title: 'todays', modifiedAt: new Date().toISOString() },
    { id: 'untitled', title: '', modifiedAt: new Date().toISOString() },
    { id: 'yesterday', title: 'y', modifiedAt: new Date(Date.now() - 86400000).toISOString() },
  ];
  const groups = groupSessions(sessions);
  assert.equal(groups[0].key, 'attention');
  assert.deepEqual(groups[0].sessions.map((s) => s.id), ['untitled']);
  const labels = groups.map((g) => g.key);
  assert.ok(labels.includes('今天'));
  assert.ok(labels.includes('昨天'));
  assert.ok(labels.includes('更早'));
  // Today bucket has the recent session.
  const today = groups.find((g) => g.key === '今天');
  assert.deepEqual(today.sessions.map((s) => s.id), ['today']);
});

test('groupSessions filters by search and keeps order', () => {
  const sessions = [
    { id: 'a', title: 'Alpha task', modifiedAt: new Date().toISOString() },
    { id: 'b', title: 'Beta work', modifiedAt: new Date().toISOString() },
  ];
  const groups = groupSessions(sessions, { search: 'alpha' });
  const flat = groups.flatMap((g) => g.sessions.map((s) => s.id));
  assert.deepEqual(flat, ['a']);
});