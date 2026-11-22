(() => {
  if (window.__cinemaShimLoaded) return;
  window.__cinemaShimLoaded = true;

  const listeners = [];
  const makeStorage = (prefix) => ({
    get(keys, cb) {
      const res = {};
      if (typeof keys === 'string') {
        try {
          const v = localStorage.getItem(prefix + keys);
          if (v !== null) res[keys] = JSON.parse(v);
        } catch (e) {}
      } else if (Array.isArray(keys)) {
        for (const k of keys) {
          try {
            const v = localStorage.getItem(prefix + k);
            if (v !== null) res[k] = JSON.parse(v);
          } catch (e) {}
        }
      } else if (keys && typeof keys === 'object') {
        for (const [k, def] of Object.entries(keys)) {
          try {
            const v = localStorage.getItem(prefix + k);
            res[k] = v !== null ? JSON.parse(v) : def;
          } catch (e) {
            res[k] = def;
          }
        }
      }
      if (typeof cb === 'function') setTimeout(() => cb(res), 0);
    },
    set(obj, cb) {
      const changes = {};
      if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
          try {
            const oldRaw = localStorage.getItem(prefix + k);
            const oldValue = oldRaw !== null ? JSON.parse(oldRaw) : undefined;
            localStorage.setItem(prefix + k, JSON.stringify(v));
            changes[k] = { oldValue, newValue: v };
          } catch (e) {}
        }
      }
      if (Object.keys(changes).length) {
        for (const fn of listeners) {
          try { fn(changes, prefix); } catch (e) {}
        }
      }
      if (typeof cb === 'function') setTimeout(cb, 0);
    }
  });

  try {
    if (localStorage.getItem('cinema_sync_previews') === null) {
      localStorage.setItem('cinema_sync_previews', 'false');
    }
  } catch (e) {}

  let cbSeq = 0;
  const pending = new Map();
  window.__cinemaResolveSuggest = (id, list) => {
    const fn = pending.get(id);
    if (fn) {
      pending.delete(id);
      try { fn(Array.isArray(list) ? list : []); } catch (e) {}
    }
  };

  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: 'cinema-style-android',
    lastError: null,
    sendMessage(msg, cb) {
      if (
        msg &&
        msg.type === 'suggest' &&
        msg.q &&
        window.CinemaAndroid &&
        typeof window.CinemaAndroid.fetchSuggestions === 'function'
      ) {
        const id = 'sg_' + (++cbSeq);
        if (typeof cb === 'function') pending.set(id, cb);
        try {
          window.CinemaAndroid.fetchSuggestions(String(msg.q), String(msg.hl || 'en'), id);
        } catch (e) {
          pending.delete(id);
          if (typeof cb === 'function') cb([]);
        }
      } else if (typeof cb === 'function') {
        cb([]);
      }
    }
  };
  window.chrome.storage = {
    sync: makeStorage('cinema_sync_'),
    local: makeStorage('cinema_local_'),
    onChanged: {
      addListener(fn) {
        if (typeof fn === 'function') listeners.push(fn);
      }
    }
  };
})();
