import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

sharp.cache(false);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const BRAND = path.join(ROOT, 'brand');
export const LOGO = 'LOGO SI256 PNG...png'; // the transparent master (colourtype 6, RGB 0,0,0 under alpha 0)

/* logo bounds measured from the alpha channel (alpha > 8) */
const BBOX = { left: 495, top: 780, width: 1012, height: 440 };
/* square around the rhino head and horn, used for favicon and touch icon */
const HEAD = { left: 920, top: 770, width: 305, height: 305 };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';
export const ICON_GH = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
const ICON_COPY = '<svg class="ca__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v12H9zM5 15V3h10"/></svg>';

export function handleFromUrl(url) {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
  return seg ? '@' + seg : null;
}

function link(rec, label, icon, key) {
  if (rec.state === 'stated' && rec.url) {
    return `<a class="icon-btn" href="${esc(rec.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(label)}" data-record="${key}">${icon}</a>`;
  }
  return `<span class="icon-btn is-inert" role="link" aria-disabled="true" aria-label="${esc(label)}" data-record="${key}">${icon}</span>`;
}

function renderCa(ca) {
  if (ca.state === 'stated' && ca.value) {
    return `      <button class="ca spot" type="button" data-record="ca" data-copy="${esc(ca.value)}" data-copy-label="Contract address copied" aria-label="Copy contract address ${esc(ca.value)}"><span class="ca__label">CA</span><code class="ca__addr">${esc(ca.value)}</code>${ICON_COPY}</button>`;
  }
  return `      <div class="ca is-inert" data-record="ca" aria-disabled="true"><span class="ca__label">CA</span><span class="ca__addr ca__addr--empty">Contract address not announced yet</span></div>`;
}

export function tokensCss(tokens) {
  const c = Object.entries(tokens.colors).map(([k, v]) => `  --${k}:${v.hex};`).join('\n');
  const m = Object.entries(tokens.motion).map(([k, v]) => `  --${k}:${v};`).join('\n');
  return `:root{\n${c}\n${m}\n}\n`;
}

async function premulBoxAverage(buf, w, h, x0, y0, size, cells) {
  /* Average in premultiplied space: colour channels are weighted by alpha so the black RGB
     stored under transparent pixels cannot bleed into the result. */
  const out = [];
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      const xa = Math.floor((cx * size) / cells), xb = Math.floor(((cx + 1) * size) / cells);
      const ya = Math.floor((cy * size) / cells), yb = Math.floor(((cy + 1) * size) / cells);
      let sa = 0, sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
        const i = (y * w + x) * 4;
        const a = buf[i + 3];
        sa += a; sr += buf[i] * a; sg += buf[i + 1] * a; sb += buf[i + 2] * a; n++;
      }
      out.push(sa ? { a: sa / n / 255, r: sr / sa, g: sg / sa, b: sb / sa } : { a: 0, r: 0, g: 0, b: 0 });
    }
  }
  return out;
}

export async function buildFavicon(tokens) {
  const { data, info } = await sharp(path.join(BRAND, LOGO)).ensureAlpha().extract(HEAD).raw().toBuffer({ resolveWithObject: true });
  const cells = await premulBoxAverage(data, info.width, info.height, 0, 0, info.width, 32);
  const pal = ['cyan', 'magenta', 'ink'].map((k) => {
    const hex = tokens.colors[k].hex;
    return { k, hex, rgb: [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) };
  });
  const grid = cells.map((c) => {
    if (c.a < 0.5) return null;
    let best = pal[0], bd = Infinity;
    for (const p of pal) {
      const d = (p.rgb[0] - c.r) ** 2 + (p.rgb[1] - c.g) ** 2 + (p.rgb[2] - c.b) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  });
  const paths = [];
  for (const p of pal) {
    let d = '';
    for (let y = 0; y < 32; y++) {
      let x = 0;
      while (x < 32) {
        if (grid[y * 32 + x] === p) {
          let e = x;
          while (e < 32 && grid[y * 32 + e] === p) e++;
          d += `M${x} ${y}h${e - x}v1h-${e - x}z`;
          x = e;
        } else x++;
      }
    }
    if (d) paths.push(`<path fill="${p.hex}" d="${d}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${paths.join('')}</svg>\n`;
}

async function copyDir(from, to, skip = () => false) {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (skip(a)) continue;
    if (e.isDirectory()) await copyDir(a, b, skip);
    else await fs.copyFile(a, b);
  }
}

export async function build({ outDir = path.join(ROOT, 'dist'), registerPath = path.join(SRC, 'register.json'), quiet = false } = {}) {
  const tokens = JSON.parse(await fs.readFile(path.join(SRC, 'tokens.json'), 'utf8'));
  const register = JSON.parse(await fs.readFile(registerPath, 'utf8'));
  const R = register.records;

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, 'assets'), { recursive: true });

  await fs.copyFile(path.join(SRC, 'styles.css'), path.join(outDir, 'styles.css'));
  await copyDir(path.join(SRC, 'js'), path.join(outDir, 'js'));
  await copyDir(path.join(SRC, 'assets', 'fonts'), path.join(outDir, 'assets', 'fonts'));
  await fs.writeFile(path.join(outDir, 'tokens.css'), tokensCss(tokens));

  /* logo: crop to the alpha bounds, then resize. sharp/libvips premultiplies before resampling. */
  const master = () => sharp(path.join(BRAND, LOGO)).ensureAlpha().extract(BBOX);
  const webp = { quality: 92, alphaQuality: 100, effort: 5 };
  await master().webp(webp).toFile(path.join(outDir, 'assets', 'logo-1012.webp'));
  await master().resize({ width: 256, kernel: 'lanczos3' }).webp(webp).toFile(path.join(outDir, 'assets', 'logo-256.webp'));

  const bg = { r: 0, g: 0, b: 0, alpha: 1 };
  const bhex = tokens.colors.black.hex;
  [bg.r, bg.g, bg.b] = [1, 3, 5].map((i) => parseInt(bhex.slice(i, i + 2), 16));
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: bg } })
    .composite([{ input: await master().resize({ width: 940, kernel: 'lanczos3' }).png().toBuffer(), gravity: 'centre' }])
    .png().toFile(path.join(outDir, 'assets', 'og.png'));
  const head = await sharp(path.join(BRAND, LOGO)).ensureAlpha().extract(HEAD).resize({ width: 132, kernel: 'lanczos3' }).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: bg } })
    .composite([{ input: head, gravity: 'centre' }]).png().toFile(path.join(outDir, 'assets', 'apple-touch-icon.png'));

  await fs.writeFile(path.join(outDir, 'favicon.svg'), await buildFavicon(tokens));

  /* html */
  const handle = handleFromUrl(R.x.url || 'https://x.com/_') ;
  const xLabel = R.x.state === 'stated' ? `SI256 on X (${handle})` : 'X (not available yet)';
  const social = [link(R.x, xLabel, ICON_X, 'x'), link(R.github, R.github.state === 'stated' ? 'SI256 on GitHub' : 'GitHub (not available yet)', ICON_GH, 'github')].map((s) => '        ' + s).join('\n');
  const xCta = (cls) => (R.x.state === 'stated'
    ? `          <a class="btn ${cls} spot" href="${esc(R.x.url)}" target="_blank" rel="noopener noreferrer" data-record="x-cta">Follow ${esc(handle)}</a>`
    : '');
  const footLinks = [
    R.x.state === 'stated' ? `          <li><a href="${esc(R.x.url)}" target="_blank" rel="noopener noreferrer" data-record="x-foot">X ${esc(handle)}</a></li>` : '          <li><span class="is-inert" data-record="x-foot">X</span></li>',
    R.github.state === 'stated' ? `          <li><a href="${esc(R.github.url)}" target="_blank" rel="noopener noreferrer" data-record="github-foot">GitHub</a></li>` : '          <li><span class="is-inert" data-record="github-foot" aria-disabled="true">GitHub (soon)</span></li>',
  ].join('\n');
  const pairsNote = R.ca.state === 'stated'
    ? 'Pairs shown are matched to the published contract address only.'
    : 'No contract address is published yet, so pairs are matched by name alone and cannot be verified. Treat lookalikes with caution.';
  const regJson = JSON.stringify(register).replace(/</g, '\\u003c');

  let html = await fs.readFile(path.join(SRC, 'index.template.html'), 'utf8');
  html = html
    .replace('<!--SOCIAL-->', social)
    .replace('<!--CA-->', renderCa(R.ca))
    .replace('<!--HERO_X-->', xCta('btn--ghost'))
    .replace('<!--THESIS_X-->', xCta('btn--solid'))
    .replace('<!--FOOT_LINKS-->', footLinks)
    .replace('<!--REGISTER-->', `<script type="application/json" id="register">${regJson}</script>`)
    .replace('{{pairs_note}}', esc(pairsNote))
    .replaceAll('{{color.black}}', tokens.colors.black.hex)
    .replaceAll('{{domain.url}}', R.domain.url)
    .replaceAll('{{domain.value}}', R.domain.value);
  await fs.writeFile(path.join(outDir, 'index.html'), html);

  const origin = (u) => new URL(u).origin;
  const csp = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
    "img-src 'self' data: https://cdn.dexscreener.com",
    `connect-src 'self' ${origin(R.rpc.url)} ${origin(R.market_api.url)}`,
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'",
  ].join('; ');
  await fs.writeFile(path.join(outDir, '_headers'), `/*\n  Content-Security-Policy: ${csp}\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
  await fs.writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n`);

  if (!quiet) console.log('build ok ->', path.relative(ROOT, outDir) || '.');
  return { outDir };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((e) => { console.error(e); process.exit(1); });
}
