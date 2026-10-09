/* Pure helpers: address shape tests and number formatting. */
export const isEvmAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
export const isBase58Address = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export const isAddress = (s) => isEvmAddress(s) || isBase58Address(s);

export function handleFromUrl(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0];
    return seg ? '@' + seg : null;
  } catch {
    return null;
  }
}

export const DASH = '\u2014';
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });

export const fmtInt = (n) => (Number.isFinite(n) ? int.format(Math.round(n)) : DASH);
export const fmtCompactUsd = (n) => (Number.isFinite(n) ? '$' + compact.format(n) : DASH);
export function fmtPrice(n) {
  if (!Number.isFinite(n)) return DASH;
  if (n >= 1) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 4, maximumFractionDigits: 12 });
}
export const fmtPct = (n) => (Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : DASH);
export const shortAddr = (a) => (a && a.length > 12 ? a.slice(0, 4) + '\u2026' + a.slice(-4) : a || DASH);

/* Only DexScreener-hosted image and page URLs are ever put into the DOM. */
export function safeImage(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'cdn.dexscreener.com' ? x.href : null;
  } catch {
    return null;
  }
}
export function safePage(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === 'dexscreener.com' ? x.href : null;
  } catch {
    return null;
  }
}
