// Generic agent runtime: the planner (with world/knowledge tools) sets the direction, JEV picks each bounded action.
import fs from 'node:fs';
import path from 'node:path';
import { actionAllowed } from './config.mjs';
import { parseCommand, isOwner, HELP } from './commands.mjs';
import { inventoryCounts } from './skills.mjs';
import { createPlanExecutor } from './plan-executor.mjs';

const round = (p) => p && { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 };
const compact = (value, depth = 0) => {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, 300);
  if (depth >= 4) return '[more]';
  if (Array.isArray(value)) return value.slice(0, 12).map((entry) => compact(entry, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, entry]) => [key, compact(entry, depth + 1)]));
  return String(value);
};
const canonical = (value) => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export function createAgent({ config, bot, world, knowledge = null, skills, actions = null, experience = null, reviewer = null, models, now = Date.now, log: externalLog }) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const eventsFile = path.join(config.dataDir, 'events.jsonl');
  const log = externalLog || ((type, data = {}) => fs.appendFileSync(eventsFile, JSON.stringify({ time: new Date(now()).toISOString(), type, ...data }) + '\n'));
  const failed = new Map(); // action key -> retry-after timestamp
  const recent = [];
  const stageEvidence = new Map();
  const ctx = { plan: null, request: null, checkedChests: new Set(), isCooling: (key) => (failed.get(key) || 0) > now() };
  let paused = false, stopped = false, busy = false, active = 'starting', steps = 0, planning = null, planVersion = 0, planRevision = 0, plannedFor = -1, controlEpoch = 0, activeAction = null, activePlan = null, activeDecision = null, wakeWait = null, planFailures = 0, nextPlanAt = 0, execution = null, noProgress = 0, noOptionsAt = 0, recoveryAttempts = 0, decisionFailures = 0, nextDecisionAt = 0, pendingSince = 0, pendingReported = false;
  const current = (version, epoch) => !stopped && !paused && version === planVersion && epoch === controlEpoch;
  const deliveryRequested = (text) => /\b(?:give|bring|deliver|hand|toss|get me)\b|(?:交给我|给我|送给我|交付|递给我|拿给我|帮我拿|带给我)/i.test(text);
  const wake = () => wakeWait?.();
  const delay = (ms) => new Promise((resolve) => {
    const done = () => { clearTimeout(timer); if (wakeWait === done) wakeWait = null; resolve(); };
    const timer = setTimeout(done, ms); wakeWait = done;
  });
  const cancelActive = (reason) => {
    activeAction?.abort(reason);
    activePlan?.abort(reason);
    activeDecision?.abort(reason);
    bot.pathfinder?.setGoal(null); bot.clearControlStates?.(); bot.stopDigging?.();
  };
  async function awaitModel(work, controller, timeoutMs) {
    let timer, onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason || new Error('Model call cancelled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    timer = setTimeout(() => controller.abort(new Error(`Model call timed out after ${timeoutMs}ms`)), timeoutMs);
    try { return await Promise.race([Promise.resolve().then(() => { if (controller.signal.aborted) throw controller.signal.reason; return work(controller.signal); }), aborted]); }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); }
  }

  const dim = () => bot.game?.dimension;
  const here = () => bot.entity?.position;
  const worldKey = () => `${config.worldId || `${config.server.host || 'local'}:${config.server.port || 25565}`}:${dim() || 'unknown'}`;
  const context = () => ({ goal: ctx.plan?.objective || ctx.request?.text || config.goals?.join('; ') || '', world: worldKey(), version: config.server.version, conditions: { dimension: dim(), inventory: inventoryCounts(bot) } });
  function applicableExperience() {
    try { return experience?.retrieve(context(), { limit: 3 })?.slice(0, 3).map((entry) => ({ ...entry, advice: String(entry.advice || '').slice(0, 220) })) || []; }
    catch (e) { log('experience_error', { error: e.message }); return []; }
  }
  function recordEvidence(option, result, before, after, version, stageId, meta = {}) {
    if (!experience) return null;
    try { return experience.record({ taskVersion: version, stepId: stageId, goal: meta.goal ?? ctx.plan?.objective, world: meta.world ?? worldKey(), version: config.server.version, action: option.operation?.action || option.skill, args: option.operation?.args || {}, before, after, result }); }
    catch (e) { log('experience_error', { error: e.message }); return null; }
  }
  function recordExperienceUsage(memories, option, result, evidenceId) {
    if (!experience?.recordUsage || !evidenceId || !result?.evidence || !option.operation) return;
    if (!['success', 'blocked', 'partial', 'failed'].includes(result.status)) return;
    for (const memory of memories || []) {
      if (!memory.executionAction || memory.executionAction !== option.operation.action || canonical(memory.executionArgs || {}) !== canonical(option.operation.args || {})) continue;
      try { experience.recordUsage(memory.id, { success: result.status === 'success', evidenceId }); }
      catch (e) { log('experience_usage_error', { memoryId: memory.id, error: e.message }); }
    }
  }
  function queueReview(reason, evidenceIds = [], stageId = null, meta = {}) {
    if (!experience || !evidenceIds.length) return;
    try {
      const currentContext = context();
      experience.enqueue({ id: `${config.name}:${meta.taskVersion ?? planVersion}:${stageId || 'plan'}:${reason}:${evidenceIds.at(-1)}`, taskVersion: meta.taskVersion ?? planVersion, stepId: stageId, goal: meta.goal ?? ctx.plan?.objective, world: meta.world ?? worldKey(), version: config.server.version, reason, evidenceIds, context: { ...currentContext, world: meta.world ?? worldKey(), goal: meta.goal ?? ctx.plan?.objective, conditions: { ...currentContext.conditions, dimension: meta.dimension ?? dim() } } });
      Promise.resolve(reviewer?.kick?.()).catch((e) => log('review_error', { error: e.message }));
    } catch (e) { log('experience_error', { error: e.message }); }
  }
  function appendEvidence(stageId, evidenceId, meta) {
    if (!evidenceId) return;
    const key = `${meta.taskVersion}:${meta.revision}:${stageId || 'legacy'}:${meta.world}`;
    const bucket = stageEvidence.get(key) || { stageId, ids: [], meta };
    bucket.ids.push(evidenceId);
    stageEvidence.set(key, bucket);
    if (!stageId && bucket.ids.length >= 5) { queueReview('action_batch', bucket.ids, null, meta); stageEvidence.delete(key); }
  }
  function flushEvidence(reason) {
    for (const bucket of stageEvidence.values()) queueReview(reason, bucket.ids, bucket.stageId, bucket.meta);
    stageEvidence.clear();
  }

  // Planner tools
  function queryWorld({ name = null, kind = null, radius = 128, limit = 5 } = {}) {
    const p = here();
    if (!p) return [];
    const safeName = typeof name === 'string' ? name.slice(0, 80) : null;
    const safeKind = ['block', 'landmark'].includes(kind) ? kind : null;
    return world.nearest({ dim: dim(), x: p.x, y: p.y, z: p.z, name: safeName, kind: safeKind, radius: Math.max(1, Math.min(Number(radius) || 128, 1024)), limit: Math.max(1, Math.min(Number(limit) || 5, 20)) })
      .map(({ name, kind, x, y, z, distance, data, last_seen }) => ({ name, kind, x, y, z, distance, ...(data ? { data } : {}), lastSeenSecondsAgo: Math.round((now() - last_seen) / 1000) }));
  }
  const worldSummary = (radius = 96) => { const p = here(); return p ? world.summary({ dim: dim(), x: p.x, y: p.y, z: p.z, radius }).slice(0, 25) : []; };
  async function recall(query, limit = 5) {
    const safeQuery = String(query ?? '').slice(0, 200);
    const own = world.searchNotes(safeQuery, { limit: 3 }).map((n) => ({ source: 'own_note', text: n.text }));
    if (!knowledge) return own;
    const shared = await knowledge.search(safeQuery, { limit: Math.max(1, Math.min(Number(limit) || 5, 10)), bot: config.name });
    return [...own, ...shared.map((d) => ({ source: d.source, title: d.title, text: d.text.slice(0, 700), via: d.via }))];
  }
  const tools = {
    query_world: (args) => queryWorld(args),
    search_notes: ({ query } = {}) => world.searchNotes(String(query ?? '').slice(0, 200), { limit: 8 }),
    recall_experience: ({ query }) => recall(query, 5),
  };

  function observation() {
    const p = here();
    const distance = (position) => p && position ? Math.hypot(position.x - p.x, position.y - p.y, position.z - p.z) : Infinity;
    const nearby = Object.values(bot.entities || {}).filter((e) => distance(e.position) < 24).sort((a, b) => distance(a.position) - distance(b.position)).slice(0, 12);
    const hostiles = nearby.filter((e) => e.type === 'hostile' || e.kind === 'Hostile mobs').slice(0, 6).map((e) => ({ id: e.id, name: e.name, distance: Math.round(distance(e.position)) }));
    return {
      agent: config.name, player: bot.entity ? bot.username : null, configuredPlayer: config.account.username, role: config.role,
      position: round(p), dimension: dim(), health: bot.health, food: bot.food, timeOfDay: bot.time?.timeOfDay,
      inventory: inventoryCounts(bot), equipment: { held: bot.heldItem?.name || null, armor: (bot.inventory?.slots || []).slice(5, 9).map((item) => item?.name || null) }, hostilesNearby: hostiles,
      nearbyEntities: nearby.map((e) => ({ id: e.id, name: e.name, position: round(e.position), distance: Math.round(distance(e.position)) })),
      ownersOnline: config.owners.filter((o) => bot.players?.[o]),
      ownerRequest: ctx.request, plan: ctx.plan && { objective: ctx.plan.objective, targets: ctx.plan.targets, waypoint: ctx.plan.waypoint, currentStep: execution?.current(), operations: ctx.plan.operations },
      knownNearby: worldSummary(), recentActions: recent.slice(-8), applicableExperience: applicableExperience(),
    };
  }

  function replan(reason) {
    if (stopped || paused) return Promise.resolve(false);
    if (now() < nextPlanAt) return Promise.resolve(false);
    if (planning) return planning;
    const version = planVersion, epoch = controlEpoch, request = ctx.request;
    const inventoryBaseline = request?.inventoryBaseline || inventoryCounts(bot);
    log('plan_request', { reason, requestVersion: version });
    const controller = new AbortController(); activePlan = controller;
    const work = awaitModel((signal) => models.plan(observation(), { signal }), controller, 120000).then((r) => {
      if (!current(version, epoch)) { log('plan_discarded', { reason: 'Request or control changed', requestVersion: version }); return false; }
      const normalized = { ...r.result, targets: { ...(r.result.targets || {}) }, steps: r.result.steps || [] };
      if (!normalized.steps.length && normalized.operations?.length) normalized.steps = [{ id: 'operations', description: normalized.objective, targets: {}, operations: normalized.operations }];
      for (const [name, extra] of Object.entries(r.result.additionalTargets || {})) {
        const total = (inventoryBaseline[name] || 0) + extra;
        normalized.targets[name] = Math.max(normalized.targets[name] || 0, total);
      }
      normalized.deliveryTargets = (r.result.deliveryTargets?.length ? r.result.deliveryTargets : Object.keys(normalized.targets)).filter((name, index, list) => list.indexOf(name) === index);
      if (request && (request.deliveryRequired || normalized.deliveryRequired) && Object.keys(normalized.targets).length > 1 && !r.result.deliveryTargets?.length) throw new Error('Delivery plan with multiple targets must list final deliveryTargets');
      if (normalized.deliveryTargets.some((name) => !Object.hasOwn(normalized.targets, name))) throw new Error('Delivery item must also be a target');
      normalized.deliveryAmounts = Object.fromEntries(normalized.deliveryTargets.map((name) => [name, r.result.additionalTargets?.[name] || normalized.targets[name]]));
      if (request && normalized.deliveryRequired) request.deliveryRequired = true;
      if (ctx.plan) {
        flushEvidence('plan_revised');
        activeDecision?.abort(new Error('Plan revised'));
        activeAction?.abort(new Error('Plan revised'));
      }
      ctx.plan = normalized; execution = createPlanExecutor(normalized); ctx.plan.operations = execution.pendingOperations(); plannedFor = version; planRevision++; noProgress = 0; noOptionsAt = 0;
      log('plan', { plan: normalized, requestVersion: version, planRevision, toolCalls: r.toolCalls, latencyMs: r.latencyMs, model: r.model });
      if (normalized.note) world.note({ kind: 'plan', text: `Objective: ${normalized.objective}. ${normalized.note}` });
      planFailures = 0; nextPlanAt = 0;
      return true;
    }).catch((e) => { if (current(version, epoch)) { planFailures++; if ((e.status >= 400 && e.status < 500 && e.status !== 429) || /Missing .*API key|Missing .* for /i.test(e.message)) nextPlanAt = now() + 300000; log('plan_error', { error: e.message + (e.cause ? ' (' + (e.cause.code || e.cause.message) + ')' : ''), requestVersion: version, attempt: planFailures, retryAfter: nextPlanAt || null }); } return false; }).finally(() => { if (planning === work) planning = null; if (activePlan === controller) activePlan = null; });
    planning = work;
    return work;
  }

  async function recover(reason) {
    if (recoveryAttempts >= 3) { log('plan_stalled', { reason, requestVersion: planVersion }); return false; }
    recoveryAttempts++;
    return replan(reason);
  }

  function options() {
    const stage = execution?.current();
    const projected = stage ? { ...ctx, request: ctx.request && { ...ctx.request, deliveryRequired: false }, plan: { ...ctx.plan, targets: stage.targets, reserveTargets: ctx.plan.targets, deliveryTargets: [], deliveryRequired: false } } : ctx;
    const all = [...(actions?.candidates(ctx) || []), ...skills.candidates(projected)]
      .filter((o) => actionAllowed(config, o.skill) && (failed.get(o.key) || 0) <= now());
    const prefer = new Set(ctx.plan?.prefer || []);
    // Preferred skills first: JEV sees them at the top of the list, but still chooses.
    return [...all.filter((o) => prefer.has(o.skill)), ...all.filter((o) => !prefer.has(o.skill))].slice(0, 24);
  }

  function remember(entry) {
    recent.push(entry);
    if (recent.length > 40) recent.shift();
  }

  async function learnFailure(option, error) {
    const privateText = `${config.name} (${config.role}) failed "${option.description}" in ${dim()}: ${error}. Objective was: ${ctx.plan?.objective || 'none'}.`;
    world.note({ kind: 'failure', text: privateText, dim: dim(), ...(here() || {}) });
    // Shared lessons never include owner instructions, objectives, coordinates, or raw errors.
    knowledge?.add({ source: 'experience', title: `Failure: ${option.skill}`, text: `${option.skill} failed in ${dim()}; check prerequisites and retry conditions.`, tags: [option.skill, 'failure', 'shared'], bot: config.name, key: `exp:${config.name}:${option.skill}:failure` });
  }

  async function execute(option, signal, timeoutMs) {
    let timer, onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason || new Error('Action cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new Error(`Action timed out after ${timeoutMs}ms`); error.code = 'ACTION_TIMEOUT'; activeAction?.abort(error); reject(error); }, timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve().then(() => { if (signal.aborted) throw signal.reason; return option.fn({ signal }); }), interrupted, timeout]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  function normalizeResult(result) {
    if (result && typeof result === 'object' && typeof result.status === 'string') {
      const allowed = new Set(['success', 'partial', 'blocked', 'failed', 'cancelled', 'unconfirmed']);
      return allowed.has(result.status) ? result : { status: 'unconfirmed', summary: 'Unknown result status', reason: String(result.status) };
    }
    if (typeof result === 'string') {
      if (/^(?:gather_blocked|blocked)(?:\b|_)/i.test(result)) return { status: 'blocked', summary: result, reason: result };
      if (/^(?:failed|error)(?:\b|_)/i.test(result)) return { status: 'failed', summary: result, reason: result };
      return { status: 'success', summary: result, legacyUnverified: true };
    }
    return { status: 'unconfirmed', summary: 'Action returned no verified result' };
  }

  function advanceStage(version) {
    if (!execution) return 0;
    const advanced = execution.advance(inventoryCounts(bot));
    for (const stage of advanced) {
      log('stage_done', { requestVersion: version, planRevision, stageId: stage.id });
      for (const [key, bucket] of stageEvidence) if (bucket.stageId === stage.id) { queueReview('stage_complete', bucket.ids, stage.id, bucket.meta); stageEvidence.delete(key); }
    }
    if (advanced.length) { noProgress = 0; recoveryAttempts = 0; ctx.plan.operations = execution.pendingOperations(); }
    return advanced.length;
  }

  async function step() {
    if (paused || stopped) return 'interrupted';
    if (!bot.entity) return 'no entity';
    // A request can arrive while an older planner call is in flight. Wait for it,
    // then plan the current request rather than acting from the older plan.
    while (!ctx.plan || plannedFor !== planVersion) {
      const version = planVersion, epoch = controlEpoch;
      await replan(ctx.plan ? 'owner request' : 'initial');
      if (!current(version, epoch)) return 'interrupted';
      if (planVersion !== plannedFor) {
        if (planFailures) return 'waiting for plan';
        continue;
      }
    }
    const version = planVersion, epoch = controlEpoch, revision = planRevision;
    advanceStage(version);
    if (execution && ctx.plan.steps.length) checkRequestDone(version);
    if (plannedFor !== version) return 'completed';
    const inv = inventoryCounts(bot);
    const targets = Object.entries(ctx.plan.targets || {});
    const finalStockReady = targets.every(([name, count]) => (inv[name] || 0) >= count);
    const stageReady = !execution || !ctx.plan.steps.length || execution.done();
    const closeHostile = Object.values(bot.entities || {}).some((entity) => (entity.type === 'hostile' || entity.kind === 'Hostile mobs') && here() && entity.position && Math.hypot(entity.position.x - here().x, entity.position.y - here().y, entity.position.z - here().z) < 10);
    const survivalNeeded = bot.health < 12 || bot.food < 12 || closeHostile;
    if (!ctx.request && stageReady && finalStockReady && (targets.length || execution?.done()) && !survivalNeeded) { active = 'goal satisfied'; return 'goal satisfied'; }
    if (execution?.done() && !finalStockReady && (!ctx.request || !ctx.request.deliveryRequired)) { await recover('stages completed, targets unmet'); return 'waiting for plan'; }
    if (ctx.request?.deliveryPending) return 'awaiting delivery';
    if (actions?.pending) {
      if (!pendingSince) pendingSince = now() || 1;
      if (!pendingReported && now() - pendingSince > 60000) { pendingReported = true; log('operation_pending', { since: pendingSince, requestVersion: version }); }
      return 'operation pending';
    }
    pendingSince = 0; pendingReported = false;
    if (now() < nextDecisionAt) return 'decision backoff';
    const opts = options();
    if (!opts.length) {
      if (!noOptionsAt) noOptionsAt = now() || 1;
      if (now() - noOptionsAt >= 10000) { noOptionsAt = now() || 1; await recover('no available actions'); }
      return 'no options';
    }
    noOptionsAt = 0;
    const state = observation();
    let decision;
    const decisionController = new AbortController(); activeDecision = decisionController;
    try { decision = await awaitModel((signal) => models.decide(state, opts, { signal }), decisionController, 60000); decisionFailures = 0; nextDecisionAt = 0; } catch (e) { if (current(version, epoch)) { decisionFailures++; const permanent = (e.status >= 400 && e.status < 500 && e.status !== 429) || /Missing .*API key|Missing .* for /i.test(e.message); nextDecisionAt = now() + (permanent ? 300000 : Math.min(30000, 1000 * 2 ** Math.min(decisionFailures, 5))); log('decision_error', { error: e.message, requestVersion: version, retryAfter: nextDecisionAt }); } return 'decision error'; }
    finally { if (activeDecision === decisionController) activeDecision = null; }
    if (!current(version, epoch) || revision !== planRevision) return 'interrupted';
    const option = decision.selected;
    if (!option || !opts.includes(option)) { log('decision_error', { error: 'Selected action was not offered', requestVersion: version }); return 'decision error'; }
    steps++; active = option.description;
    const stageId = execution?.current()?.id || null;
    const actionMeta = { goal: ctx.plan?.objective, world: worldKey(), dimension: dim(), taskVersion: version, revision };
    const before = { inventory: inventoryCounts(bot), position: round(here()), dimension: dim(), health: bot.health, food: bot.food };
    log('action_start', { step: steps, stageId, key: option.key, skill: option.skill, description: option.description, requestVersion: version, planRevision: revision, offered: opts.map((o) => o.key), latencyMs: decision.latencyMs });
    const started = now();
    const controller = new AbortController(); activeAction = controller;
    try {
      const raw = await execute(option, controller.signal, Math.max(10, config.actionTimeoutMs ?? 120000));
      if (!current(version, epoch) || revision !== planRevision) {
        const evidenceId = recordEvidence(option, { status: 'unconfirmed', summary: 'Action settled after its plan was cancelled or revised', reason: 'stale_completion', observed: compact(raw) }, before, { inventory: inventoryCounts(bot), position: round(here()), dimension: dim() }, version, stageId, actionMeta);
        if (evidenceId) queueReview('stale_completion', [evidenceId], stageId, actionMeta);
        return 'interrupted';
      }
      const result = normalizeResult(raw);
      const after = { inventory: inventoryCounts(bot), position: round(here()), dimension: dim(), health: bot.health, food: bot.food };
      const evidenceId = recordEvidence(option, result, before, after, version, stageId, actionMeta);
      recordExperienceUsage(state.applicableExperience, option, result, evidenceId);
      appendEvidence(stageId, evidenceId, actionMeta);
      remember({ action: option.description, ok: result.status === 'success', result: String(result.summary || result.reason || result.status).slice(0, 160), ...(result.evidence ? { evidence: compact(result.evidence?.detail ?? result.evidence) } : {}) });
      log(result.status === 'success' ? 'action_done' : `action_${result.status}`, { step: steps, stageId, key: option.key, requestVersion: version, result, ms: now() - started });
      if (result.status === 'success' && option.operation) { execution?.record(option.operation, result); ctx.plan.operations = execution?.pendingOperations() || []; }
      if (result.status === 'success' && option.skill === 'owner_give' && ctx.request) {
        const name = option.key.startsWith('give_') ? option.key.slice(5) : null;
        if (name && ctx.plan.deliveryTargets.includes(name) && !ctx.request.deliveryDropped.includes(name)) ctx.request.deliveryDropped.push(name);
        if (ctx.plan.deliveryTargets.length && ctx.plan.deliveryTargets.every((item) => ctx.request.deliveryDropped.includes(item))) {
          ctx.request.deliveryPending = true;
          log('delivery_pending', { requestVersion: version, request: ctx.request.text, items: ctx.request.deliveryDropped });
        }
      }
      if (result.status !== 'success') {
        failed.set(option.key, now() + (result.retryable ? 5000 : 30000));
        if (evidenceId) queueReview(result.status, [evidenceId], stageId, actionMeta);
      }
      const advanced = advanceStage(version);
      const inventoryChanged = JSON.stringify(before.inventory) !== JSON.stringify(after.inventory);
      const moved = before.position && after.position && Math.hypot(before.position.x - after.position.x, before.position.y - after.position.y, before.position.z - after.position.z) >= 1;
      if (advanced || inventoryChanged || moved) recoveryAttempts = 0;
      noProgress = advanced || inventoryChanged || moved ? 0 : noProgress + 1;
      if (result.status === 'success') checkRequestDone(version);
      if (noProgress >= 8 && current(version, epoch) && plannedFor === version) { noProgress = 0; await recover('sustained no progress'); }
    } catch (e) {
      if (controller.signal.aborted && e?.code !== 'ACTION_TIMEOUT') {
        const evidenceId = recordEvidence(option, { status: 'unconfirmed', reason: 'cancelled', summary: String(controller.signal.reason?.message || 'cancelled') }, before, { inventory: inventoryCounts(bot), position: round(here()), dimension: dim() }, version, stageId, actionMeta);
        if (evidenceId) queueReview('cancelled', [evidenceId], stageId, actionMeta);
        log('action_cancelled', { step: steps, key: option.key, requestVersion: version, reason: String(controller.signal.reason?.message || 'cancelled') });
        return 'interrupted';
      }
      if (!current(version, epoch) || revision !== planRevision) {
        const evidenceId = recordEvidence(option, { status: 'unconfirmed', reason: 'stale_failure', summary: String(e.message || e) }, before, { inventory: inventoryCounts(bot), position: round(here()), dimension: dim() }, version, stageId, actionMeta);
        if (evidenceId) queueReview('stale_failure', [evidenceId], stageId, actionMeta);
        return 'interrupted';
      }
      failed.set(option.key, now() + 30000);
      remember({ action: option.description, ok: false, error: e.message.slice(0, 160) });
      log('action_failed', { step: steps, key: option.key, requestVersion: version, error: e.message, ms: now() - started });
      const evidenceId = recordEvidence(option, { status: 'failed', reason: e.message }, before, { inventory: inventoryCounts(bot), position: round(here()), dimension: dim() }, version, stageId, actionMeta);
      if (evidenceId) queueReview('failed', [evidenceId], stageId, actionMeta);
      if (++noProgress >= 8 && current(version, epoch)) { noProgress = 0; await recover('repeated action failures'); }
      learnFailure(option, e.message).catch(() => {});
    } finally {
      if (activeAction === controller) activeAction = null;
    }
    return 'acted';
  }

  function completeRequest(version, delivered = false) {
    if (!ctx.request || plannedFor !== version || planVersion !== version) return false;
    const request = ctx.request, targets = ctx.plan?.targets || {}, inv = inventoryCounts(bot);
    const privateText = `${config.name} completed "${request.text}"${delivered ? ' after owner confirmation' : ''} with ${Object.keys(targets).map((n) => `${inv[n] || 0} ${n}`).join(', ')} in ${steps} steps.`;
    flushEvidence('request_complete');
    ctx.request = null; ctx.plan = null; execution = null; plannedFor = -1; planVersion++;
    try { knowledge?.add({ source: 'experience', title: 'Completed request', text: `Completed ${delivered ? 'confirmed delivery' : 'collection'} of ${Object.keys(targets).join(', ') || 'requested items'}.`, tags: ['success', 'shared'], bot: config.name }); }
    catch (error) { log('knowledge_error', { error: error.message }); }
    try { world.note({ kind: 'success', text: privateText }); }
    catch (error) { log('world_note_error', { error: error.message }); }
    say(`Done: ${request.text}`, request.from);
    log('request_done', { request, requestVersion: version, delivered });
    return true;
  }

  function checkRequestDone(version) {
    const targets = ctx.plan?.targets || {};
    const names = Object.keys(targets);
    if (!ctx.request || plannedFor !== version || planVersion !== version) return;
    if (ctx.request.deliveryRequired) return;
    const inv = inventoryCounts(bot);
    if (execution && ctx.plan.steps.length && !execution.done()) return;
    if (!names.length && !execution?.done()) return;
    if (names.every((n) => (inv[n] || 0) >= targets[n])) completeRequest(version);
  }

  async function loop() {
    while (!stopped) {
      if (paused || busy || !bot.entity) { await delay(500); continue; }
      busy = true;
      let outcome;
      try { outcome = await step(); } catch (e) { log('loop_error', { error: e.message }); outcome = 'error'; } finally { busy = false; }
      if (outcome !== 'acted' && !stopped) await delay(outcome === 'waiting for plan' ? Math.min(30000, 1000 * 2 ** Math.min(planFailures, 5)) : outcome === 'decision backoff' ? Math.min(1000, Math.max(250, nextDecisionAt - now())) : ['goal satisfied', 'operation pending', 'awaiting delivery'].includes(outcome) ? 1000 : 250);
    }
  }

  function say(text, to = null) {
    try { to && to !== 'api' ? bot.whisper(to, text.slice(0, 240)) : bot.chat(text.slice(0, 240)); } catch {}
  }

  // External control, shared by chat and the HTTP API.
  function request(text, from) {
    if (stopped) return { accepted: false, reason: 'Agent stopped' };
    flushEvidence('owner_request_changed');
    cancelActive(new Error('Owner request changed'));
    ctx.request = { text, from, at: new Date(now()).toISOString(), inventoryBaseline: inventoryCounts(bot), deliveryRequired: deliveryRequested(text), deliveryDropped: [], deliveryPending: false };
    ctx.plan = null; execution = null; stageEvidence.clear(); plannedFor = -1; planFailures = 0; nextPlanAt = 0; recoveryAttempts = 0; decisionFailures = 0; nextDecisionAt = 0;
    world.note({ kind: 'owner', text: `${from} asked: ${text}` });
    planVersion++; controlEpoch++; paused = false;
    wake();
    log('owner_request', { ...ctx.request, requestVersion: planVersion });
    return { accepted: true, request: ctx.request };
  }
  function pause(from) {
    if (stopped) return { paused: true, stopped: true };
    flushEvidence('paused');
    paused = true; controlEpoch++; active = 'paused by ' + from;
    cancelActive(new Error('Agent paused'));
    wake();
    log('paused', { from });
    return { paused: true };
  }
  function resume(from) { if (stopped) return { paused: true, stopped: true }; paused = false; controlEpoch++; wake(); log('resumed', { from }); return { paused: false }; }

  function confirmDelivery(from) {
    if (stopped) return { confirmed: false };
    const authorized = from === 'api' ? ctx.request?.from === 'api' : isOwner(config.owners, from);
    if (!authorized || !ctx.request?.deliveryRequired || !ctx.request.deliveryPending || plannedFor !== planVersion) return { confirmed: false };
    const requestVersion = planVersion;
    log('delivery_confirmed', { from, requestVersion });
    return { confirmed: completeRequest(requestVersion, true) };
  }

  function status() {
    return { agent: config.name, player: bot.entity ? bot.username : null, configuredPlayer: config.account.username, loginMatchesConfigured: !!bot.entity && bot.username === config.account.username, mode: config.mode, paused, stopped, active, steps, request: ctx.request, plan: ctx.plan, currentStep: execution?.current(), recoveryAttempts, nextPlanAt, nextDecisionAt, position: round(here()), dimension: dim(), health: bot.health, food: bot.food, inventory: bot.inventory ? inventoryCounts(bot) : {}, world: world.stats(), knowledge: knowledge?.stats?.(), experience: experience?.stats?.(), reviewer: reviewer?.stats?.(), models: models.stats?.(), recent: recent.slice(-10) };
  }

  function onChat(username, message) {
    if (username === bot.username || !isOwner(config.owners, username)) return;
    const c = parseCommand(message, bot.username);
    if (!c) return;
    log('chat_command', { from: username, ...c });
    if (c.cmd === 'goal') { request(c.arg, username); say(`OK ${username}: ${c.arg}`, username); }
    else if (c.cmd === 'stop') { pause(username); say('Paused.', username); }
    else if (c.cmd === 'resume') { resume(username); say('Resuming.', username); }
    else if (c.cmd === 'received') { const result = confirmDelivery(username); say(result.confirmed ? 'Receipt confirmed.' : 'No delivery is awaiting confirmation.', username); }
    else if (c.cmd === 'status') { const p = round(here()); say(`${active} | hp ${Math.round(bot.health)} food ${bot.food} | ${p ? `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}` : '?'} | ${ctx.plan?.objective || 'no plan'}`, username); }
    else if (c.cmd === 'where') { const r = queryWorld({ name: c.arg.includes('%') ? c.arg : c.arg.replace(/\s+/g, '_'), limit: 3 }); say(r.length ? r.map((x) => `${x.name} ${x.x} ${x.y} ${x.z} (${Math.round(x.distance)}m)`).join('; ') : `I have not seen ${c.arg} nearby.`, username); }
    else if (c.cmd === 'remember') { world.note({ kind: 'owner', text: `${username}: ${c.arg}`, dim: dim(), ...(here() || {}) }); say('Noted.', username); }
    else if (c.cmd === 'help') say(HELP, username);
  }

  function start() {
    bot.on('chat', onChat);
    bot.on('whisper', onChat);
    loop();
  }
  function stop() { flushEvidence('stopped'); stopped = true; controlEpoch++; cancelActive(new Error('Agent stopped')); wake(); bot.off?.('chat', onChat); bot.off?.('whisper', onChat); }

  return { config, world, start, stop, step, status, request, pause, resume, confirmDelivery, queryWorld, worldSummary, recall, tools, observation, onChat, replan, get ctx() { return ctx; } };
}
