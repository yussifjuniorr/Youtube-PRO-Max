/* Cinema Style for YouTube — content script
 * Reads YouTube's own (hidden) DOM as the data source and renders a TV-style UI on top.
 * Only createElement/textContent are used (no innerHTML) so YouTube's Trusted Types can't break it.
 */
(() => {
  'use strict';
  if (window.__cinemaStyleLoaded) return;
  window.__cinemaStyleLoaded = true;

  const DEFAULTS = { enabled: true, classic: false, previews: true };
  const root = document.documentElement;
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const add = (parent, node) => { if (node) parent.append(node); return parent; };
  const DUR = /^\d{1,2}(:\d{2}){1,2}$/;
  const ytimg = (id, size = 'hqdefault') => 'https://i.ytimg.com/vi/' + id + '/' + size + '.jpg';
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const ICON = {
    play: 'M8 5v14l11-7z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
    right: 'M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z',
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
    chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z',
    list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  };

  /* ---------- tiny DOM helpers ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  function svg(d, size = 20) {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('width', size);
    s.setAttribute('height', size);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'currentColor');
    s.append(p);
    return s;
  }

  /* ---------- settings ---------- */
  let S = { ...DEFAULTS };
  function applyClasses() {
    root.classList.toggle('atv', !!S.enabled);
    root.classList.toggle('atv-classic', !!(S.enabled && S.classic));
  }
  applyClasses();
  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULTS, (v) => {
        if (chrome.runtime.lastError) return;
        S = { ...DEFAULTS, ...v };
        applyClasses();
        tick(true);
      });
    } catch (e) { /* extension context gone */ }
  }
  /* ---------- state ---------- */
  const natives = new Map(); // videoId -> YouTube's own <a>, so we can navigate without a page reload
  const St = { home: { key: '', sig: '', n: 0, seen: new Set(), last: -1 }, watchSig: '', loadAt: 0, heroTimer: 0 };

  const pageType = () => {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p === '/watch') return 'watch';
    return 'other';
  };

  /* ---------- parsing YouTube's DOM (old + new lockup markup) ---------- */
  function parseCard(el) {
    if (!el) return null;
    if (el.closest('ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-in-feed-ad-layout-renderer') ||
        el.querySelector('ytd-ad-slot-renderer')) return null;
    const a = q('a[href*="/watch?v="]', el);
    if (!a) return null;
    let u;
    try { u = new URL(a.getAttribute('href'), location.origin); } catch (e) { return null; }
    const id = u.searchParams.get('v');
    if (!id) return null;

    const titleEl = q('#video-title, .yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, h3', el);
    const title = (txt(titleEl) || a.getAttribute('aria-label') || a.getAttribute('title') || '').trim();
    if (!title) return null;

    const rows = qa('.yt-content-metadata-view-model__metadata-row, .yt-content-metadata-view-model-wiz__metadata-row', el);
    const chLink = q('ytd-channel-name a, a[href^="/@"], a[href^="/channel/"]', el);
    const channel = txt(q('ytd-channel-name', el)) || txt(rows[0]) || txt(chLink);
    const chHref = chLink ? chLink.getAttribute('href') : '';

    const spans = qa('#metadata-line span', el).map(txt).filter(Boolean);
    const meta = spans.length ? spans.join(' · ') : rows.slice(1).map(txt).filter(Boolean).join(' · ');

    const dur = qa('ytd-thumbnail-overlay-time-status-renderer #text, .badge-shape-wiz__text, .yt-badge-shape__text', el)
      .map(txt).find((t) => DUR.test(t)) || '';
    const pEl = q('ytd-thumbnail-overlay-resume-playback-renderer #progress, [class*="WatchedProgressBarSegment"]', el);
    const prog = pEl ? parseFloat(pEl.style.width) || 0 : 0;

    const av = qa('#avatar img, #avatar-link img, yt-decorated-avatar-view-model img, .yt-spec-avatar-shape__image, yt-avatar-shape img', el)
      .map((i) => i.getAttribute('src') || '').find((s) => /ggpht|ytimg|googleusercontent/.test(s)) || '';
    return { id, href: u.pathname + u.search, a, title, channel, chHref, meta, dur, prog, avatar: av };
  }

  function readHome() {
    const seen = new Set();
    const out = [];
    for (const el of qa('ytd-rich-grid-renderer ytd-rich-item-renderer')) {
      const c = parseCard(el);
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }

  function readChips() {
    const bar = q('ytd-feed-filter-chip-bar-renderer');
    if (!bar) return [];
    let nodes = qa('yt-chip-cloud-chip-renderer', bar);
    if (!nodes.length) nodes = qa('chip-shape', bar);
    return nodes
      .map((n) => ({
        label: txt(n),
        el: n,
        on: n.hasAttribute('selected') || n.getAttribute('aria-selected') === 'true' ||
            !!q('.ytChipShapeActive, [aria-selected="true"]', n)
      }))
      .filter((c) => c.label);
  }

  const REL_SEL = '#related yt-lockup-view-model, #related ytd-compact-video-renderer, ' +
                  '#secondary yt-lockup-view-model, #secondary ytd-compact-video-renderer';

  function readRelated(scope, vid) {
    const seen = new Set([vid]);
    const out = [];
    for (const el of qa(REL_SEL, scope)) {
      if (el.closest('ytd-playlist-panel-renderer')) continue;
      const c = parseCard(el);
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
    }
    return out;
  }

  function readPlaylist(scope, vid) {
    const listId = new URLSearchParams(location.search).get('list') || '';
    let best = null;
    for (const p of qa('ytd-playlist-panel-renderer', scope)) {
      const items = qa('ytd-playlist-panel-video-renderer', p);
      if (!best || items.length > best.items.length) best = { p, items };
    }
    if (!best || !best.items.length) return { list: [], title: '', listId };
    const list = best.items.map((el, i) => {
      const a = q('a#wc-endpoint, a[href*="/watch?v="]', el);
      if (!a) return null;
      let u;
      try { u = new URL(a.getAttribute('href'), location.origin); } catch (e) { return null; }
      const id = u.searchParams.get('v');
      if (!id) return null;
      const vt = q('#video-title', el);
      const n = parseInt(txt(q('#index', el)), 10);
      return {
        id, a, href: u.pathname + u.search,
        title: ((vt && vt.getAttribute('title')) || txt(vt)).trim(),
        channel: txt(q('#byline', el)),
        dur: qa('ytd-thumbnail-overlay-time-status-renderer #text, .badge-shape-wiz__text', el).map(txt).find((t) => DUR.test(t)) || '',
        n: Number.isFinite(n) ? n : i + 1,
        cur: id === vid
      };
    }).filter(Boolean);
    const title = txt(q('h3.title, #header-contents .title, .title', best.p)) || 'Playlist';
    return { list, title, listId };
  }

  /* ---------- navigation helpers ---------- */
  function sameTarget(t) {
    if (t.pathname === '/watch') {
      return location.pathname === '/watch' &&
        new URLSearchParams(location.search).get('v') === t.searchParams.get('v');
    }
    return location.pathname === t.pathname;
  }
  function go(href, id) {
    let t;
    try { t = new URL(href, location.origin); } catch (e) { return; }
    let nat = id ? natives.get(id) : null;
    if (!nat && !id) {
      nat = qa('a[href="' + t.pathname + t.search + '"]').find((a) => !a.closest('#atv-nav, #atv-home, #atv-side, #atv-ui'));
    }
    if (nat && nat.isConnected) nat.click();
    else window.postMessage({ atvNav: t.pathname + t.search }, location.origin);
    // fallback if YouTube's own handler didn't navigate
    setTimeout(() => { if (!sameTarget(t)) location.assign(t.href); }, 3500);
  }
  function onCardClick(e) {
    const a = e.target.closest('a[data-id], a[data-go]');
    if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closePanels();
    go(a.getAttribute('href'), a.dataset.id || '');
  }


  function ytLogo() {
    const NS = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 28 20'); s.setAttribute('width', '30'); s.setAttribute('height', '21');
    const r = document.createElementNS(NS, 'path');
    r.setAttribute('d', 'M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9z');
    r.setAttribute('fill', '#FF0033');
    const t = document.createElementNS(NS, 'path');
    t.setAttribute('d', 'M11.2 14.3 18.5 10l-7.3-4.3z'); t.setAttribute('fill', '#fff');
    s.append(r, t);
    return s;
  }

  function avatarEl(src, name, cls) {
    if (src) return h('img', { class: cls, src, alt: '', decoding: 'async' });
    return h('span', { class: cls + ' atv-av-fb', text: (name || '?').trim().charAt(0).toUpperCase() });
  }

  /* ---------- shared UI: cards + rows ---------- */
  function card(it) {
    const poster = h('div', { class: 'atv-poster' },
      h('img', { src: ytimg(it.id), alt: '', loading: 'lazy', decoding: 'async' }),
      it.dur && h('span', { class: 'atv-dur' + (it.prog ? ' up' : ''), text: it.dur }),
      it.prog > 0 && h('span', { class: 'atv-prog' }, h('i', { style: 'transform:scaleX(' + Math.min(100, it.prog) / 100 + ')' })));
    return h('a', { class: 'atv-card', href: it.href, 'data-id': it.id, 'data-prog': it.prog ? '1' : null, title: it.title },
      poster,
      h('div', { class: 'atv-title', dir: 'auto', text: it.title }),
      h('div', { class: 'atv-sub', dir: 'auto', text: [it.channel, it.meta].filter(Boolean).join(' · ') }));
  }

  function arrows(track) {
    const by = (dir) => () => track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: reduceMotion() ? 'auto' : 'smooth' });
    return [
      h('button', { class: 'atv-arrow l', 'aria-label': 'Scroll left', onclick: by(-1) }, svg(ICON.left, 24)),
      h('button', { class: 'atv-arrow r', 'aria-label': 'Scroll right', onclick: by(1) }, svg(ICON.right, 24))
    ];
  }

  function row(title, list) {
    if (!list || !list.length) return null;
    const track = h('div', { class: 'atv-track' }, list.map(card));
    return h('section', { class: 'atv-row' }, h('h2', { dir: 'auto', text: title }), h('div', { class: 'atv-trackwrap' }, track, arrows(track)));
  }

  /* ---------- top pill navigation ---------- */
  /* ---------- subscriptions feed (fetched in the background, cached) ---------- */
  const tx = (x) => !x ? '' : (x.simpleText || (x.runs || []).map((r) => r.text).join('') || x.content || '');
  const absUrl = (u) => !u ? '' : (u.startsWith('//') ? 'https:' + u : u);
  function deepFind(o, key, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 40) return undefined;
    if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
    for (const k in o) { const r = deepFind(o[k], key, depth + 1); if (r !== undefined) return r; }
    return undefined;
  }
  function deepAll(o, key, out = [], depth = 0) {
    if (!o || typeof o !== 'object' || depth > 40) return out;
    if (Object.prototype.hasOwnProperty.call(o, key)) out.push(o[key]);
    for (const k in o) deepAll(o[k], key, out, depth + 1);
    return out;
  }
  // /channel/UC… lets the page-world helper open channels without a full reload
  const chLink = (be) => !be ? '' : (be.browseId && /^UC/.test(be.browseId) ? '/channel/' + be.browseId : (be.canonicalBaseUrl || ''));
  function fromVR(v) {
    if (!v || !v.videoId || v.upcomingEventData) return null;
    if (v.navigationEndpoint && v.navigationEndpoint.reelWatchEndpoint) return null;
    const own = v.ownerText || v.shortBylineText || v.longBylineText;
    const run = own && own.runs && own.runs[0];
    const ov = (v.thumbnailOverlays || []).find((o) => o.thumbnailOverlayResumePlaybackRenderer);
    const thumbs = deepFind(v.channelThumbnailSupportedRenderers || v.channelThumbnail || {}, 'thumbnails') || [];
    return {
      id: v.videoId, href: '/watch?v=' + v.videoId, title: tx(v.title), channel: tx(own),
      chHref: chLink(run && run.navigationEndpoint && run.navigationEndpoint.browseEndpoint),
      meta: [tx(v.shortViewCountText || v.viewCountText), tx(v.publishedTimeText)].filter(Boolean).join(' · '),
      dur: tx(v.lengthText), prog: ov ? ov.thumbnailOverlayResumePlaybackRenderer.percentDurationWatched || 0 : 0,
      avatar: absUrl(thumbs[0] && thumbs[0].url)
    };
  }
  function fromLVM(l) {
    if (!l || !l.contentId || (l.contentType && !/VIDEO/.test(l.contentType))) return null;
    const md = l.metadata && l.metadata.lockupMetadataViewModel;
    if (!md) return null;
    const rows = deepFind(md, 'metadataRows') || [];
    const parts = rows.map((r) => (r.metadataParts || []).map((p) => p.text && p.text.content).filter(Boolean));
    const srcs = deepFind(md.image || {}, 'sources') || [];
    const durs = deepAll(l.contentImage || {}, 'thumbnailBadgeViewModel').map((b) => b && b.text).filter((t) => t && DUR.test(t));
    const pb = deepFind(l.contentImage || {}, 'thumbnailOverlayProgressBarViewModel');
    const be = deepFind(md.image || {}, 'browseEndpoint');
    return {
      id: l.contentId, href: '/watch?v=' + l.contentId, title: tx(md.title), channel: (parts[0] || [])[0] || '',
      chHref: chLink(be), meta: (parts[1] || []).join(' · '), dur: durs[0] || '',
      prog: pb ? pb.startPercent || 0 : 0, avatar: absUrl(srcs[0] && srcs[0].url)
    };
  }
  function walkVideos(o, out, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 60) return;
    if (Array.isArray(o)) { for (const x of o) walkVideos(x, out, depth + 1); return; }
    const one = o.videoRenderer || o.gridVideoRenderer;
    if (one) { const c = fromVR(one); if (c) out.push(c); return; }
    if (o.lockupViewModel) { const c = fromLVM(o.lockupViewModel); if (c) out.push(c); return; }
    for (const k in o) walkVideos(o[k], out, depth + 1);
  }
  St.subs = []; St.subsV = 0; St.subsAt = 0; St.acct = ''; St.fy = [];
  function storeGet(keys) { return new Promise((res) => { try { chrome.storage.local.get(keys, (v) => res(v || {})); } catch (e) { res({}); } }); }
  function storeSet(obj) { try { chrome.storage.local.set(obj); } catch (e) { /* ignore */ } }
  const cacheReady = storeGet(['subsCache', 'fyCache']).then((v) => {
    if (v.subsCache && v.subsCache.items && !St.subs.length) {
      St.subs = v.subsCache.items; St.subsAt = v.subsCache.t || 0; St.acct = v.subsCache.acct || ''; St.subsV++;
    }
    if (v.fyCache && v.fyCache.length) St.fy = v.fyCache;
  });
  let subsLoading = false;
  async function loadSubs(force) {
    if (subsLoading || (!force && Date.now() - St.subsAt < 3 * 60 * 1000)) return;
    subsLoading = true;
    try {
      const r = await fetch('/feed/subscriptions', { credentials: 'include' });
      const html = await r.text();
      const m = html.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
      if (!m) return;
      const data = JSON.parse(m[1]);
      const out = []; const seen = new Set();
      const all = []; walkVideos(data, all);
      for (const c of all) if (c.title && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
      const tb = deepFind(data, 'topbarMenuButtonRenderer');
      const av = tb && tb.avatar && tb.avatar.thumbnails;
      St.acct = absUrl(av && av.length ? av[av.length - 1].url : '') || St.acct;
      if (out.length) {
        St.subs = out; St.subsAt = Date.now(); St.subsV++;
        storeSet({ subsCache: { t: St.subsAt, items: out.slice(0, 120), acct: St.acct } });
      }
    } catch (e) { console.debug('[Cinema Style] subs', e); } finally { subsLoading = false; }
  }
  cacheReady.then(() => loadSubs(false));

  /* ---------- top pill navigation + search suggestions + account ---------- */
  const NAV = [['Subscriptions', '/feed/subscriptions'], ['Playlists', '/feed/playlists'], ['History', '/feed/history']];
  const ICON_CLOCK = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z';
  let searchHist = [];
  storeGet(['searchHist']).then((v) => { searchHist = v.searchHist || []; });
  function pushHist(qs) {
    searchHist = [qs, ...searchHist.filter((x) => x.toLowerCase() !== qs.toLowerCase())].slice(0, 25);
    storeSet({ searchHist });
  }
  function fetchSuggest(qs) {
    return new Promise((res) => {
      try { chrome.runtime.sendMessage({ type: 'suggest', q: qs, hl: document.documentElement.lang || 'en' }, (r) => { void chrome.runtime.lastError; res(Array.isArray(r) ? r : []); }); }
      catch (e) { res([]); }
    });
  }
  function doSearch(qs) {
    qs = (qs || '').trim();
    if (!qs) return;
    pushHist(qs);
    closeSearch();
    go('/results?search_query=' + encodeURIComponent(qs));
  }
  function closeSearch() {
    const nav = q('#atv-nav');
    if (!nav) return;
    nav.classList.remove('searching');
    const s = q('#atv-suggest'); if (s) s.replaceChildren();
    const i = q('input', nav); if (i) i.blur();
  }

  const MENU = [
    ['Your channel', 'https://www.youtube.com/profile'],
    ['Switch account', 'https://www.youtube.com/channel_switcher'],
    ['YouTube Studio', 'https://studio.youtube.com/'],
    ['Google Account', 'https://myaccount.google.com/'],
    ['Settings', 'https://www.youtube.com/account'],
    ['Sign out', 'https://www.youtube.com/logout']
  ];

  function ensureNav() {
    if (q('#atv-nav')) return;
    const input = h('input', { type: 'search', placeholder: 'Search YouTube', 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false', dir: 'auto' });
    const btn = h('button', { class: 'atv-nav-search', 'aria-label': 'Search' }, svg(ICON.search, 20));
    const logo = h('a', { class: 'atv-logo', href: '/', 'data-nav': '/', 'aria-label': 'YouTube home' }, ytLogo());
    const acctBtn = h('button', { class: 'atv-acct', 'aria-label': 'Account' }, h('span', { class: 'atv-acct-img' }));
    const menu = h('div', { id: 'atv-menu' }, MENU.map(([label, href]) => h('a', { href, class: label === 'Sign out' ? 'warn' : null, text: label })));
    const sug = h('div', { id: 'atv-suggest', role: 'listbox' });
    const nav = h('nav', { id: 'atv-nav' }, logo,
      NAV.map(([label, href]) => h('a', { href, 'data-nav': href, text: label })), input, btn, acctBtn, sug, menu);
    let active = -1; let reqId = 0; let deb = 0;
    const opts = () => qa('.atv-sg', sug);
    const setActive = (i) => { const o = opts(); active = o.length ? (i + o.length) % o.length : -1; o.forEach((x, n) => x.classList.toggle('on', n === active)); };
    function sgItem(icon, label, act, extra) {
      const it = h('button', { class: 'atv-sg', type: 'button', role: 'option' }, icon, h('span', { dir: 'auto', text: label }), extra);
      it.addEventListener('mousedown', (e) => e.preventDefault());
      it.addEventListener('click', act);
      return it;
    }
    async function render() {
      const v = input.value.trim();
      const my = ++reqId;
      const lv = v.toLowerCase();
      const kids = [];
      if (!v) {
        if (searchHist.length) {
          kids.push(h('div', { class: 'atv-sg-head' }, h('span', { text: 'Recent searches' }),
            h('button', { class: 'atv-sg-clear', type: 'button', text: 'Clear', onmousedown: (e) => e.preventDefault(), onclick: () => { searchHist = []; storeSet({ searchHist }); render(); } })));
          searchHist.slice(0, 8).forEach((s) => kids.push(sgItem(svg(ICON_CLOCK, 18), s, () => doSearch(s))));
        }
        sug.replaceChildren(...kids); active = -1; return;
      }
      const chans = new Map();
      for (const it of St.subs) if (it.channel && it.channel.toLowerCase().includes(lv) && !chans.has(it.channel)) chans.set(it.channel, it);
      [...chans.values()].slice(0, 3).forEach((it) => kids.push(sgItem(avatarEl(it.avatar, it.channel, 'atv-sg-av'), it.channel,
        () => { closeSearch(); if (it.chHref) go(it.chHref); else doSearch(it.channel); }, h('small', { text: 'Channel' }))));
      const hist = searchHist.filter((s) => s.toLowerCase().includes(lv)).slice(0, 3);
      hist.forEach((s) => kids.push(sgItem(svg(ICON_CLOCK, 18), s, () => doSearch(s))));
      sug.replaceChildren(...kids); active = -1;
      const remote = await fetchSuggest(v);
      if (my !== reqId) return;
      remote.filter((s) => !hist.some((x) => x.toLowerCase() === String(s).toLowerCase())).slice(0, 8)
        .forEach((s) => kids.push(sgItem(svg(ICON.search, 18), String(s), () => doSearch(String(s)))));
      sug.replaceChildren(...kids); active = -1;
    }
    const openSearch = () => { nav.classList.add('searching'); nav.classList.remove('menu'); input.focus(); render(); };
    btn.addEventListener('click', () => {
      if (nav.classList.contains('searching')) { if (input.value.trim()) doSearch(input.value); else closeSearch(); return; }
      openSearch();
    });
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(render, 90); });
    input.addEventListener('focus', () => { if (!nav.classList.contains('searching')) openSearch(); });
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input && !input.value.trim()) nav.classList.remove('searching'); sug.replaceChildren(); }, 150));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter') { const o = opts()[active]; if (o) o.click(); else doSearch(input.value); }
      else if (e.key === 'Escape') closeSearch();
    });
    acctBtn.addEventListener('click', (e) => { e.stopPropagation(); nav.classList.toggle('menu'); });
    document.addEventListener('click', (e) => { if (!nav.contains(e.target)) nav.classList.remove('menu'); });
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && !root.classList.contains('atv-watch') && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '') && !(document.activeElement || {}).isContentEditable) { e.preventDefault(); openSearch(); }
    }, true);
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-nav]');
      if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      closeSearch();
      go(a.dataset.nav);
    });
    document.body.append(nav);
  }
  function updateNav() {
    const nav = q('#atv-nav');
    if (!nav) return;
    const p = location.pathname;
    qa('a[data-nav]', nav).forEach((a) => { const t = a.dataset.nav; a.classList.toggle('on', t === '/' ? p === '/' : p.startsWith(t)); });
    const input = q('input', nav);
    if (p === '/results' && input && document.activeElement !== input && !input.value) {
      input.value = new URLSearchParams(location.search).get('search_query') || '';
    }
    const domAv = qa('ytd-masthead #avatar-btn img, ytd-topbar-menu-button-renderer #avatar-btn img').map((i) => i.getAttribute('src') || '').find((s) => /^https?:/.test(s));
    const src = domAv || St.acct;
    const slot = q('.atv-acct-img', nav);
    if (slot && src && slot.dataset.src !== src) { slot.dataset.src = src; slot.replaceChildren(h('img', { src, alt: '', decoding: 'async' })); }
  }

  /* ---------- HOME ---------- */
  function ensureHome() {
    let el = q('#atv-home');
    if (el) return el;
    el = h('div', { id: 'atv-home' }, h('div', { class: 'atv-loading', text: 'Loading…' }));
    el.addEventListener('click', onCardClick);
    let ticking = false;
    el.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 1400) requestMore();
      });
    }, { passive: true });
    // hover preview, like YouTube's own inline playback
    let pvT = 0; let pvCard = null;
    const stopPv = () => { clearTimeout(pvT); if (pvCard) { const f = q('.atv-preview', pvCard); if (f) f.remove(); pvCard.classList.remove('previewing'); } pvCard = null; };
    el.addEventListener('mouseover', (e) => {
      const c = e.target.closest('.atv-card');
      if (c === pvCard) return;
      stopPv();
      if (!c) return;
      pvCard = c;
      pvT = setTimeout(() => {
        if (pvCard !== c || reduceMotion() || !S.previews || document.hidden) return;
        const id = c.dataset.id;
        const f = h('iframe', {
          class: 'atv-preview', tabindex: '-1', allow: 'autoplay; encrypted-media', referrerpolicy: 'strict-origin-when-cross-origin',
          src: 'https://www.youtube.com/embed/' + id + '?autoplay=1&mute=1&controls=0&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&start=' + (c.dataset.prog ? 0 : 20)
        });
        f.addEventListener('load', () => setTimeout(() => { if (pvCard === c) c.classList.add('previewing'); }, 450));
        q('.atv-poster', c).append(f);
      }, 800);
    });
    el.addEventListener('mouseleave', stopPv);
    el.addEventListener('scroll', stopPv, { passive: true });
    document.body.append(el);
    return el;
  }

  function requestMore() {
    const now = Date.now();
    if (now - St.loadAt < 1500) return;
    St.loadAt = now;
    window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function buildHero(list) {
    let cur = 0;
    const slides = list.map((it, n) => {
      const img = h('img', { class: 'atv-slide-img', alt: '', src: ytimg(it.id, n === 0 ? 'maxresdefault' : 'hqdefault'), decoding: 'async', fetchpriority: n === 0 ? 'high' : 'low' });
      if (n === 0) {
        img.addEventListener('error', () => { if (!img.dataset.fb) { img.dataset.fb = '1'; img.src = ytimg(it.id, 'hqdefault'); } });
        img.addEventListener('load', () => { if (img.naturalWidth && img.naturalWidth < 400 && !img.dataset.fb) { img.dataset.fb = '1'; img.src = ytimg(it.id, 'hqdefault'); } });
      } else {
        // upgrade to the sharp image once idle so the first paint stays fast
        setTimeout(() => { const hi = new Image(); hi.onload = () => { if (hi.naturalWidth >= 400) img.src = hi.src; }; hi.src = ytimg(it.id, 'maxresdefault'); }, 1200 + n * 300);
      }
      const chan = h(it.chHref ? 'a' : 'div', { class: 'atv-hero-ch', href: it.chHref || null, 'data-go': it.chHref ? '1' : null },
        avatarEl(it.avatar, it.channel, 'atv-av'), h('span', { dir: 'auto', text: it.channel || 'YouTube' }));
      return h('div', { class: 'atv-slide' },
        img,
        h('div', { class: 'atv-slide-body' },
          chan,
          h('h1', { class: 'atv-h1', dir: 'auto', text: it.title }),
          h('div', { class: 'atv-meta' },
            it.meta && h('span', { dir: 'auto', text: it.meta }),
            it.dur && h('span', { class: 'atv-tag', text: it.dur })),
          h('div', { class: 'atv-actions' },
            h('a', { class: 'atv-btn atv-btn-main', href: it.href, 'data-id': it.id }, svg(ICON.play, 22), it.prog ? 'Resume' : 'Play'),
            it.chHref && h('a', { class: 'atv-btn atv-btn-ghost', href: it.chHref, 'data-go': '1' }, 'View channel'))));
    });
    const dots = list.map((_, i) => h('button', { class: 'atv-dot', 'aria-label': 'Slide ' + (i + 1), onclick: () => show(i) }));
    function show(i) {
      cur = i;
      slides.forEach((s, n) => s.classList.toggle('on', n === i));
      dots.forEach((d, n) => d.classList.toggle('on', n === i));
    }
    show(0);
    const hero = h('section', { class: 'atv-hero' }, slides, h('div', { class: 'atv-dots' }, dots));
    clearInterval(St.heroTimer);
    if (list.length > 1 && !reduceMotion()) {
      St.heroTimer = setInterval(() => {
        if (!hero.isConnected) return clearInterval(St.heroTimer);
        const home = q('#atv-home');
        if (document.hidden || !root.classList.contains('atv-home') || hero.matches(':hover') || (home && home.scrollTop > 300)) return;
        show((cur + 1) % list.length);
      }, 9000);
    }
    return hero;
  }

  function renderHome(forYou) {
    const el = ensureHome();
    const subs = St.subs || [];
    const fresh = subs.filter((i) => !i.prog);
    const heroList = (fresh.length ? fresh : forYou).slice(0, 6);
    const frag = document.createDocumentFragment();
    if (heroList.length) frag.append(buildHero(heroList));
    const rows = h('div', { class: 'atv-rows' });
    add(rows, row('New videos', fresh.slice(0, 24)));
    const seenCw = new Set(); const cw = [];
    for (const it of [...forYou, ...subs]) if (it.prog > 3 && it.prog < 95 && !seenCw.has(it.id)) { seenCw.add(it.id); cw.push(it); }
    add(rows, row('Continue watching', cw.slice(0, 20)));
    const fy = forYou.slice();
    add(rows, row('For you', fy.splice(0, 12)));
    const groups = new Map();
    for (const it of subs) if (it.channel) { if (!groups.has(it.channel)) groups.set(it.channel, []); groups.get(it.channel).push(it); }
    const chRows = [...groups.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const fyChunks = chunk(fy, 12);
    const n = Math.max(chRows.length, fyChunks.length);
    for (let i = 0; i < n; i++) {
      if (chRows[i]) add(rows, row(chRows[i][0], chRows[i][1]));
      if (fyChunks[i]) add(rows, row('More for you', fyChunks[i]));
    }
    frag.append(rows);
    el.replaceChildren(frag);
    el.scrollTop = 0;
  }

  let fySaveAt = 0;
  function homeTick(force) {
    const el = ensureHome();
    const H = St.home;
    const rawN = qa('ytd-rich-grid-renderer ytd-rich-item-renderer').length;
    const first = q('ytd-rich-grid-renderer ytd-rich-item-renderer a[href*="/watch?v="]');
    const sig = rawN + '|' + (first ? first.getAttribute('href') : '') + '|' + St.subsV;
    if (!force && H.key && sig === H.sig) return;
    H.sig = sig;

    const live = readHome();
    live.forEach((i) => natives.set(i.id, i.a));
    if (live.length >= 8 && Date.now() - fySaveAt > 20000) {
      fySaveAt = Date.now();
      storeSet({ fyCache: live.slice(0, 40).map(({ a, ...rest }) => rest) });
    }
    const forYou = live.length >= 6 ? live : (St.fy.length ? St.fy : live);
    if (!forYou.length && !St.subs.length) return;
    const key = (forYou[0] ? forYou[0].id : '') + '|' + St.subsV;
    if (force || key !== H.key) {
      if (H.key && el.scrollTop > 250 && !force) { H.key = key; return; } // don't yank the page while browsing
      H.key = key; H.n = forYou.length; H.seen = new Set(forYou.map((i) => i.id));
      renderHome(forYou);
    } else if (live.length > H.n) {
      const fresh = live.filter((i) => !H.seen.has(i.id));
      fresh.forEach((i) => H.seen.add(i.id));
      H.n = live.length;
      const rows = q('#atv-home .atv-rows');
      if (rows) chunk(fresh, 12).forEach((c) => add(rows, row('More for you', c)));
    }
  }
  /* ---------- WATCH: full-screen TV player ---------- */
  const PANELS = ['info', 'comments', 'next'];
  function openPanel(name) {
    const was = root.classList.contains('atv-panel-' + name);
    closePanels();
    if (was) return;
    root.classList.add('atv-panel', 'atv-panel-' + name);
    qa('#atv-ui [data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === name));
    const below = q('ytd-watch-flexy #below');
    if (below && name === 'info') below.scrollTop = 0;
    if (below && name === 'comments') {
      const c = q('ytd-comments#comments, #comments', below);
      if (c) below.scrollTop += c.getBoundingClientRect().top - below.getBoundingClientRect().top - 76;
    }
    if (name === 'next') {
      const cur = q('#atv-side .atv-ep.now');
      if (cur) cur.scrollIntoView({ block: 'center' });
    }
  }
  function closePanels() {
    root.classList.remove('atv-panel', ...PANELS.map((p) => 'atv-panel-' + p));
    qa('#atv-ui [data-panel]').forEach((b) => b.classList.remove('on'));
  }

  let idleT = 0;
  function wake() {
    root.classList.add('atv-awake');
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      const v = q('#movie_player video');
      const ui = q('#atv-ui');
      if ((v && v.paused) || (ui && ui.matches(':hover'))) return wake();
      root.classList.remove('atv-awake');
    }, 2800);
  }

  function ensureUI() {
    let ui = q('#atv-ui');
    if (ui) return ui;
    const btn = (panel, icon, label) => h('button', { class: 'atv-ctl', 'data-panel': panel, 'aria-label': label },
      svg(icon, 20), h('span', { text: label }), panel === 'comments' && h('em', { class: 'atv-ccount' }));
    ui = h('div', { id: 'atv-ui' },
      h('div', { class: 'atv-ui-left' },
        h('button', { class: 'atv-ctl atv-round', 'aria-label': 'Back', 'data-act': 'back' }, svg(ICON.back, 22)),
        h('a', { class: 'atv-nowcard', href: '#', 'data-act': 'channel' },
          h('span', { class: 'atv-av-slot' }),
          h('span', { class: 'atv-nowtext' }, h('b', { dir: 'auto' }), h('small', { dir: 'auto' })))),
      h('div', { class: 'atv-ui-right' },
        btn('info', ICON.info, 'Details'),
        btn('comments', ICON.chat, 'Comments'),
        btn('next', ICON.list, 'Up next')));
    ui.addEventListener('click', (e) => {
      const b = e.target.closest('[data-panel], [data-act]');
      if (!b) return;
      e.preventDefault();
      b.blur();
      if (b.dataset.panel) return openPanel(b.dataset.panel);
      if (b.dataset.act === 'back') {
        closePanels();
        if (history.length > 1) history.back(); else go('/');
      }
      if (b.dataset.act === 'channel') { const href = b.getAttribute('href'); if (href && href !== '#') { closePanels(); go(href); } }
    });
    const side = h('aside', { id: 'atv-side' }, h('div', { class: 'atv-side-body' }, h('div', { class: 'atv-loading small', text: 'Loading…' })));
    side.addEventListener('click', onCardClick);
    const scrim = h('div', { id: 'atv-scrim', onclick: closePanels });
    document.body.append(scrim, side, ui);
    return ui;
  }

  function stage() {
    const mp = q('ytd-watch-flexy #movie_player');
    if (!mp) return;
    const box = mp.closest('#full-bleed-container, #player-full-bleed-container, #player-container-outer');
    if (!box || box.classList.contains('atv-stage')) return;
    qa('.atv-stage').forEach((n) => n.classList.remove('atv-stage'));
    box.classList.add('atv-stage');
    [0, 250, 900].forEach((t) => setTimeout(() => window.dispatchEvent(new Event('resize')), t));
  }

  function updateNow(vid) {
    const ui = q('#atv-ui');
    if (!ui) return;
    const meta = q('ytd-watch-metadata');
    const title = txt(q('#title h1, h1.ytd-watch-metadata', meta || document)) || document.title.replace(/ - YouTube$/, '');
    const chA = q('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a, #owner a[href^="/@"]');
    const chName = txt(chA);
    const avSrc = (q('#owner #avatar img, ytd-video-owner-renderer #avatar img') || {}).src || '';
    const key = [vid, title, chName, avSrc].join('|');
    if (ui.dataset.k === key) return;
    ui.dataset.k = key;
    const card = q('.atv-nowcard', ui);
    card.setAttribute('href', chA ? chA.getAttribute('href') : '#');
    q('b', card).textContent = title;
    q('small', card).textContent = chName;
    q('.atv-av-slot', card).replaceChildren(avatarEl(/ggpht|ytimg|googleusercontent/.test(avSrc) ? avSrc : '', chName, 'atv-av'));
    const cnt = txt(q('ytd-comments-header-renderer #count .count-text span, ytd-comments-header-renderer #count'));
    const n = (cnt.match(/[\d.,]+[KkMm]?/) || [''])[0];
    q('.atv-ccount', ui).textContent = n;
  }

  function episodes(pl, vid) {
    const mix = /^RD/.test(pl.listId);
    const cards = pl.list.map((e) => {
      natives.set(e.id, e.a);
      const now = e.id === vid;
      return h('a', { class: 'atv-li atv-ep' + (now ? ' now' : ''), href: e.href, 'data-id': e.id, title: e.title },
        h('div', { class: 'atv-poster' },
          h('img', { src: ytimg(e.id), alt: '', loading: 'lazy', decoding: 'async' }),
          now && h('span', { class: 'atv-nowtag', text: 'Playing' }),
          e.dur && h('span', { class: 'atv-dur', text: e.dur })),
        h('div', { class: 'atv-li-text' },
          h('div', { class: 'atv-epnum', text: (mix ? 'Video ' : 'Episode ') + e.n }),
          h('div', { class: 'atv-title', dir: 'auto', text: e.title }),
          h('div', { class: 'atv-sub', dir: 'auto', text: e.channel })));
    });
    return h('section', { class: 'atv-sec' },
      h('div', { class: 'atv-ephead' },
        h('h2', { dir: 'auto', text: pl.title }),
        h('span', { class: 'atv-count', text: pl.list.length + (mix ? ' videos' : ' episodes') })),
      h('div', { class: 'atv-list' }, cards));
  }

  function listItem(it) {
    return h('a', { class: 'atv-li', href: it.href, 'data-id': it.id, title: it.title },
      h('div', { class: 'atv-poster' },
        h('img', { src: ytimg(it.id), alt: '', loading: 'lazy', decoding: 'async' }),
        it.dur && h('span', { class: 'atv-dur', text: it.dur })),
      h('div', { class: 'atv-li-text' },
        h('div', { class: 'atv-title', dir: 'auto', text: it.title }),
        h('div', { class: 'atv-sub', dir: 'auto', text: it.channel }),
        it.meta && h('div', { class: 'atv-sub', dir: 'auto', text: it.meta })));
  }

  /* Netflix-style "up next" card in the last seconds of a video */
  St.next = null; St.nextOff = '';
  function ensureNextCard() {
    let c = q('#atv-next');
    if (c) return c;
    c = h('div', { id: 'atv-next', role: 'dialog', 'aria-label': 'Up next' },
      h('img', { class: 'atv-next-img', alt: '' }),
      h('div', { class: 'atv-next-body' },
        h('small', { class: 'atv-next-in' }),
        h('b', { class: 'atv-next-title', dir: 'auto' }),
        h('div', { class: 'atv-next-actions' },
          h('button', { class: 'atv-next-play', 'data-a': 'play' }, svg(ICON.play, 18), 'Play now'),
          h('button', { class: 'atv-next-x', 'data-a': 'x', text: 'Cancel' }))),
      h('i', { class: 'atv-next-bar' }));
    c.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      b.blur();
      const vid = new URLSearchParams(location.search).get('v') || '';
      c.classList.remove('on');
      if (b.dataset.a === 'x') { St.nextOff = vid; return; }
      if (St.next) { St.nextOff = vid; go(St.next.href, St.next.id); }
    });
    document.body.append(c);
    return c;
  }
  document.addEventListener('timeupdate', (e) => {
    const v = e.target;
    if (!root.classList.contains('atv-watch') || !v || !v.closest || !v.closest('#movie_player')) return;
    const c = ensureNextCard();
    const vid = new URLSearchParams(location.search).get('v') || '';
    const rem = v.duration - v.currentTime;
    const show = St.next && St.next.id !== vid && isFinite(v.duration) && v.duration > 60 && rem <= 12 && rem > 0.4 && St.nextOff !== vid && !document.fullscreenElement;
    if (!show) { if (c.classList.contains('on')) c.classList.remove('on'); return; }
    if (c.dataset.id !== St.next.id) {
      c.dataset.id = St.next.id;
      q('.atv-next-img', c).src = ytimg(St.next.id, 'mqdefault');
      q('.atv-next-title', c).textContent = St.next.title;
    }
    const s = Math.ceil(rem);
    if (c.dataset.s !== String(s)) { c.dataset.s = String(s); q('.atv-next-in', c).textContent = 'Up next in ' + s + 's'; }
    q('.atv-next-bar', c).style.transform = 'scaleX(' + Math.max(0, Math.min(1, 1 - rem / 12)).toFixed(3) + ')';
    if (!c.classList.contains('on')) c.classList.add('on');
  }, true);

  function watchTick() {
    const vid = new URLSearchParams(location.search).get('v') || '';
    ensureUI();
    stage();
    updateNow(vid);
    const flexy = q('ytd-watch-flexy');
    if (!flexy) return;
    const sig = [vid, qa('ytd-playlist-panel-video-renderer', flexy).length, qa(REL_SEL, flexy).length].join('|');
    if (sig === St.watchSig) return;
    const pl = readPlaylist(flexy, vid);
    const rel = readRelated(flexy, vid);
    rel.forEach((r) => natives.set(r.id, r.a));
    if (!pl.list.length && !rel.length) return;
    St.watchSig = sig;
    const ci = pl.list.findIndex((e) => e.id === vid);
    St.next = (ci >= 0 && pl.list[ci + 1]) || rel[0] || null;
    const kids = [];
    if (pl.list.length > 1) kids.push(episodes(pl, vid));
    if (rel.length) kids.push(h('section', { class: 'atv-sec' }, h('h2', { text: 'Up next' }), h('div', { class: 'atv-list' }, rel.slice(0, 30).map(listItem))));
    q('#atv-side .atv-side-body').replaceChildren(...kids);
  }

  /* ---------- lifecycle ---------- */
  function teardown() {
    clearInterval(St.heroTimer);
    ['#atv-home', '#atv-nav', '#atv-ui', '#atv-side', '#atv-scrim', '#atv-next'].forEach((s) => { const n = q(s); if (n) n.remove(); });
    qa('.atv-stage').forEach((n) => n.classList.remove('atv-stage'));
    closePanels();
    root.classList.remove('atv-home', 'atv-watch', 'atv-awake', 'atv-scrolled');
    St.home = { key: '', sig: '', n: 0, seen: new Set(), last: -1 };
    St.watchSig = '';
  }

  let lastPath = '';
  let timer = 0;
  function tick(force) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) { clearInterval(timer); teardown(); root.classList.remove('atv', 'atv-classic'); return; }
      if (!document.body) return;
      if (!S.enabled) { teardown(); return; }
      const t = pageType();
      const path = location.pathname + location.search;
      if (path !== lastPath) {
        const wasWatch = lastPath.startsWith('/watch');
        lastPath = path;
        closePanels();
        if (wasWatch) [0, 300].forEach((d) => setTimeout(() => window.dispatchEvent(new Event('resize')), d));
      }
      root.classList.toggle('atv-home', t === 'home');
      root.classList.toggle('atv-watch', t === 'watch');
      ensureNav();
      updateNav();
      if (t === 'home') { homeTick(force === true); loadSubs(false); }
      if (t === 'watch') watchTick();
      else { St.watchSig = ''; qa('.atv-stage').forEach((n) => n.classList.remove('atv-stage')); }
    } catch (e) {
      console.debug('[Cinema Style]', e);
    }
  }

  timer = setInterval(tick, 400);
  /* TV-style remote navigation on the home screen: arrow keys move between posters */
  window.addEventListener('keydown', (e) => {
    if (!root.classList.contains('atv-home') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (!/^Arrow/.test(e.key)) return;
    const ae = document.activeElement;
    if (ae && (/INPUT|TEXTAREA|SELECT/.test(ae.tagName) || ae.isContentEditable)) return;
    const home = q('#atv-home'); if (!home) return;
    const tracks = qa('.atv-track', home);
    const cur = ae && ae.closest ? ae.closest('#atv-home .atv-card') : null;
    const heroBtn = q('.atv-slide.on .atv-btn-main', home);
    let target = null;
    const nearest = (track, x) => { let best = null, bd = 1e9; for (const c of track.children) { const d = Math.abs(c.getBoundingClientRect().left - x); if (d < bd) { bd = d; best = c; } } return best; };
    if (!cur) {
      if (ae === heroBtn && e.key === 'ArrowDown' && tracks[0]) target = nearest(tracks[0], 0);
      else if (ae !== heroBtn) target = heroBtn || (tracks[0] && tracks[0].firstElementChild);
      else return;
    } else {
      const tr = cur.parentElement; const ti = tracks.indexOf(tr);
      if (e.key === 'ArrowRight') target = cur.nextElementSibling;
      else if (e.key === 'ArrowLeft') target = cur.previousElementSibling;
      else {
        const nt = tracks[ti + (e.key === 'ArrowDown' ? 1 : -1)];
        target = nt ? nearest(nt, cur.getBoundingClientRect().left) : (e.key === 'ArrowUp' ? heroBtn : null);
      }
    }
    e.preventDefault();
    if (!target) return;
    target.focus({ preventScroll: true });
    if (target === heroBtn) home.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    else target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }, true);
  try { ['https://i.ytimg.com', 'https://yt3.ggpht.com'].forEach((u) => { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = u; (document.head || document.documentElement).append(l); }); } catch (e) { /* ignore */ }
  try {
    loadSettings();
    chrome.storage.onChanged.addListener(loadSettings);
  } catch (e) { /* ignore */ }
  ['yt-navigate-finish', 'yt-page-data-updated', 'popstate'].forEach((ev) => {
    window.addEventListener(ev, () => tick(false));
  });
  let mmQueued = false;
  document.addEventListener('mousemove', () => {
    if (mmQueued || !root.classList.contains('atv-watch')) return;
    mmQueued = true;
    requestAnimationFrame(() => { mmQueued = false; wake(); });
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (!root.classList.contains('atv-watch')) return;
    if (e.key === 'Escape' && root.classList.contains('atv-panel')) { e.stopPropagation(); closePanels(); }
    else wake();
  }, true);
})();
