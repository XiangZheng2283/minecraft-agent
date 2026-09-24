// Durable operation evidence and review memory. All model output is treated as data.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS experience_events_v1 (
  id INTEGER PRIMARY KEY, event_key TEXT UNIQUE, task_version TEXT, step_id TEXT,
  goal TEXT, world TEXT, version TEXT, action TEXT, args_json TEXT,
  before_json TEXT, after_json TEXT, result_json TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS experience_events_task_v1 ON experience_events_v1(task_version,step_id);
CREATE TABLE IF NOT EXISTS experience_queue_v1 (
  id INTEGER PRIMARY KEY, episode_key TEXT UNIQUE, signature TEXT NOT NULL,
  episode_json TEXT NOT NULL, evidence_ids_json TEXT NOT NULL,
  merged_count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL,
  lease_until INTEGER, lease_token TEXT, last_error TEXT, review_json TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS experience_queue_due_v1 ON experience_queue_v1(status,available_at,lease_until);
CREATE INDEX IF NOT EXISTS experience_queue_signature_v1 ON experience_queue_v1(signature,status);
CREATE TABLE IF NOT EXISTS experience_episode_keys_v1 (
  episode_key TEXT PRIMARY KEY, queue_id INTEGER NOT NULL REFERENCES experience_queue_v1(id)
);
CREATE TABLE IF NOT EXISTS experience_memories_v1 (
  id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, goal TEXT NOT NULL,
  conditions_json TEXT NOT NULL, advice TEXT NOT NULL, avoid_json TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL, verification TEXT NOT NULL,
  execution_action TEXT, execution_args_json TEXT, success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0, partial_count INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL, world TEXT, version TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS experience_memories_scope_v1 ON experience_memories_v1(world,version,verification);
CREATE TABLE IF NOT EXISTS experience_usage_v1 (
  memory_id INTEGER NOT NULL REFERENCES experience_memories_v1(id),
  evidence_id INTEGER NOT NULL REFERENCES experience_events_v1(id),
  success INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(memory_id,evidence_id)
);
`;
const MAX_EVIDENCE_PER_EPISODE = 8;
const MAX_REVIEW_EVENT_BYTES = 1800;

const json = value => JSON.stringify(value ?? null);
const parse = value => value == null ? null : JSON.parse(value);
const meaningful = value => value != null && (typeof value === 'string' ? !!value.trim()
  : Array.isArray(value) ? value.length > 0
    : typeof value === 'object' ? Object.keys(value).length > 0 : !!value);
const stable = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]))
  : Array.isArray(value) ? value.map(stable) : value;
const canonical = value => json(stable(value));
const str = (value, max = 500) => value == null ? null : String(value).trim().slice(0, max);
const words = value => new Set(String(value ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const fact = value => str(value, 180)?.toLowerCase().replace(/\s+/g, ' ');
function clauses(value) {
  if (value == null) return [];
  const input = Array.isArray(value) ? value : [value];
  if (input.length > 16) throw new TypeError('too many conditions');
  return input.map(entry => {
    if (typeof entry === 'string') return { facts: [fact(entry)] };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('invalid condition');
    if (Object.keys(entry).some(key => !['inventoryMin', 'inventoryMax', 'dimension', 'facts'].includes(key)))
      throw new TypeError('unknown condition field');
    const limits = key => {
      const source = entry[key] ?? {};
      if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('invalid inventory condition');
      if (Object.keys(source).length > 32) throw new TypeError('too many inventory conditions');
      return Object.fromEntries(Object.entries(source).map(([item, count]) => {
        if (!/^[a-z0-9_]{1,120}$/.test(item) || !Number.isSafeInteger(count) || count < 0) throw new TypeError('invalid inventory threshold');
        return [item, count];
      }));
    };
    const facts = entry.facts ?? [];
    if (!Array.isArray(facts) || facts.some(x => typeof x !== 'string')) throw new TypeError('invalid condition facts');
    if (facts.length > 16) throw new TypeError('too many condition facts');
    return { inventoryMin: limits('inventoryMin'), inventoryMax: limits('inventoryMax'),
      dimension: str(entry.dimension, 100), facts: [...new Set(facts.map(fact).filter(Boolean))] };
  });
}
function matches(clausesValue, conditions) {
  const context = Array.isArray(conditions) ? { facts: conditions } : (conditions ?? {});
  const inventory = context.inventory ?? {}, facts = new Set((context.facts ?? []).map(fact));
  return clausesValue.every(clause =>
    (!clause.dimension || clause.dimension === context.dimension) &&
    Object.entries(clause.inventoryMin ?? {}).every(([item, count]) => Number(inventory[item] ?? 0) >= count) &&
    Object.entries(clause.inventoryMax ?? {}).every(([item, count]) => Number(inventory[item] ?? 0) <= count) &&
    (clause.facts ?? []).every(value => facts.has(value)));
}
function ids(value) {
  if (!Array.isArray(value)) throw new TypeError('evidenceIds must be an array');
  if (value.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new TypeError('invalid evidence ID');
  return [...new Set(value)];
}
const bounded = (value, fallback, low, high) => Number.isFinite(value) ? Math.max(low, Math.min(high, Math.floor(value))) : fallback;

export function openExperience({ path = 'data/experience/experience.db', now = Date.now, maxPending = 10000 } = {}) {
  const capacity = bounded(Number(maxPending), 10000, 1, 1000000);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const reopenedAt = bounded(Number(now()), Date.now(), 0, Number.MAX_SAFE_INTEGER);
  db.prepare("UPDATE experience_queue_v1 SET status='pending',lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE status='suspended'").run(reopenedAt, reopenedAt);
  db.exec('INSERT OR IGNORE INTO experience_episode_keys_v1(episode_key,queue_id) SELECT episode_key,id FROM experience_queue_v1 WHERE episode_key IS NOT NULL');
  const q = {
    eventByKey: db.prepare('SELECT * FROM experience_events_v1 WHERE event_key=?'),
    insertEvent: db.prepare(`INSERT INTO experience_events_v1(event_key,task_version,step_id,goal,world,version,action,args_json,before_json,after_json,result_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`),
    event: db.prepare('SELECT * FROM experience_events_v1 WHERE id=?'),
    queueKey: db.prepare('SELECT queue_id AS id FROM experience_episode_keys_v1 WHERE episode_key=?'),
    insertKey: db.prepare('INSERT INTO experience_episode_keys_v1(episode_key,queue_id) VALUES(?,?)'),
    queueMerge: db.prepare("SELECT * FROM experience_queue_v1 WHERE signature=? AND status IN ('pending','overflow') ORDER BY id"),
    queueCount: db.prepare("SELECT COUNT(*) AS n FROM experience_queue_v1 WHERE status IN ('pending','leased')"),
    nextDue: db.prepare("SELECT MIN(due_at) AS at FROM (SELECT available_at AS due_at FROM experience_queue_v1 WHERE status='pending' UNION ALL SELECT lease_until AS due_at FROM experience_queue_v1 WHERE status='leased')"),
    overflowCount: db.prepare("SELECT COUNT(*) AS n FROM experience_queue_v1 WHERE status='overflow'"),
    insertQueue: db.prepare(`INSERT INTO experience_queue_v1(episode_key,signature,episode_json,evidence_ids_json,status,available_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)`),
    updateMerge: db.prepare('UPDATE experience_queue_v1 SET evidence_ids_json=?,merged_count=merged_count+1,updated_at=? WHERE id=?'),
    due: db.prepare("SELECT * FROM experience_queue_v1 WHERE (status='pending' AND available_at<=?) OR (status='leased' AND lease_until<=?) ORDER BY available_at,id LIMIT 1"),
    overflow: db.prepare("SELECT * FROM experience_queue_v1 WHERE status='overflow' ORDER BY id LIMIT 1"),
    lease: db.prepare("UPDATE experience_queue_v1 SET status='leased',attempts=attempts+1,lease_until=?,lease_token=?,updated_at=? WHERE id=?"),
    queue: db.prepare('SELECT * FROM experience_queue_v1 WHERE id=?'),
    done: db.prepare("UPDATE experience_queue_v1 SET status='done',lease_until=NULL,lease_token=NULL,review_json=?,updated_at=? WHERE id=?"),
    failed: db.prepare("UPDATE experience_queue_v1 SET status='pending',available_at=?,lease_until=NULL,lease_token=NULL,last_error=?,updated_at=? WHERE id=?"),
    suspended: db.prepare("UPDATE experience_queue_v1 SET status='suspended',lease_until=NULL,last_error=?,updated_at=? WHERE id=?"),
    memory: db.prepare('SELECT * FROM experience_memories_v1 WHERE fingerprint=?'),
    insertMemory: db.prepare(`INSERT INTO experience_memories_v1(fingerprint,goal,conditions_json,advice,avoid_json,evidence_ids_json,verification,execution_action,execution_args_json,scope,world,version,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    updateMemory: db.prepare('UPDATE experience_memories_v1 SET evidence_ids_json=?,verification=?,updated_at=? WHERE id=?'),
    memoryById: db.prepare('SELECT * FROM experience_memories_v1 WHERE id=?'),
    insertUsage: db.prepare('INSERT OR IGNORE INTO experience_usage_v1(memory_id,evidence_id,success,created_at) VALUES(?,?,?,?)'),
    updateUsage: db.prepare('UPDATE experience_memories_v1 SET success_count=success_count+?,failure_count=failure_count+?,partial_count=partial_count+?,verification=?,updated_at=? WHERE id=?'),
    memories: db.prepare('SELECT * FROM experience_memories_v1 WHERE version=? AND world=? ORDER BY CASE verification WHEN \'verified\' THEN 0 ELSE 1 END,updated_at DESC,id DESC LIMIT ? OFFSET ?'),
  };
  let closed = false;
  const stamp = () => bounded(Number(now()), Date.now(), 0, Number.MAX_SAFE_INTEGER);
  function assertOpen() { if (closed) throw new Error('experience store is closed'); }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function eventRow(row) {
    return { id: row.id, taskVersion: row.task_version, stepId: row.step_id, goal: row.goal,
      world: row.world, version: row.version, action: row.action, args: parse(row.args_json),
      before: parse(row.before_json), after: parse(row.after_json), result: parse(row.result_json), createdAt: row.created_at };
  }
  function validateEvidence(evidenceIds, world, version) {
    if (!evidenceIds.length) throw new TypeError('episode requires evidenceIds');
    return evidenceIds.map(id => {
      const row = q.event.get(id);
      if (!row) throw new Error(`unknown evidence ID ${id}`);
      if (world !== row.world) throw new Error(`evidence ${id} belongs to another world`);
      if (version !== row.version) throw new Error(`evidence ${id} belongs to another version`);
      return eventRow(row);
    });
  }
  function record(event) {
    assertOpen();
    if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('record needs an event object');
    const key = str(event.id, 200);
    const payload = [json(event.args), json(event.before), json(event.after), json(event.result)];
    const metadata = [str(event.taskVersion, 100), str(event.stepId, 100), str(event.goal),
      str(event.world, 200), str(event.version, 100), str(event.action, 120)];
    if (key) {
      const prior = q.eventByKey.get(key);
      if (prior) {
        if ([prior.task_version, prior.step_id, prior.goal, prior.world, prior.version, prior.action].some((v, i) => v !== metadata[i]) ||
          [prior.args_json, prior.before_json, prior.after_json, prior.result_json].some((v, i) => v !== payload[i]))
          throw new Error(`event key ${key} already has different evidence`);
        return Number(prior.id);
      }
    }
    return Number(q.insertEvent.run(key, ...metadata, ...payload, stamp()).lastInsertRowid);
  }
  function enqueue(episode) {
    assertOpen();
    if (!episode || typeof episode !== 'object' || Array.isArray(episode)) throw new TypeError('enqueue needs an episode object');
    const evidenceIds = ids(episode.evidenceIds);
    const world = str(episode.world, 200), version = str(episode.version, 100);
    if (!world || !version) throw new TypeError('episode requires world and version');
    const cited = validateEvidence(evidenceIds, world, version);
    const clean = { id: str(episode.id, 200), taskVersion: str(episode.taskVersion, 100), stepId: str(episode.stepId, 100),
      goal: str(episode.goal), world, version, reason: str(episode.reason, 200), context: episode.context ?? null };
    const last = cited.at(-1);
    const blocker = /block/i.test(clean.reason ?? '') ? [last.action, last.result?.reason ?? null,
      last.result?.missing ?? last.result?.evidence?.missing ?? null] : null;
    const signature = json([clean.taskVersion, clean.goal, world, version, clean.reason, clean.stepId, blocker]);
    return transaction(() => {
      const existingKey = clean.id && q.queueKey.get(clean.id);
      if (existingKey) return Number(existingKey.id);
      const remaining = [...evidenceIds];
      let firstId = null;
      for (const merge of q.queueMerge.all(signature)) {
        const existing = parse(merge.evidence_ids_json);
        const slots = MAX_EVIDENCE_PER_EPISODE - existing.length;
        if (slots <= 0) continue;
        const take = remaining.splice(0, slots);
        if (!take.length) break;
        q.updateMerge.run(json([...new Set([...existing, ...take])]), stamp(), merge.id);
        firstId ??= Number(merge.id);
        if (!remaining.length) {
          if (clean.id) q.insertKey.run(clean.id, firstId);
          return firstId;
        }
      }
      let part = 0;
      while (remaining.length) {
        const t = stamp(), chunk = remaining.splice(0, MAX_EVIDENCE_PER_EPISODE);
        const status = q.queueCount.get().n < capacity ? 'pending' : 'overflow';
        const key = clean.id && !firstId && part === 0 ? clean.id : null;
        const id = Number(q.insertQueue.run(key, signature, json(clean), json(chunk), status, t, t, t).lastInsertRowid);
        firstId ??= id;
        part++;
      }
      if (clean.id) q.insertKey.run(clean.id, firstId);
      return firstId;
    });
  }
  function reviewEvent(event) {
    if (json(event).length <= MAX_REVIEW_EVENT_BYTES) return event;
    return { id: event.id, taskVersion: event.taskVersion, stepId: event.stepId, goal: event.goal,
      world: event.world, version: event.version, action: event.action,
      result: { status: event.result?.status, summary: str(event.result?.summary, 200) }, truncated: true };
  }
  function claim({ leaseMs = 60000 } = {}) {
    assertOpen();
    return transaction(() => {
      const t = stamp(), row = q.due.get(t, t) ?? (q.queueCount.get().n < capacity ? q.overflow.get() : null);
      if (!row) return null;
      const token = randomUUID();
      q.lease.run(t + bounded(leaseMs, 60000, 1, 3600000), token, t, row.id);
      const episode = parse(row.episode_json);
      const evidenceIds = parse(row.evidence_ids_json);
      return { ...episode, context: json(episode.context).length > 4096 ? { truncated: true } : episode.context,
        id: Number(row.id), episodeKey: row.episode_key, evidenceIds,
        evidence: validateEvidence(evidenceIds, episode.world, episode.version).map(reviewEvent),
        mergedCount: row.merged_count, attempts: row.attempts + 1, leaseToken: token };
    });
  }
  function validLease(claimed) {
    const row = claimed && q.queue.get(claimed.id);
    return row?.lease_token === claimed.leaseToken &&
      (row.status === 'suspended' || (row.status === 'leased' && row.lease_until > stamp())) ? row : null;
  }
  function complete(claimed, review) {
    assertOpen();
    return transaction(() => {
      const row = validLease(claimed);
      if (!row) return false;
      if (!review || typeof review !== 'object' || !Array.isArray(review.memories)) throw new TypeError('review requires memories array');
      if (review.memories.length > 24) throw new TypeError('review contains too many memories');
      const episode = parse(row.episode_json), allowed = new Set(parse(row.evidence_ids_json));
      const memories = review.memories.flatMap(raw => {
        if (!raw || typeof raw !== 'object') throw new TypeError('invalid memory');
        const evidenceIds = ids(raw.evidenceIds);
        if (evidenceIds.some(id => !allowed.has(id))) throw new Error('review cites evidence outside episode');
        const cited = evidenceIds.length ? validateEvidence(evidenceIds, episode.world, episode.version) : [];
        const goal = str(raw.goal ?? episode.goal), advice = str(raw.advice, 700);
        if (!goal || !advice) throw new TypeError('memory requires goal and advice');
        const conditions = clauses(raw.conditions), avoidWhen = clauses(raw.avoidWhen);
        const executionAction = str(raw.executionAction, 120), executionArgs = raw.executionArgs ?? null;
        if (executionArgs != null && (!executionArgs || typeof executionArgs !== 'object' || Array.isArray(executionArgs) || json(executionArgs).length > 2048))
          throw new TypeError('invalid executionArgs');
        const hasEvidence = e => e.before != null && e.after != null && meaningful(e.result?.evidence);
        const success = cited.find(e => json(e).length <= MAX_REVIEW_EVENT_BYTES && hasEvidence(e) &&
          canonical(e.before) !== canonical(e.after) && e.result?.status === 'success' &&
          executionAction && e.action === executionAction && canonical(e.args) === canonical(executionArgs));
        const failure = cited.find(e => e.before != null && e.after != null &&
          ['blocked', 'failed'].includes(e.result?.status) &&
          (meaningful(e.result?.reason) || meaningful(e.result?.missing) || meaningful(e.result?.evidence)));
        const world = episode.world, version = episode.version;
        const scope = 'world';
        const make = (text, applicable, excluded, evidence, verification, action, args) => ({
          fingerprint: json([goal.toLowerCase(), applicable, text.toLowerCase(), excluded, action, args, world, version]),
          goal, conditions: applicable, advice: text, avoidWhen: excluded, evidenceIds: evidence,
          verification, executionAction: action, executionArgs: args, scope, world, version,
        });
        const out = [make(advice, conditions, avoidWhen, evidenceIds, 'suggestion', executionAction, executionArgs)];
        const observed = raw.verification === 'verified' && success ? success : failure;
        if (observed) {
          const verified = observed === success;
          const observedConditions = observed.before?.dimension ? clauses({ dimension: observed.before.dimension }) : [];
          const detail = verified ? 'succeeded with observed state change' : `returned ${observed.result.status}`;
          const text = str(`Observed action ${observed.action}(${canonical(observed.args)}) ${detail}.`, 700);
          out.push(make(text, observedConditions, [], [observed.id], verified ? 'verified' : 'observed_failure',
            observed.action, observed.args));
        }
        return out;
      });
      for (const m of memories) {
        const previous = q.memory.get(m.fingerprint), t = stamp();
        if (previous) {
          const evidenceIds = [...new Set([...parse(previous.evidence_ids_json), ...m.evidenceIds])];
          const verification = previous.verification === 'invalidated' ? 'invalidated'
            : previous.verification === 'verified' || m.verification === 'verified' ? 'verified'
              : previous.verification === 'observed_failure' || m.verification === 'observed_failure' ? 'observed_failure' : 'suggestion';
          q.updateMemory.run(json(evidenceIds), verification, t, previous.id);
        } else q.insertMemory.run(m.fingerprint, m.goal, json(m.conditions), m.advice, json(m.avoidWhen),
          json(m.evidenceIds), m.verification, m.executionAction, json(m.executionArgs), m.scope, m.world, m.version, t, t);
      }
      q.done.run(json({ memories: memories.map(({ fingerprint, ...memory }) => memory) }), stamp(), row.id);
      return true;
    });
  }
  function fail(claimed, error, { baseDelayMs = 1000, maxDelayMs = 300000 } = {}) {
    assertOpen();
    return transaction(() => {
      const row = validLease(claimed);
      if (!row) return false;
      const base = bounded(baseDelayMs, 1000, 1, 3600000);
      const ceiling = bounded(maxDelayMs, 300000, base, 86400000);
      const delay = Math.min(ceiling, base * 2 ** Math.min(row.attempts - 1, 20));
      const t = stamp();
      q.failed.run(t + delay, str(error?.message ?? error, 500), t, row.id);
      return true;
    });
  }
  function suspend(claimed, error) {
    assertOpen();
    return transaction(() => {
      const row = validLease(claimed);
      if (!row) return false;
      q.suspended.run(str(error?.message ?? error, 500), stamp(), row.id);
      return true;
    });
  }
  function retrieve(context = {}, { limit = 5 } = {}) {
    assertOpen();
    const world = str(context.world, 200), version = str(context.version, 100);
    if (!world || !version) return [];
    const target = words(context.goal);
    const max = bounded(limit, 5, 0, 10);
    if (!max) return [];
    const found = [];
    for (let offset = 0; found.length < max; offset += 100) {
      const page = q.memories.all(version, world, 100, offset);
      for (const row of page) {
        if (row.verification === 'invalidated') continue;
        const goalWords = words(row.goal);
        if (target.size && ![...target].some(word => goalWords.has(word))) continue;
        if (!matches(parse(row.conditions_json), context.conditions)) continue;
        if (parse(row.avoid_json).some(clause => matches([clause], context.conditions))) continue;
        found.push(row);
        if (found.length >= max) break;
      }
      if (page.length < 100) break;
    }
    return found.map(row => ({ id: Number(row.id), goal: row.goal, conditions: parse(row.conditions_json),
      advice: row.advice, avoidWhen: parse(row.avoid_json), evidenceIds: parse(row.evidence_ids_json),
      verification: row.verification, executionAction: row.execution_action, executionArgs: parse(row.execution_args_json),
      successCount: row.success_count, failureCount: row.failure_count, partialCount: row.partial_count,
      scope: row.scope, world: row.world, version: row.version }));
  }
  function recordUsage(id, { success, evidenceId } = {}) {
    assertOpen();
    if (typeof success !== 'boolean' || !Number.isSafeInteger(evidenceId)) throw new TypeError('usage requires success and evidenceId');
    return transaction(() => {
      const memory = q.memoryById.get(id), evidence = q.event.get(evidenceId);
      if (!memory || !evidence) throw new Error('unknown memory or evidence ID');
      if (memory.version !== evidence.version || (memory.world != null && memory.world !== evidence.world))
        throw new Error('usage evidence belongs to another world or version');
      if (memory.execution_action && (memory.execution_action !== evidence.action ||
        canonical(parse(memory.execution_args_json)) !== canonical(parse(evidence.args_json))))
        throw new Error('usage action does not match memory');
      const result = parse(evidence.result_json);
      const explicitFailure = meaningful(result?.reason) || meaningful(result?.missing) || meaningful(result?.evidence);
      const explicitSuccess = meaningful(result?.evidence);
      const changed = canonical(parse(evidence.before_json)) !== canonical(parse(evidence.after_json));
      const outcome = success && result?.status === 'success' && changed && explicitSuccess ? 1
        : !success && ['blocked', 'failed'].includes(result?.status) && explicitFailure ? 0
          : !success && result?.status === 'partial' && changed && explicitSuccess ? 2 : null;
      if (outcome == null)
        throw new Error('usage outcome lacks matching operation evidence');
      const inserted = q.insertUsage.run(id, evidenceId, outcome, stamp());
      if (inserted.changes) {
        const verification = outcome === 0 && memory.verification === 'verified' ? 'invalidated' : memory.verification;
        q.updateUsage.run(Number(outcome === 1), Number(outcome === 0), Number(outcome === 2), verification, stamp(), id);
      }
      const updated = q.memoryById.get(id);
      return { id: Number(id), successCount: updated.success_count, failureCount: updated.failure_count, partialCount: updated.partial_count,
        verification: updated.verification, recorded: !!inserted.changes };
    });
  }
  function stats() {
    assertOpen();
    const queue = { pending: 0, leased: 0, suspended: 0, overflow: 0, done: 0 };
    for (const row of db.prepare('SELECT status,COUNT(*) AS n FROM experience_queue_v1 GROUP BY status').all()) queue[row.status] = row.n;
    return { events: db.prepare('SELECT COUNT(*) AS n FROM experience_events_v1').get().n,
      memories: db.prepare('SELECT COUNT(*) AS n FROM experience_memories_v1').get().n, queue,
      nextReviewAt: nextReviewAt() };
  }
  function nextReviewAt() {
    assertOpen();
    const due = q.nextDue.get().at;
    if (q.overflowCount.get().n && q.queueCount.get().n < capacity) return Math.min(due ?? Infinity, stamp());
    return due ?? null;
  }
  return { record, enqueue, retrieve, recordUsage, claim, complete, fail, suspend, nextReviewAt, stats,
    close() { if (!closed) { closed = true; db.close(); } } };
}
