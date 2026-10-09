export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastEl;
let toastTimer = 0;
export function toast(msg) {
  toastEl ||= document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2200);
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (!ok) { toast('Copy failed \u2014 select the text manually'); return false; }
  }
  toast(label);
  return true;
}

/* Delegated copy: any element with data-copy (non-empty) copies that value. */
export function wireCopy() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const v = b.getAttribute('data-copy');
    if (!v) return;
    copyText(v, b.getAttribute('data-copy-label') || 'Copied to clipboard');
  });
}

const ease = (t) => 1 - Math.pow(1 - t, 3);
const tweens = new WeakMap();

/* Count from the shown number to the new one, then flash in the direction of change. */
export function setNumber(el, next, fmt, { flash = true, dur = 650 } = {}) {
  const prev = tweens.get(el)?.value;
  const state = tweens.get(el);
  if (state?.raf) cancelAnimationFrame(state.raf);
  if (!Number.isFinite(next)) { el.textContent = fmt(next); tweens.set(el, { value: NaN }); return; }
  if (flash && Number.isFinite(prev) && prev !== next) {
    const cls = next > prev ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth;
    el.classList.add(cls);
  }
  if (!Number.isFinite(prev) || reduced() || prev === next) {
    el.textContent = fmt(next);
    tweens.set(el, { value: next });
    return;
  }
  const t0 = performance.now();
  const rec = { value: next, raf: 0 };
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = fmt(prev + (next - prev) * ease(k));
    if (k < 1) rec.raf = requestAnimationFrame(step);
    else el.textContent = fmt(next);
  };
  rec.raf = requestAnimationFrame(step);
  tweens.set(el, rec);
}

export function setState(root, state, note) {
  root.dataset.state = state;
  const n = root.querySelector('.tile__note');
  if (n && note !== undefined) n.textContent = note;
}
