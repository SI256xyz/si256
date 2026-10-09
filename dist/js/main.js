import { wireCopy } from './ui.js';
import { initReveal, initProgress, initParallax, initSpotlight, initTopMetrics, initNav } from './fx.js';
import { startBlockHeight, startMarket } from './live.js';

initTopMetrics();
initNav();
initProgress();
initSpotlight();
wireCopy();
initParallax();
initReveal();
startBlockHeight();
startMarket();
