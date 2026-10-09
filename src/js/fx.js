import { reduced } from './ui.js';

/* Damped spring sampled into a CSS linear() easing so it runs on the compositor. */
export function springEasing({ stiffness = 170, damping = 13, mass = 1, steps = 48 } = {}) {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(1 - zeta * zeta, 1e-6));
  const x = (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
  let settle = 0.2;
  while (settle < 4 && Math.abs(1 - x(settle)) > 0.002) settle += 0.02;
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(x((i / steps) * settle).toFixed(4));
  pts[steps] = '1';
  return { css: `linear(${pts.join(',')})`, duration: Math.round(settle * 1000) };
}

export function initReveal() {
  const els = [...document.querySelectorAll('.rv')];
  if (reduced()) { els.forEach((e) => e.classList.add('is-in')); return; }
  const spring = springEasing();
  const ok = CSS.supports('animation-timing-function', 'linear(0, 1)');
  const ease = ok ? spring.css : 'cubic-bezier(.3,1.4,.7,1)';
  let pending = els;
  let queued = false;
  /* Position based, not crossing based: anything at or above the fold is revealed, so jumps and anchor links never strand hidden content. */
  const check = () => {
    queued = false;
    const line = innerHeight * 0.92;
    const due = pending.filter((el) => el.getBoundingClientRect().top < line);
    if (!due.length) return;
    pending = pending.filter((el) => !due.includes(el));
    due.forEach((el, i) => {
      const inView = el.getBoundingClientRect().bottom > 0;
      el.classList.add('is-in');
      if (!inView) return;
      el.animate(
        [{ opacity: 0, transform: 'translateY(36px) scale(.97)' }, { opacity: 1, transform: 'none' }],
        { duration: ok ? spring.duration : 900, delay: i * 70, easing: ease, fill: 'backwards' },
      );
    });
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(check); } };
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  check();
}

export function initProgress() {
  const bar = document.getElementById('progress');
  if (!bar) return;
  let tick = false;
  const upd = () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', h > 0 ? Math.min(1, scrollY / h).toFixed(4) : 0);
    tick = false;
  };
  addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
  addEventListener('resize', upd);
  upd();
}

export function initParallax() {
  const hero = document.querySelector('.hero');
  if (!hero || reduced()) return;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;
  const loop = () => {
    cx += (tx - cx) * 0.08;
    cy += (ty - cy) * 0.08;
    hero.style.setProperty('--px', cx.toFixed(3));
    hero.style.setProperty('--py', cy.toFixed(3));
    raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(loop) : 0;
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tx = (e.clientX - r.left) / r.width - 0.5;
    ty = (e.clientY - r.top) / r.height - 0.5;
    kick();
  });
  hero.addEventListener('pointerleave', () => { tx = ty = 0; kick(); });
  addEventListener('scroll', () => hero.style.setProperty('--sy', Math.min(scrollY, innerHeight).toFixed(1)), { passive: true });
}

export function initSpotlight() {
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', e.clientX - r.left + 'px');
    t.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });
}

export function initTopMetrics() {
  const top = document.querySelector('.top');
  if (!top) return;
  const set = () => document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px');
  new ResizeObserver(set).observe(top);
  set();
}

export function initNav() {
  const b = document.getElementById('burger');
  const d = document.getElementById('drawer');
  if (!b || !d) return;
  const set = (open) => { b.setAttribute('aria-expanded', String(open)); d.classList.toggle('is-open', open); };
  b.addEventListener('click', () => set(b.getAttribute('aria-expanded') !== 'true'));
  d.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  matchMedia('(min-width:900px)').addEventListener('change', () => set(false));
}
