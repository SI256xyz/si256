# Reference study (si276.xyz)

Fetched 2026-10-09. Platform: Wix Thunderbolt (1.3 MB server-rendered HTML, bundles on static.parastorage.com).

## Structure (top to bottom)
header (logo, 4 nav links, menu drawer, CA button) -> hero (eyebrow, title, two meta lines, CTA) -> five lettered rows A-E (varying heights 180/162/126/126 px at 1440) -> six "feature" tiles -> paper block with CTA -> four stat tiles -> footer (4 links, 4 market links, email subscribe, credit line).

## APIs
None. The page makes no data API calls of its own; the 422K / 210K / 84K / 72K stat tiles are static text, so treated as fabricated. Only external links: a pump.fun coin page and a dexscreener pair page (theirs, not ours).

## Motion values found in the CSS bundles
- drawer / slide: cubic-bezier(.87, 0, .13, 1), var duration
- fade: opacity .4s cubic-bezier(.645, .045, .355, 1)
- hover: all .5s ease-in-out; quick states .2s ease and .1s ease-out
- pop: cubic-bezier(.3, 1.4, .7, 1) and (.9, -.6, .3, 1.6)
- entrance stagger: animation-delay calc(var(--is-animated) * 50ms), duration .6s
- fonts: Madefor Text and Barlow

## Live APIs used by this build
- Solana RPC getBlockHeight (commitment confirmed): HTTP 200, CORS *, real value 454864873 at fetch time.
- DexScreener search?q=si256: HTTP 200, CORS *, returns zero pairs today (fuzzy search, so results must be filtered by chain and symbol/name, and by address once the CA is stated). q=si276 returns 30 pairs of which 27 Solana, used to verify the response shape (info.imageUrl, priceUsd, priceChange.h24, volume.h24, baseToken.address).
