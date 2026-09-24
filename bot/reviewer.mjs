// Bounded review worker. The injected review function owns any network transport.
export function createReviewer({ store, review = null, config = {}, log = () => {}, now = Date.now } = {}) {
  if (!store || typeof store.claim !== 'function' || typeof store.complete !== 'function')
    throw new TypeError('reviewer requires an experience store');
  const settings = config ?? {};
  const enabled = typeof review === 'function' && settings.enabled !== false;
  const maxPerFlush = Math.max(1, Math.min(100, Number(settings.maxPerFlush) || 4));
  const maxReviews = Number.isFinite(settings.maxReviews) ? Math.max(0, Math.floor(settings.maxReviews)) : 24;
  const minIntervalMs = Math.max(0, Math.min(3600000, Number.isFinite(settings.minIntervalMs) ? settings.minIntervalMs : 15000));
  const debounceMs = Math.max(0, Math.min(3600000, Number.isFinite(settings.debounceMs) ? settings.debounceMs : 15000));
  const timeoutMs = Math.max(100, Math.min(3599000, Number(settings.timeoutMs) || 45000));
  const leaseMs = Math.max(timeoutMs + 1000, Math.min(3600000, Number(settings.leaseMs) || 60000));
  let stopped = false, running = null, timer = null, scheduledAt = null, lastStart = null;
  let completed = 0, failures = 0, attempted = 0;
  const abort = new AbortController();
  const safeLog = message => { try { log(message); } catch {} };
  async function invoke(episode, signal) {
    let onAbort;
    let settled = false;
    const work = Promise.resolve().then(() => review(episode, { signal }));
    work.then(() => { settled = true; }, () => { settled = true; });
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('review aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try { return await Promise.race([work, cancelled]); }
    catch (error) {
      if (signal.aborted && !settled) {
        const pending = new Error(error?.message ?? 'review interrupted');
        pending.unsettledReview = work;
        throw pending;
      }
      throw error;
    }
    finally { signal.removeEventListener('abort', onAbort); }
  }

  async function drain() {
    if (!enabled || stopped) return;
    for (let count = 0; count < maxPerFlush && attempted < maxReviews && !stopped; count++) {
      const episode = store.claim({ leaseMs });
      if (!episode) break;
      attempted++;
      try {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
        const result = await invoke(episode, signal);
        if (stopped) {
          store.fail(episode, new Error('reviewer stopped'), { baseDelayMs: 1000 });
          break;
        }
        if (store.complete(episode, result)) completed++;
      } catch (error) {
        failures++;
        try {
          if (error.unsettledReview) {
            store.suspend(episode, error);
            error.unsettledReview.then(result => {
              if (!stopped && store.complete(episode, result)) completed++;
            }).catch(lateError => {
              if (!stopped) {
                try { store.fail(episode, lateError, { baseDelayMs: settings.baseDelayMs, maxDelayMs: settings.maxDelayMs }); }
                catch (persistError) { safeLog(`reviewer: late review settlement failed: ${persistError.message}`); }
              }
            })
              .finally(() => { if (!stopped) kick(); });
          } else store.fail(episode, error, { baseDelayMs: settings.baseDelayMs, maxDelayMs: settings.maxDelayMs });
        }
        catch (persistError) { safeLog(`reviewer: could not persist failure: ${persistError.message}`); throw persistError; }
        safeLog(`reviewer: review failed for episode ${episode.id}: ${error?.message ?? error}`);
      }
    }
  }
  function clearSchedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    scheduledAt = null;
  }
  function schedule(earliest) {
    if (!enabled || stopped || attempted >= maxReviews || running) return;
    const due = store.nextReviewAt?.();
    if (due == null) { clearSchedule(); return; }
    const target = Math.max(due, earliest, lastStart == null ? 0 : lastStart + minIntervalMs);
    if (timer && scheduledAt <= target) return;
    clearSchedule();
    scheduledAt = target;
    timer = setTimeout(() => {
      timer = null;
      scheduledAt = null;
      run();
    }, Math.max(0, target - now()));
    timer.unref?.();
  }
  function run() {
    if (!enabled || stopped || attempted >= maxReviews) return Promise.resolve();
    if (running) return running;
    clearSchedule();
    lastStart = now();
    running = Promise.resolve().then(drain).catch(error => safeLog(`reviewer: worker stopped after storage error: ${error.message}`))
      .finally(() => { running = null; schedule(now()); });
    return running;
  }
  function kick() {
    if (enabled && !stopped && attempted < maxReviews) schedule(now() + debounceMs);
    return running ?? Promise.resolve();
  }
  async function flush() {
    if (running) await running;
    await run();
  }
  async function stop() {
    stopped = true;
    clearSchedule();
    abort.abort();
    if (running) await running;
  }
  function stats() {
    const storeStats = store.stats();
    return { enabled, stopped, attempted, completed, failures, budgetRemaining: Math.max(0, maxReviews - attempted),
      queue: storeStats.queue, nextReviewAt: scheduledAt ?? storeStats.nextReviewAt, at: now() };
  }
  return { kick, flush, stop, stats };
}
