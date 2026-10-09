/* Generic poller with exponential backoff. No DOM access, so it can be unit-tested in Node. */
export const MAX_DELAY = 60000;

export function nextDelay(base, fails, max = MAX_DELAY, rand = Math.random) {
  if (!fails) return base;
  const raw = Math.min(base * 2 ** fails, max);
  return Math.round(raw * (0.85 + rand() * 0.3));
}

export function poller({ fn, interval, max = MAX_DELAY, timeout = 8000, onOk, onErr, visibility = typeof document !== 'undefined' ? document : null }) {
  let fails = 0;
  let timer = 0;
  let stopped = false;
  let inflight = false;

  async function tick() {
    if (stopped || inflight) return;
    inflight = true;
    const ctl = new AbortController();
    const kill = setTimeout(() => ctl.abort(), timeout);
    try {
      const v = await fn(ctl.signal);
      fails = 0;
      onOk(v);
    } catch (e) {
      fails += 1;
      onErr(e, fails, nextDelay(interval, fails, max, () => 0.5));
    } finally {
      clearTimeout(kill);
      inflight = false;
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(tick, nextDelay(interval, fails, max));
  }

  function onVis() {
    if (!visibility) return;
    if (visibility.hidden) clearTimeout(timer);
    else tick();
  }

  if (visibility) visibility.addEventListener('visibilitychange', onVis);
  tick();
  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (visibility) visibility.removeEventListener('visibilitychange', onVis);
    },
  };
}
