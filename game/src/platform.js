// Platform adapter: one game build, several storefronts.
//   - Yandex Games: detected by host (yandex.*, *.games.s3.yandex.net, playhop) or ?platform=yandex.
//     Loads /sdk.js, takes the player's language from the SDK, reports LoadingAPI.ready(),
//     mirrors saves to the player's cloud profile and exposes ads/purchases.
//   - Steam (desktop wrapper): the wrapper sets window.STORE_LANG / window.PLATFORM before boot.
//   - Web (itch.io, own site, local): no SDK.
const host = location.hostname;
const qp = (() => { try { return new URLSearchParams(location.search).get('platform'); } catch { return null; } })();
export const PLATFORM = window.PLATFORM || qp || (/(^|\.)yandex\.|yandex\.net$|playhop\.com$/.test(host) ? 'yandex' : 'web');

let ysdk = null, player = null;

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}

export async function initPlatform() {
  if (PLATFORM !== 'yandex') return;
  try {
    if (!window.YaGames) await loadScript('/sdk.js');
    ysdk = await window.YaGames.init();
    window.STORE_LANG = ysdk.environment?.i18n?.lang; // 'ru', 'en', 'tr', ...
    try { player = await ysdk.getPlayer({ scopes: false }); } catch { player = null; }
  } catch (e) { console.warn('Yandex SDK unavailable, running as web build', e); ysdk = null; }
}

/** Call once the main menu is interactive (Yandex moderation requires it). */
export function gameReady() { try { ysdk?.features?.LoadingAPI?.ready(); } catch {} }

/** Cloud save: returns remote data merged over local, or local when offline. */
export async function loadCloud(local) {
  if (!player) return local;
  try { const remote = await player.getData(['reelswars']); return remote?.reelswars ? { ...local, ...remote.reelswars } : local; } catch { return local; }
}
export function saveCloud(data) { if (player) player.setData({ reelswars: data }).catch(() => {}); }

/** Fullscreen ad between levels (Yandex only). Pauses audio via the callbacks. */
export function showInterstitial(onPause, onResume) {
  if (!ysdk) return Promise.resolve();
  return new Promise(res => ysdk.adv.showFullscreenAdv({ callbacks: { onOpen: () => onPause?.(), onClose: () => { onResume?.(); res(); }, onError: () => { onResume?.(); res(); } } }));
}
/** Rewarded video; resolves true when the reward was granted. */
export function showRewarded(onPause, onResume) {
  if (!ysdk) return Promise.resolve(false);
  return new Promise(res => { let ok = false; ysdk.adv.showRewardedVideo({ callbacks: { onOpen: () => onPause?.(), onRewarded: () => { ok = true; }, onClose: () => { onResume?.(); res(ok); }, onError: () => { onResume?.(); res(false); } } }); });
}
export const hasAds = () => !!ysdk;
