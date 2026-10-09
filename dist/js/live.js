import { poller } from './poller.js';
import { setNumber, setState, reduced } from './ui.js';
import { DASH, fmtInt, fmtPrice, fmtPct, fmtCompactUsd, shortAddr, isAddress, safeImage, safePage } from './format.js';

const reg = JSON.parse(document.getElementById('register').textContent).records;
const $ = (id) => document.getElementById(id);
const num = (x) => (x === undefined || x === null || x === '' ? NaN : Number(x));

async function rpc(method, params, signal) {
  const r = await fetch(reg.rpc.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  });
  if (!r.ok) throw new Error('RPC HTTP ' + r.status);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

function setFeed(on) {
  const p = $('pill');
  if (!p) return;
  p.dataset.feed = on;
  $('pill-text').textContent = on === 'ok' ? 'Live on Solana' : on === 'off' ? 'Feed offline — retrying' : 'Connecting';
}

/* Block height: poll every 2s, count up between polls, snap to the real value on every poll. */
export function startBlockHeight() {
  const tile = $('t-height');
  const val = tile.querySelector('.tile__v');
  const commitment = reg.chain.commitment;
  let real = NaN;
  let at = 0;
  let rate = 2.5;
  let shown = NaN;

  const paint = () => {
    if (!Number.isFinite(real)) return;
    const proj = reduced() ? real : real + rate * ((performance.now() - at) / 1000);
    const n = Math.floor(proj);
    if (n !== shown) { shown = n; val.textContent = fmtInt(n); }
  };
  setInterval(paint, 120);

  poller({
    interval: 2000,
    fn: (signal) => rpc('getBlockHeight', [{ commitment }], signal),
    onOk(h) {
      const now = performance.now();
      if (Number.isFinite(real) && h > real) {
        const obs = (h - real) / ((now - at) / 1000);
        if (obs > 0 && obs < 6) rate = rate * 0.7 + obs * 0.3;
      }
      const changed = h !== real;
      real = h;
      at = now;
      shown = NaN;
      if (changed) {
        val.classList.remove('flash-up');
        void val.offsetWidth;
        val.classList.add('flash-up');
      }
      paint();
      setState(tile, 'ok', commitment + ' · refreshed every 2s');
      setFeed('ok');
    },
    onErr(e, n, wait) {
      const secs = Math.round(wait / 1000);
      if (!Number.isFinite(real)) {
        val.textContent = DASH;
        setState(tile, 'error', 'RPC unreachable — retry in ' + secs + 's');
      } else {
        tile.querySelector('.tile__note').textContent = 'Stale — retry in ' + secs + 's';
      }
      setFeed('off');
    },
  });
}

/* DexScreener pairs. Search is fuzzy, so keep only Solana pairs that are SI256
   (and, once the CA is stated, only pairs whose base token is exactly that address). */
const ca = reg.ca;
function matches(p) {
  if (p.chainId !== 'solana' || !p.baseToken) return false;
  if (ca.state === 'stated') return p.baseToken.address === ca.value;
  const re = /(^|[^a-z0-9])si256([^a-z0-9]|$)/i;
  return re.test(p.baseToken.symbol || '') || re.test(p.baseToken.name || '');
}

function coinImg(url, sym) {
  const src = safeImage(url);
  if (!src) {
    const d = document.createElement('div');
    d.className = 'coin';
    d.style.display = 'grid';
    d.style.placeItems = 'center';
    d.style.font = '700 14px var(--font-display)';
    d.textContent = (sym || '?').slice(0, 2).toUpperCase();
    return d;
  }
  const i = new Image();
  i.className = 'coin';
  i.alt = sym ? sym + ' logo' : '';
  i.loading = 'lazy';
  i.referrerPolicy = 'no-referrer';
  i.src = src;
  i.addEventListener('error', () => i.replaceWith(coinImg(null, sym)));
  return i;
}

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v12H9zM5 15V3h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const OPEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function copyBtn(addr, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.setAttribute('data-copy', addr);
  b.setAttribute('data-copy-label', label + ' copied');
  b.setAttribute('aria-label', 'Copy ' + label.toLowerCase() + ' ' + shortAddr(addr));
  b.innerHTML = COPY_ICON;
  return b;
}

function metric(label, value, cls) {
  const d = document.createElement('div');
  const s = document.createElement('span');
  s.textContent = label;
  const b = document.createElement('b');
  b.textContent = value;
  if (cls) b.className = cls;
  d.append(s, b);
  return d;
}

function renderRows(pairs) {
  const box = $('pairs');
  box.replaceChildren();
  for (const p of pairs) {
    const row = document.createElement('article');
    row.className = 'pair spot';
    row.appendChild(coinImg(p.info && p.info.imageUrl, p.baseToken.symbol));
    const id = document.createElement('div');
    id.className = 'pair__id';
    const b = document.createElement('b');
    b.textContent = p.baseToken.symbol || DASH;
    const sm = document.createElement('small');
    sm.textContent = (p.dexId || 'dex') + ' · ' + ((p.quoteToken && p.quoteToken.symbol) || '');
    id.append(b, sm);
    row.appendChild(id);
    const ch = num(p.priceChange && p.priceChange.h24);
    const m = document.createElement('div');
    m.className = 'pair__m';
    m.append(
      metric('Price', fmtPrice(num(p.priceUsd))),
      metric('24h', fmtPct(ch), ch > 0 ? 'up' : ch < 0 ? 'down' : ''),
      metric('24h volume', fmtCompactUsd(num(p.volume && p.volume.h24))),
    );
    row.appendChild(m);
    const acts = document.createElement('div');
    acts.className = 'pair__acts';
    if (isAddress(p.baseToken.address)) acts.appendChild(copyBtn(p.baseToken.address, 'Token address'));
    if (isAddress(p.pairAddress)) acts.appendChild(copyBtn(p.pairAddress, 'Pair address'));
    const page = safePage(p.url);
    if (page) {
      const a = document.createElement('a');
      a.className = 'icon-btn';
      a.href = page;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', 'Open pair on DexScreener');
      a.innerHTML = OPEN_ICON;
      acts.appendChild(a);
    }
    row.appendChild(acts);
    box.appendChild(row);
  }
}

function renderMarquee(pairs) {
  const mq = $('marquee');
  const track = mq.querySelector('.marquee__track');
  const msg = mq.querySelector('.marquee__msg');
  mq.querySelector('.skel')?.remove();
  const seen = new Set();
  const items = [];
  for (const p of pairs) {
    const key = ((p.info && p.info.imageUrl) || '') + '|' + p.baseToken.address;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(p);
  }
  track.replaceChildren();
  if (!items.length) {
    track.hidden = true;
    msg.textContent = 'Token logos appear here once a pair is indexed.';
    msg.hidden = false;
    return;
  }
  msg.hidden = true;
  track.hidden = false;
  const reps = Math.max(1, Math.ceil(8 / items.length));
  for (let copy = 0; copy < 2; copy++) {
    for (let r = 0; r < reps; r++) {
      for (const p of items) {
        const d = document.createElement('div');
        d.className = 'mq';
        if (copy || r) { d.setAttribute('aria-hidden', 'true'); d.dataset.dup = ''; }
        d.append(coinImg(p.info && p.info.imageUrl, p.baseToken.symbol), document.createTextNode(p.baseToken.symbol || DASH));
        track.appendChild(d);
      }
    }
  }
}

function message(text, error) {
  const d = document.createElement('div');
  d.className = 'pairs__msg' + (error ? ' is-error' : '');
  d.textContent = text;
  $('pairs').replaceChildren(d);
}

export function startMarket() {
  const tiles = { price: $('t-price'), chg: $('t-chg'), vol: $('t-vol') };
  const mq = $('marquee');
  const all = Object.values(tiles);
  const put = (tile, v, fmt) => setNumber(tile.querySelector('.tile__v'), v, fmt);
  let had = false;

  poller({
    interval: 30000,
    fn: async (signal) => {
      const r = await fetch(reg.market_api.url, { signal });
      if (!r.ok) throw new Error('DexScreener HTTP ' + r.status);
      const j = await r.json();
      if (!j || !Array.isArray(j.pairs)) throw new Error('Unexpected payload');
      return j.pairs.filter(matches);
    },
    onOk(pairs) {
      mq.dataset.state = pairs.length ? 'ok' : 'empty';
      if (!pairs.length) {
        had = false;
        all.forEach((t) => {
          t.querySelector('.tile__v').textContent = DASH;
          t.querySelector('.tile__v').classList.remove('up', 'down');
          setState(t, 'empty', 'No SI256 pair indexed on Solana yet');
        });
        message('No SI256 trading pair is indexed on Solana yet. This list fills itself the moment one appears.');
        renderMarquee([]);
        return;
      }
      had = true;
      pairs.sort((a, b) => (num(b.liquidity && b.liquidity.usd) || 0) - (num(a.liquidity && a.liquidity.usd) || 0));
      const top = pairs[0];
      put(tiles.price, num(top.priceUsd), fmtPrice);
      const ch = num(top.priceChange && top.priceChange.h24);
      const cv = tiles.chg.querySelector('.tile__v');
      put(tiles.chg, ch, fmtPct);
      cv.classList.toggle('up', ch > 0);
      cv.classList.toggle('down', ch < 0);
      put(tiles.vol, pairs.reduce((s, p) => s + (num(p.volume && p.volume.h24) || 0), 0), fmtCompactUsd);
      setState(tiles.price, 'ok', 'Top pair by liquidity · ' + (top.dexId || ''));
      setState(tiles.chg, 'ok', 'Top pair, last 24 hours');
      setState(tiles.vol, 'ok', 'Across ' + pairs.length + (pairs.length === 1 ? ' pair' : ' pairs'));
      renderRows(pairs);
      renderMarquee(pairs);
    },
    onErr(e, n, wait) {
      const secs = Math.round(wait / 1000);
      if (!had) {
        all.forEach((t) => {
          t.querySelector('.tile__v').textContent = DASH;
          setState(t, 'error', 'DexScreener unreachable — retry in ' + secs + 's');
        });
        message('Market data is unreachable right now. Retrying in ' + secs + 's.', true);
        mq.dataset.state = 'error';
        mq.querySelector('.skel')?.remove();
        const m = mq.querySelector('.marquee__msg');
        m.textContent = 'Logos unavailable — market source unreachable.';
        m.hidden = false;
      } else {
        all.forEach((t) => { t.querySelector('.tile__note').textContent = 'Stale — retry in ' + secs + 's'; });
      }
    },
  });
}
