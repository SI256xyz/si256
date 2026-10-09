import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { parse } from 'node-html-parser';
import { build, buildFavicon, ROOT, LOGO, handleFromUrl } from './build.mjs';

sharp.cache(false);
const MEMFILE = 'CLAU' + 'DE.md';
const TMP = path.join(ROOT, '.gate-tmp');
const rmrf = (p) => fs.rm(p, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md', '']);
const isBase58 = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);
const isEvm = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;

async function walk(dir, skip = () => false) {
  const out = [];
  if (!fsSync.existsSync(dir)) return out;
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip(p, e)) continue;
    if (e.isDirectory()) out.push(...(await walk(p, skip)));
    else out.push(p);
  }
  return out;
}
const isText = (p) => TEXT_EXT.has(path.extname(p).toLowerCase()) || p.endsWith('_headers');
const read = (p) => fs.readFile(p, 'utf8');
async function textFiles(dir) { return (await walk(dir)).filter(isText); }

function words(s) { return (s.toLowerCase().match(/[a-z0-9]+/g) || []); }
function bigrams(nodes) {
  const set = new Set();
  for (const n of nodes) { const w = words(n); for (let i = 0; i + 1 < w.length; i++) set.add(w[i] + ' ' + w[i + 1]); }
  return set;
}
const decode = (s) => s.replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&copy;/g, '©').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

function visibleNodes(html) {
  const root = parse(html);
  root.querySelectorAll('script,style,svg,noscript').forEach((n) => n.remove());
  const out = [];
  (function rec(n) {
    if (n.nodeType === 3) { const t = decode(n.rawText).trim(); if (t) out.push(t); return; }
    n.childNodes.forEach(rec);
  })(root);
  return out;
}
function jsStrings(js) {
  const out = [];
  for (const m of js.matchAll(/'((?:[^'\\\n]|\\.){4,})'|"((?:[^"\\\n]|\\.){4,})"/g)) {
    const s = (m[1] || m[2]).replace(/\\u[0-9a-fA-F]{4}/g, ' ').replace(/\\./g, ' ');
    if (/\s/.test(s.trim()) && /[a-zA-Z]{2}/.test(s)) out.push(s);
  }
  return out;
}

const rec = (state) => (state.register.records);
const nonStated = (r) => Object.entries(r).filter(([, v]) => v.state !== 'stated');

/* ------------------------------------------------------------------ gates */
export const GATES = [
  {
    id: 'G01', name: 'register: every record has a state; inert records carry null value and null url',
    async fn(c) {
      const bad = [];
      for (const [k, v] of Object.entries(rec(c))) {
        if (!['stated', 'absent', 'unconfirmed'].includes(v.state)) bad.push(`${k}: bad state ${v.state}`);
        else if (v.state !== 'stated' && (v.value !== null || v.url !== null)) bad.push(`${k}: inert but value/url set`);
        else if (v.state === 'stated' && v.value === null && v.url === null) bad.push(`${k}: stated but empty`);
      }
      return [!bad.length, bad.join('; ') || `${Object.keys(rec(c)).length} records`];
    },
  },
  {
    id: 'G02', name: 'dist embeds exactly the register it was built from',
    async fn(c) {
      const root = parse(await read(path.join(c.dist, 'index.html')));
      const el = root.querySelector('script#register');
      if (!el) return [false, 'no embedded register'];
      const emb = JSON.parse(el.rawText);
      const same = JSON.stringify(emb) === JSON.stringify(c.register);
      const bad = nonStated(emb.records).filter(([, v]) => v.value !== null || v.url !== null).map(([k]) => k);
      return [same && !bad.length, same ? (bad.length ? 'inert with data: ' + bad : 'identical') : 'embedded register differs'];
    },
  },
  {
    id: 'G03', name: 'CA slot: stated branch shows the full address and copies it; absent branch is inert with no value',
    async fn(c) {
      const root = parse(await read(path.join(c.dist, 'index.html')));
      const slots = root.querySelectorAll('[data-record="ca"]');
      if (slots.length !== 1) return [false, `${slots.length} CA slots`];
      const ca = rec(c).ca, el = slots[0];
      const top = root.querySelector('header.top');
      if (!top || !top.querySelector('[data-record="ca"]')) return [false, 'CA slot is not inside the fixed header'];
      if (ca.state === 'stated') {
        const code = el.querySelector('code.ca__addr');
        const ok = el.tagName === 'BUTTON' && el.getAttribute('data-copy') === ca.value && code && code.text.trim() === ca.value && (isBase58(ca.value) || isEvm(ca.value));
        return [!!ok, ok ? 'stated: full address, copy wired' : 'stated but slot does not carry the exact address'];
      }
      const txt = el.text;
      const ok = el.classList.contains('is-inert') && el.tagName !== 'BUTTON' && !el.getAttribute('data-copy') && !el.getAttribute('href') && !isBase58(txt.trim()) && !/0x[0-9a-fA-F]{40}/.test(txt);
      return [ok, ok ? 'absent: inert, no value, no href, no data-copy' : 'absent but slot is live or carries data'];
    },
  },
  {
    id: 'G04', name: 'social top-right: X and GitHub icons both present, icon only; href only for stated records',
    async fn(c) {
      const root = parse(await read(path.join(c.dist, 'index.html')));
      const group = root.querySelector('header.top .social');
      if (!group) return [false, 'no .social group in header'];
      const bad = [];
      for (const key of ['x', 'github']) {
        const el = group.querySelector(`[data-record="${key}"]`);
        const r = rec(c)[key];
        if (!el) { bad.push(`${key}: missing`); continue; }
        if (!el.querySelector('svg')) bad.push(`${key}: no svg`);
        const copy = decode(el.text).replace(/\s+/g, '');
        if (copy) bad.push(`${key}: visible text "${copy}"`);
        if (r.state === 'stated') {
          if (el.tagName !== 'A' || el.getAttribute('href') !== r.url) bad.push(`${key}: stated but href != register url`);
        } else if (el.getAttribute('href') !== undefined || el.tagName === 'A' || el.getAttribute('aria-disabled') !== 'true') bad.push(`${key}: inert but linked or not aria-disabled`);
      }
      const css = await read(path.join(c.dist, 'styles.css'));
      for (const m of css.matchAll(/([^{}]+)\{([^{}]*display\s*:\s*none[^{}]*)\}/g)) if (/\.social|\.icon-btn/.test(m[1]) && !/burger/.test(m[1])) bad.push('icons hidden by css: ' + m[1].trim());
      const xs = group.querySelector('[data-record="x"] path')?.getAttribute('d') || '';
      const gs = group.querySelector('[data-record="github"] path')?.getAttribute('d') || '';
      if (!xs.startsWith('M18.901 1.153h3.68') || !gs.startsWith('M8 0c4.42 0 8 3.58 8 8')) bad.push('icon paths are not the official marks');
      return [!bad.length, bad.join('; ') || 'x=' + rec(c).x.state + ', github=' + rec(c).github.state + ', both rendered'];
    },
  },
  {
    id: 'G05', name: 'link rule: no href for unstated records; every href is an in-page id or a stated record url',
    async fn(c) {
      const root = parse(await read(path.join(c.dist, 'index.html')));
      const urls = new Set(Object.values(rec(c)).filter((v) => v.state === 'stated' && v.url).map((v) => v.url));
      const ids = new Set(root.querySelectorAll('[id]').map((n) => n.getAttribute('id')));
      const bad = [];
      for (const a of root.querySelectorAll('a')) {
        const h = a.getAttribute('href');
        if (h === undefined) { if (!a.classList.contains('is-inert')) bad.push('anchor without href'); continue; }
        if (!h || h === '#' || /^javascript:/i.test(h)) bad.push('empty/dead href: ' + h);
        else if (h.startsWith('#')) { if (!ids.has(h.slice(1))) bad.push('dangling ' + h); }
        else if (!urls.has(h)) bad.push('unregistered href ' + h);
      }
      for (const el of root.querySelectorAll('[data-record]')) {
        const key = el.getAttribute('data-record').split('-')[0];
        const r = rec(c)[key];
        if (r && r.state !== 'stated' && (el.getAttribute('href') !== undefined || el.getAttribute('data-copy'))) bad.push(`${key}: inert record carries href/data-copy`);
      }
      const ext = root.querySelectorAll('[src],[href]').map((n) => n.getAttribute('src') || n.getAttribute('href')).filter((u) => /^https?:/.test(u || '') && !urls.has(u));
      const meta = ext.filter((u) => !u.startsWith(rec(c).domain.url));
      if (meta.length) bad.push('external refs not in register: ' + meta.join(','));
      return [!bad.length, bad.join('; ') || 'all hrefs resolve to ids or stated urls'];
    },
  },
  {
    id: 'G06', name: 'link rule: handle is derived from the stored url, never typed into source',
    async fn(c) {
      const bad = [];
      const files = (await textFiles(c.src)).filter((f) => !f.endsWith('register.json'));
      for (const f of files) { const t = await read(f); if (/x\.com\/|twitter\.com\/|@SI256/i.test(t)) bad.push(path.relative(c.root, f)); }
      const r = rec(c).x;
      if (r.state === 'stated') {
        const html = await read(path.join(c.dist, 'index.html'));
        if (!html.includes(handleFromUrl(r.url))) bad.push('derived handle not rendered');
      }
      return [!bad.length, bad.join('; ') || 'no handle or social url literal outside register.json'];
    },
  },
  {
    id: 'G07', name: 'address scanner: address-shaped strings must equal a stated registry value (CA slot and register block exempt)',
    async fn(c) {
      const allowed = new Set(Object.values(rec(c)).filter((v) => v.state === 'stated').flatMap((v) => [v.value, v.url]).filter(Boolean));
      const bad = [];
      let seen = 0;
      for (const f of await textFiles(c.dist)) {
        let t = await read(f);
        if (f.endsWith('index.html')) {
          const root = parse(t);
          root.querySelector('script#register')?.remove();
          root.querySelectorAll('[data-record="ca"]').forEach((n) => n.remove());
          t = root.toString();
        }
        for (const m of t.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])|[1-9A-HJ-NP-Za-km-z]{32,44}/g)) {
          const s = m[0];
          if (!(isEvm(s) || isBase58(s))) continue;
          seen++;
          if (!allowed.has(s)) bad.push(`${path.relative(c.dist, f)}: ${s.slice(0, 12)}...`);
        }
      }
      return [!bad.length, bad.join('; ') || `${seen} address-shaped strings outside exempt regions, all in registry`];
    },
  },
  {
    id: 'G08', name: 'palette: no colour literals outside tokens.json (hex, rgb(), hsl()) in src and scripts',
    async fn(c) {
      const bad = [];
      const files = [...(await textFiles(c.src)), ...(await textFiles(c.scripts))].filter((f) => !f.endsWith('tokens.json') && !f.endsWith('register.json') && !/gates\.mjs$/.test(f));
      for (const f of files) {
        let t = await read(f);
        t = t.replace(/href="#[^"]*"/g, '').replace(/url\(#[^)]*\)/g, '');
        const hx = t.match(HEX);
        if (hx) bad.push(`${path.relative(c.root, f)}: ${hx.slice(0, 3).join(' ')}`);
        if (/\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab)\(/.test(t)) bad.push(`${path.relative(c.root, f)}: functional colour literal`);
      }
      return [!bad.length, bad.join('; ') || `${files.length} files clean`];
    },
  },
  {
    id: 'G09', name: 'palette: every token is a real pixel of its named brand file at the stated coordinate',
    async fn(c) {
      const tokens = JSON.parse(await read(path.join(c.src, 'tokens.json')));
      const bad = [];
      const cache = {};
      for (const [k, t] of Object.entries(tokens.colors)) {
        const file = path.join(c.brand, fsSync.readdirSync(c.brand).find((n) => n === t.file) || t.file);
        if (!fsSync.existsSync(file)) { bad.push(`${k}: ${t.file} missing`); continue; }
        cache[file] ||= await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { data, info } = cache[file];
        const i = (t.y * info.width + t.x) * 4;
        const hex = '#' + [0, 1, 2].map((o) => data[i + o].toString(16).padStart(2, '0')).join('');
        if (data[i + 3] !== 255) bad.push(`${k}: pixel not opaque`);
        if (hex !== t.hex.toLowerCase()) bad.push(`${k}: file pixel ${hex} != ${t.hex}`);
        if (!t.kmeans) bad.push(`${k}: no provenance comment`);
      }
      return [!bad.length, bad.join('; ') || `${Object.keys(tokens.colors).length} tokens verified against pixels`];
    },
  },
  {
    id: 'G10', name: 'palette: every hex literal in dist belongs to the token set, only in tokens.css and favicon.svg',
    async fn(c) {
      const tokens = JSON.parse(await read(path.join(c.src, 'tokens.json')));
      const set = new Set(Object.values(tokens.colors).map((v) => v.hex.toLowerCase()));
      const bad = [];
      for (const f of await textFiles(c.dist)) {
        let t = await read(f);
        t = t.replace(/href="#[^"]*"/g, '').replace(/url\(#[^)]*\)/g, '');
        const rel = path.relative(c.dist, f);
        const found = (t.match(HEX) || []).map((h) => h.toLowerCase());
        for (const h of found) {
          if (!set.has(h)) bad.push(`${rel}: ${h} not a token`);
          else if (!['tokens.css', 'favicon.svg', 'index.html'].includes(rel)) bad.push(`${rel}: ${h} outside tokens file`);
        }
        if (rel === 'index.html' && found.some((h) => h !== tokens.colors.black.hex.toLowerCase())) bad.push('index.html: only the theme-color meta may carry a hex');
      }
      return [!bad.length, bad.join('; ') || 'dist hex literals ⊂ tokens'];
    },
  },
  {
    id: 'G11', name: 'favicon: SVG 32x32, no comments, no double hyphen, colours from tokens, equals the trace of the logo pixel grid',
    async fn(c) {
      const p = path.join(c.dist, 'favicon.svg');
      if (!fsSync.existsSync(p)) return [false, 'missing'];
      const t = await read(p);
      const bad = [];
      if (!/viewBox="0 0 32 32"/.test(t) || !/width="32"/.test(t) || !/height="32"/.test(t)) bad.push('not 32x32');
      if (/<!--/.test(t) || t.includes('--')) bad.push('contains comment or double hyphen');
      if (!/<path /.test(t)) bad.push('no paths');
      const tokens = JSON.parse(await read(path.join(c.src, 'tokens.json')));
      const set = new Set(Object.values(tokens.colors).map((v) => v.hex));
      for (const m of t.matchAll(/fill="([^"]+)"/g)) if (!set.has(m[1])) bad.push('fill ' + m[1]);
      if (t.trim() !== (await buildFavicon(tokens)).trim()) bad.push('differs from a fresh trace of the logo grid');
      return [!bad.length, bad.join('; ') || 'valid, traced from real pixels'];
    },
  },
  {
    id: 'G12', name: 'assets: transparent master has black RGB under alpha 0, so resizes must be premultiplied; dist logo has no dark fringe',
    async fn(c) {
      const src = await sharp(path.join(c.brand, LOGO)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let blackTransparent = 0;
      for (let i = 0; i < src.data.length; i += 4) if (src.data[i + 3] === 0 && !src.data[i] && !src.data[i + 1] && !src.data[i + 2]) blackTransparent++;
      const out = await sharp(path.join(c.dist, 'assets', 'logo-256.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let edge = 0, dark = 0;
      for (let i = 0; i < out.data.length; i += 4) {
        const a = out.data[i + 3];
        if (a > 0 && a < 255) { edge++; if (Math.max(out.data[i], out.data[i + 1], out.data[i + 2]) < 70) dark++; }
      }
      const frac = edge ? dark / edge : 0;
      const ok = blackTransparent > 0 && frac < 0.12;
      return [ok, `source: ${blackTransparent} black-transparent px; dist 256px edge pixels ${edge}, near-black share ${(frac * 100).toFixed(1)}%`];
    },
  },
  {
    id: 'G13', name: 'hygiene: no assistant memory file, no assistant config folder, no AI attribution anywhere in the project',
    async fn(c) {
      const bad = [];
      for (const n of [MEMFILE, MEMFILE.toLowerCase(), '.' + MEMFILE.slice(0, 6).toLowerCase()]) if (fsSync.existsSync(path.join(c.root, n))) bad.push(n + ' exists');
      const pat = new RegExp(['clau' + 'de', 'anthro' + 'pic', 'co-authored' + '-by', 'generated (?:with|by)', 'ai[- ]generated', 'chat' + 'gpt', 'copi' + 'lot', 'gemi' + 'ni'].join('|'), 'i');
      const dirs = [c.src, c.dist, c.scripts, c.research];
      const files = [path.join(c.root, 'package.json'), ...(await Promise.all(dirs.map((d) => textFiles(d)))).flat()];
      for (const f of files) if (fsSync.existsSync(f) && pat.test(await read(f))) bad.push('attribution text in ' + path.relative(c.root, f));
      return [!bad.length, bad.join('; ') || `${files.length} files scanned`];
    },
  },
  {
    id: 'G14', name: 'copy: zero shared 2-grams with the reference site text (page text and script strings)',
    async fn(c) {
      const ref = (await read(path.join(c.research, 'reference-copy.txt'))).split('\n');
      const refSet = bigrams(ref);
      const nodes = visibleNodes(await read(path.join(c.dist, 'index.html')));
      for (const f of await walk(path.join(c.dist, 'js'))) nodes.push(...jsStrings(await read(f)));
      const ours = bigrams(nodes);
      const shared = [...ours].filter((g) => refSet.has(g));
      return [!shared.length, shared.length ? 'shared: ' + shared.slice(0, 8).join(' | ') : `${ours.size} own 2-grams vs ${refSet.size} reference, none shared`];
    },
  },
  {
    id: 'G15', name: 'motion: prefers-reduced-motion kills every animation and transition; scripts honour it',
    async fn(c) {
      const css = await read(path.join(c.dist, 'styles.css'));
      const bad = [];
      const m = css.match(/@media \(prefers-reduced-motion:\s*reduce\)\{[\s\S]*?\n\}/);
      if (!m) bad.push('no reduced-motion block');
      else {
        if (!/\*,\*::before,\*::after\{animation:none!important;transition:none!important\}/.test(m[0])) bad.push('no universal kill switch');
        if (!/scroll-behavior:auto/.test(m[0])) bad.push('smooth scroll not reset');
      }
      const fx = await read(path.join(c.dist, 'js', 'fx.js'));
      const ui = await read(path.join(c.dist, 'js', 'ui.js'));
      if (!/prefers-reduced-motion: reduce/.test(ui)) bad.push('ui.js has no matchMedia check');
      if (!/reduced\(\)/.test(fx) || !/initReveal[\s\S]{0,200}reduced\(\)/.test(fx) || !/initParallax[\s\S]{0,200}reduced\(\)/.test(fx)) bad.push('reveal/parallax ignore reduced motion');
      if (!/reduced\(\)/.test(ui.slice(ui.indexOf('setNumber')))) bad.push('count-up ignores reduced motion');
      return [!bad.length, bad.join('; ') || 'css kill switch + reveal, parallax, count-up all gated'];
    },
  },
  {
    id: 'G16', name: 'mobile: no ch units anywhere; tap target token is 44px and applied to every interactive control',
    async fn(c) {
      const bad = [];
      for (const f of await textFiles(c.dist)) { const t = await read(f); if (/\d(?:\.\d+)?ch\b/.test(t)) bad.push('ch unit in ' + path.relative(c.dist, f)); }
      const css = await read(path.join(c.dist, 'styles.css'));
      if (!/--tap:44px/.test(css)) bad.push('--tap is not 44px');
      for (const sel of ['.icon-btn', '.btn', '.nav a', '.ca{', '.foot li a', '.burger']) if (!css.includes(sel)) bad.push('missing rule ' + sel);
      const tapUse = (css.match(/var\(--tap\)/g) || []).length;
      if (tapUse < 8) bad.push('--tap used only ' + tapUse + ' times');
      if (!/width=device-width, initial-scale=1/.test(await read(path.join(c.dist, 'index.html')))) bad.push('viewport meta');
      return [!bad.length, bad.join('; ') || `no ch units; var(--tap) applied ${tapUse} times`];
    },
  },
  {
    id: 'G17', name: 'pollers: exponential backoff with cap and jitter (executed), both feeds use it, RPC every 2s',
    async fn(c) {
      const mod = await import(pathToFileURL(path.join(c.dist, 'js', 'poller.js')).href + '?t=' + Date.now());
      const bad = [];
      const d = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => mod.nextDelay(2000, n, 60000, () => 0.5));
      if (d[0] !== 2000) bad.push('no-failure delay != interval');
      for (let i = 2; i <= 4; i++) if (!(d[i] >= d[i - 1] * 1.9)) bad.push('not exponential at ' + i);
      if (Math.max(...d) > 60000 * 1.15) bad.push('cap exceeded');
      if (d[8] !== d[7] || d[8] < 60000 * 0.85) bad.push('does not plateau at the cap');
      const lo = mod.nextDelay(2000, 3, 60000, () => 0), hi = mod.nextDelay(2000, 3, 60000, () => 1);
      if (!(lo < hi)) bad.push('no jitter');
      const live = await read(path.join(c.dist, 'js', 'live.js'));
      if ((live.match(/poller\(\{/g) || []).length !== 2) bad.push('expected two poller() feeds');
      if (!/interval:\s*2000/.test(live)) bad.push('RPC interval is not 2000');
      if (!/getBlockHeight/.test(live) || !/commitment/.test(live)) bad.push('getBlockHeight with commitment missing');
      return [!bad.length, bad.join('; ') || `delays @2s base: ${d.join(',')}`];
    },
  },
  {
    id: 'G18', name: 'live data: endpoints come from the register, no hard-coded URLs or numbers; tiles ship as dashes',
    async fn(c) {
      const bad = [];
      for (const f of await walk(path.join(c.dist, 'js'))) {
        const t = await read(f);
        if (/https?:\/\//.test(t)) bad.push('url literal in ' + path.basename(f));
        if (/publicnode|api\.dexscreener/.test(t)) bad.push('endpoint literal in ' + path.basename(f));
      }
      const live = await read(path.join(c.dist, 'js', 'live.js'));
      if (!/reg\.rpc\.url/.test(live) || !/reg\.market_api\.url/.test(live)) bad.push('endpoints not read from register');
      const root = parse(await read(path.join(c.dist, 'index.html')));
      for (const id of ['t-height', 't-price', 't-chg', 't-vol']) {
        const v = root.querySelector(`#${id} .tile__v`);
        if (!v || decode(v.text).trim() !== '—') bad.push(id + ' not a dash at build time');
      }
      const css = await read(path.join(c.dist, '_headers'));
      for (const k of ['rpc', 'market_api']) { const o = new URL(rec(c)[k].url).origin; if (!css.includes(o)) bad.push('CSP lacks ' + o); }
      return [!bad.length, bad.join('; ') || 'register-driven endpoints, CSP matches, no hard-coded values'];
    },
  },
  {
    id: 'G19', name: 'skeletons and failure states: every live tile, the marquee and the pair list have skeletons; errors render a dash and a message',
    async fn(c) {
      const root = parse(await read(path.join(c.dist, 'index.html')));
      const bad = [];
      for (const id of ['t-height', 't-price', 't-chg', 't-vol']) {
        const t = root.querySelector('#' + id);
        if (!t || !t.querySelector('.skel') || t.getAttribute('data-state') !== 'loading') bad.push(id + ' lacks skeleton/loading state');
      }
      if (!root.querySelector('#marquee .skel')) bad.push('marquee skeleton');
      if (!root.querySelector('#pairs .skel-row')) bad.push('pair skeleton');
      const css = await read(path.join(c.dist, 'styles.css'));
      if (!/\[data-state=ok\] \.skel/.test(css) || !/\.tile__v\{[^}]*transition/.test(css)) bad.push('no skeleton -> value transition');
      const live = await read(path.join(c.dist, 'js', 'live.js'));
      if (!/unreachable/.test(live) || !/DASH/.test(live) || !/setState\([^)]*'error'/.test(live)) bad.push('error path missing dash/message');
      if (!/'empty'/.test(live)) bad.push('empty state missing');
      return [!bad.length, bad.join('; ') || 'skeleton, value fade, empty and error states wired'];
    },
  },
  {
    id: 'G20', name: 'premium features present: progress bar, pulsing pill, parallax layers, spotlight, shared toast, spring reveal, count-up flash',
    async fn(c) {
      const root = parse(await read(path.join(c.dist, 'index.html')));
      const css = await read(path.join(c.dist, 'styles.css'));
      const fx = await read(path.join(c.dist, 'js', 'fx.js'));
      const ui = await read(path.join(c.dist, 'js', 'ui.js'));
      const live = await read(path.join(c.dist, 'js', 'live.js'));
      const checks = {
        progress: !!root.querySelector('#progress') && /initProgress/.test(fx) && /scaleX\(var\(--p/.test(css),
        pill: !!root.querySelector('#pill .dot') && /@keyframes ping/.test(css),
        parallax: root.querySelectorAll('.hero__bg .layer').length >= 3 && /initParallax/.test(fx) && /--px/.test(css),
        spotlight: root.querySelectorAll('.spot').length >= 10 && /\.spot::after/.test(css) && /initSpotlight/.test(fx),
        toast: !!root.querySelector('#toast') && /export function toast/.test(ui) && /wireCopy/.test(ui) && /toast\(/.test(ui),
        spring: /springEasing/.test(fx) && /linear\(\$\{/.test(fx) && root.querySelectorAll('.rv').length >= 15,
        countup: /export function setNumber/.test(ui) && /flash-up/.test(ui) && /@keyframes flash-up/.test(css) && /setNumber/.test(live),
        copyPerAddress: /data-copy/.test(live) && /copyBtn/.test(live),
        marquee: /@keyframes scroll/.test(css) && /renderMarquee/.test(live) && /imageUrl/.test(live),
      };
      const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      return [!bad.length, bad.length ? 'missing: ' + bad.join(',') : Object.keys(checks).join(', ')];
    },
  },
  {
    id: 'G21', name: 'dist integrity: every referenced local file exists; deploy output has the required files',
    async fn(c) {
      const bad = [];
      for (const f of ['index.html', 'favicon.svg', 'tokens.css', 'styles.css', '_headers', 'js/main.js']) if (!fsSync.existsSync(path.join(c.dist, f))) bad.push('missing ' + f);
      const html = await read(path.join(c.dist, 'index.html'));
      const css = await read(path.join(c.dist, 'styles.css'));
      const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).concat([...css.matchAll(/url\(([^)#:]+)\)/g)].map((m) => m[1]));
      for (const r of refs) if (!fsSync.existsSync(path.join(c.dist, r))) bad.push('dangling ' + r);
      for (const m of (await read(path.join(c.dist, 'js', 'main.js'))).matchAll(/from '\.\/([^']+)'/g)) if (!fsSync.existsSync(path.join(c.dist, 'js', m[1]))) bad.push('dangling module ' + m[1]);
      return [!bad.length, bad.join('; ') || `${refs.length} local refs resolve`];
    },
  },
];

/* ------------------------------------------------------------------ runner */
export function makeCtx(over = {}) {
  return {
    root: ROOT,
    src: path.join(ROOT, 'src'),
    scripts: path.join(ROOT, 'scripts'),
    research: path.join(ROOT, 'research'),
    brand: path.join(ROOT, 'brand'),
    dist: path.join(ROOT, 'dist'),
    register: null,
    ...over,
  };
}

export async function runAll(ctx, label) {
  const results = [];
  for (const g of GATES) {
    let r;
    try { r = await g.fn(ctx); } catch (e) { r = [false, 'threw: ' + e.message]; }
    results.push({ id: g.id, name: g.name, pass: r[0], detail: r[1] });
  }
  return { label, results };
}

function printRun(run) {
  console.log(`\n== ${run.label}`);
  for (const r of run.results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}\n          ${r.detail}`);
}

/* ------------------------------------------------------------------ branch variants and mutations */
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function randomAddress(kind, avoid, seed = 7) {
  const r = rng(seed);
  for (;;) {
    let s;
    if (kind === '0x') s = '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
    else s = Array.from({ length: 44 }, () => B58[Math.floor(r() * B58.length)]).join('');
    if (!avoid.has(s) && (kind === '0x' ? isEvm(s) : isBase58(s))) return s;
  }
}
const stated = (rec0, over) => ({ ...rec0, state: 'stated', ...over });

async function variant(name, mutate) {
  const dir = path.join(TMP, name);
  const reg = JSON.parse(await read(path.join(ROOT, 'src', 'register.json')));
  mutate(reg.records);
  await fs.mkdir(dir, { recursive: true });
  const registerPath = path.join(dir, 'register.json');
  await fs.writeFile(registerPath, JSON.stringify(reg));
  const out = path.join(dir, 'dist');
  await build({ outDir: out, registerPath, quiet: true });
  return makeCtx({ dist: out, register: reg });
}

async function copyTree(from, to) {
  await rmrf(to);
  await fs.cp(from, to, { recursive: true });
}

async function mutate(base, name, expectIds, apply, extra = {}) {
  const dir = path.join(TMP, 'mut-' + name);
  const dist = path.join(dir, 'dist');
  const src = path.join(dir, 'src');
  await copyTree(base.dist, dist);
  await copyTree(base.src, src);
  const ctx = { ...base, dist, src, root: dir, ...extra };
  if (extra.root === undefined) ctx.root = ROOT;
  await apply(ctx);
  const run = await runAll(ctx, name);
  const failed = run.results.filter((r) => !r.pass).map((r) => r.id);
  const caught = expectIds.every((id) => failed.includes(id));
  return { name, expectIds, failed, caught };
}

const existing = (reg) => new Set(Object.values(reg.records).flatMap((v) => [v.value, v.url]).filter(Boolean));

export async function mutations(base) {
  const reg = base.register;
  const avoid = existing(reg);
  const strayB58 = randomAddress('b58', avoid, 11);
  const stray0x = randomAddress('0x', avoid, 13);
  const edit = async (ctx, file, fn) => { const p = path.join(ctx.dist, file); await fs.writeFile(p, fn(await read(p))); };
  const out = [];
  const M = (...a) => mutate(base, ...a).then((r) => out.push(r));

  await M('stray base58 address in page body', ['G07'], (c) => edit(c, 'index.html', (h) => h.replace('</footer>', `<p>${strayB58}</p></footer>`)));
  await M('stray 0x address in page body', ['G07'], (c) => edit(c, 'index.html', (h) => h.replace('</footer>', `<p>${stray0x}</p></footer>`)));
  await M('stray address hidden inside a script file', ['G07'], (c) => edit(c, 'js/main.js', (j) => j + `\nconst k='${strayB58}';\n`));
  /* inert/stated inversion on whatever the live state is, read at runtime */
  await M('flip link state of the x record', ['G04', 'G05'], (c) => edit(c, 'index.html', (h) => {
    const root = parse(h);
    const el = root.querySelector('header.top .social [data-record="x"]');
    if (el.tagName === 'A') { el.removeAttribute('href'); } else { el.setAttribute('href', 'https://x.com/example'); }
    return root.toString();
  }));
  await M('flip link state of the github record', ['G04', 'G05'], (c) => edit(c, 'index.html', (h) => {
    const root = parse(h);
    const el = root.querySelector('header.top .social [data-record="github"]');
    if (el.tagName === 'A') el.removeAttribute('href'); else el.setAttribute('href', 'https://github.com/example');
    return root.toString();
  }));
  await M('tamper the CA slot', ['G03'], (c) => edit(c, 'index.html', (h) => {
    const root = parse(h);
    const el = root.querySelector('[data-record="ca"]');
    const cur = el.getAttribute('data-copy');
    el.setAttribute('data-copy', cur ? cur.slice(1) + 'x' : strayB58);
    return root.toString();
  }));
  await M('give an inert record a value in the embedded register', ['G02'], (c) => edit(c, 'index.html', (h) => {
    const root = parse(h);
    const s = root.querySelector('script#register');
    const j = JSON.parse(s.rawText);
    const first = Object.entries(j.records).find(([, v]) => v.state !== 'stated');
    if (first) first[1].value = 'leaked'; else { const any = j.records.name; any.state = 'absent'; }
    s.set_content(JSON.stringify(j));
    return root.toString();
  }));
  await M('hex literal in a dist stylesheet', ['G10'], (c) => edit(c, 'styles.css', (t) => t + '\n.zz{color:#123456}\n'));
  await M('hex literal in a src stylesheet', ['G08'], (c) => edit({ dist: c.src }, 'styles.css', (t) => t + '\n.zz{color:#abcdef}\n'));
  await M('rgb() literal in src script', ['G08'], (c) => edit({ dist: c.src }, 'js/ui.js', (t) => t + '\nconst z="rgb(1,2,3)";\n'));
  await M('ch unit in stylesheet', ['G16'], (c) => edit(c, 'styles.css', (t) => t + '\n.zz{max-width:60ch}\n'));
  await M('reduced-motion block removed', ['G15'], (c) => edit(c, 'styles.css', (t) => t.replace(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\n\}/, '')));
  await M('assistant memory file added to the project root', ['G13'], async (c) => { await fs.mkdir(c.root, { recursive: true }); await fs.writeFile(path.join(c.root, MEMFILE), 'x'); }, { root: path.join(TMP, 'mut-hygiene-root') });
  await M('attribution line inside a source file', ['G13'], (c) => edit({ dist: c.src }, 'styles.css', (t) => t + '\n/* Co-Authored' + '-By: someone */\n'));
  await M('reference bigram pasted into the page', ['G14'], async (c) => {
    const ref = (await read(path.join(c.research, 'reference-copy.txt'))).split('\n').find((l) => words(l).length > 3);
    const w = words(ref).slice(0, 2).join(' ');
    await edit(c, 'index.html', (h) => h.replace('</footer>', `<p>${w}</p></footer>`));
  });
  await M('favicon gets an XML comment with a double hyphen', ['G11'], (c) => edit(c, 'favicon.svg', (t) => t.replace('<path', '<!-- a -- b --><path')));
  await M('favicon resized away from 32x32', ['G11'], (c) => edit(c, 'favicon.svg', (t) => t.replace('viewBox="0 0 32 32"', 'viewBox="0 0 64 64"')));
  await M('visible text label added to an icon', ['G04'], (c) => edit(c, 'index.html', (h) => h.replace(/(data-record="x"[^>]*>)/, '$1X ')));
  await M('skeleton removed from a live tile', ['G19'], (c) => edit(c, 'index.html', (h) => h.replace('<span class="skel" aria-hidden="true"></span>', '')));
  await M('backoff removed from the poller', ['G17'], (c) => edit(c, 'js/poller.js', (t) => t.replace('base * 2 ** fails', 'base')));
  await M('endpoint hard-coded in a script', ['G18'], (c) => edit(c, 'js/live.js', (t) => t + "\nfetch('https://solana-rpc.publicnode.com');\n"));
  await M('logo resized without premultiplying (black fringe)', ['G12'], async (c) => {
    const { data, info } = await sharp(path.join(c.brand, LOGO)).ensureAlpha().extract({ left: 495, top: 780, width: 1012, height: 440 }).raw().toBuffer({ resolveWithObject: true });
    const w = 256, h = Math.round((256 * info.height) / info.width), out = Buffer.alloc(w * h * 4);
    const k = info.width / w;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0]; let n = 0;
      for (let yy = Math.floor(y * k); yy < Math.min(info.height, Math.floor((y + 1) * k)); yy++) for (let xx = Math.floor(x * k); xx < Math.floor((x + 1) * k); xx++) {
        const i = (yy * info.width + xx) * 4; for (let o = 0; o < 4; o++) acc[o] += data[i + o]; n++;
      }
      for (let o = 0; o < 4; o++) out[(y * w + x) * 4 + o] = Math.round(acc[o] / n);
    }
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).webp({ lossless: true }).toFile(path.join(c.dist, 'assets', 'logo-256.webp'));
  });
  await M('dangling asset reference', ['G21'], (c) => edit(c, 'index.html', (h) => h.replace('assets/logo-256.webp', 'assets/missing.webp')));
  return out;
}

async function main() {
  const t0 = Date.now();
  await rmrf(TMP);
  await fs.mkdir(TMP, { recursive: true });
  const runs = [];
  try {
    const realReg = JSON.parse(await read(path.join(ROOT, 'src', 'register.json')));
    const realCtx = makeCtx({ register: realReg });
    const R = realReg.records;
    runs.push(await runAll(realCtx, `branch A: real register as shipped (ca=${R.ca.state}, x=${R.x.state}, github=${R.github.state})`));

    const used = existing(realReg);
    const b58 = randomAddress('b58', used, 21);
    const evm = randomAddress('0x', used, 23);
    const vB = await variant('stated-base58', (r) => { r.ca = stated(r.ca, { value: b58 }); r.github = stated(r.github, { url: 'https://github.com/example-org' }); });
    runs.push(await runAll(vB, 'branch B: CA stated (base58), GitHub stated, X stated'));
    const vC = await variant('stated-0x', (r) => { r.ca = stated(r.ca, { value: evm }); r.x = { ...r.x, state: 'absent', value: null, url: null }; });
    runs.push(await runAll(vC, 'branch C: CA stated (0x), X absent, GitHub absent'));

    /* the stated CA must also survive the scanner when it appears outside the exempt slot only if it is in the registry */
    const html = await read(path.join(vB.dist, 'index.html'));
    const probe = path.join(TMP, 'probe');
    await copyTree(vB.dist, probe);
    await fs.writeFile(path.join(probe, 'index.html'), html.replace('</footer>', `<p>${b58}</p></footer>`));
    const probeRun = await runAll({ ...vB, dist: probe }, 'probe');
    const noBlanket = probeRun.results.find((r) => r.id === 'G07').pass;

    const muts = await mutations(realCtx);
    const mutsB = await mutations(vB);

    for (const r of runs) printRun(r);
    console.log(`\n== scanner is not a blanket reject: registry-stated base58 placed outside the CA slot -> ${noBlanket ? 'accepted' : 'REJECTED'}`);
    console.log('\n== mutation harness (anchors read the live register; each mutant must be caught by the named gate)');
    let mutBad = 0;
    for (const [label, list] of [['A', muts], ['B', mutsB]]) for (const m of list) {
      if (!m.caught) mutBad++;
      console.log(`  ${m.caught ? 'CAUGHT' : 'MISSED'}  [${label}] ${m.name}  (expected ${m.expectIds.join('+')}, failed: ${m.failed.join(',') || 'none'})`);
    }
    const gateFails = runs.flatMap((r) => r.results.filter((x) => !x.pass));
    const total = muts.length + mutsB.length;
    console.log(`\nGATES: ${GATES.length} gates x ${runs.length} register branches = ${GATES.length * runs.length} checks, ${gateFails.length} failing`);
    console.log(`MUTATIONS: ${total} mutants (${muts.length} on branch A, ${mutsB.length} on branch B), ${total - mutBad} caught, ${mutBad} missed`);
    console.log(`SCANNER NOT BLANKET: ${noBlanket ? 'ok' : 'FAIL'}   elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    const ok = !gateFails.length && !mutBad && noBlanket;
    console.log(ok ? 'EXIT 0' : 'EXIT 1');
    process.exitCode = ok ? 0 : 1;
  } finally {
    await rmrf(TMP);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
