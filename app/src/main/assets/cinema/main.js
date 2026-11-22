if (!window.__cinemaMainLoaded) { window.__cinemaMainLoaded = true;
/* Cinema Style: runs in the page's own world so we can ask YouTube to navigate
   without a full page reload (much faster than location.assign). */
(() => {
  const FEEDS = { subscriptions: 'FEsubscriptions', history: 'FEhistory', playlists: 'FEplaylist_aggregation', you: 'FEyou', library: 'FElibrary' };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || typeof e.data.atvNav !== 'string') return;
    let u;
    try { u = new URL(e.data.atvNav, location.origin); } catch (err) { return; }
    const url = u.pathname + u.search;
    let ep = null;
    if (u.pathname === '/watch' && u.searchParams.get('v')) {
      const we = { videoId: u.searchParams.get('v') };
      if (u.searchParams.get('list')) we.playlistId = u.searchParams.get('list');
      ep = { commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } }, watchEndpoint: we };
    } else if (u.pathname === '/results') {
      ep = { commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_SEARCH', rootVe: 4724 } }, searchEndpoint: { query: u.searchParams.get('search_query') || '' } };
    } else if (u.pathname === '/') {
      ep = { commandMetadata: { webCommandMetadata: { url: '/', webPageType: 'WEB_PAGE_TYPE_BROWSE', rootVe: 3854, apiUrl: '/youtubei/v1/browse' } }, browseEndpoint: { browseId: 'FEwhat_to_watch' } };
    } else if (/^\/channel\/UC[\w-]+$/.test(u.pathname)) {
      ep = { commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_CHANNEL', rootVe: 3611, apiUrl: '/youtubei/v1/browse' } }, browseEndpoint: { browseId: u.pathname.split('/')[2] } };
    } else if (u.pathname.startsWith('/feed/') && FEEDS[u.pathname.slice(6)]) {
      ep = { commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_BROWSE', rootVe: 6827, apiUrl: '/youtubei/v1/browse' } }, browseEndpoint: { browseId: FEEDS[u.pathname.slice(6)] } };
    }
    const app = document.querySelector('ytd-app');
    if (!ep || !app) { location.assign(url); return; }
    app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: ep } }));
  });
})();

}
