(() => {
  if (window.__cinemaMobileAddonLoaded) return;
  window.__cinemaMobileAddonLoaded = true;

  const SIGNIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F%3Fapp%3Ddesktop';

  function ensureViewport() {
    let vp = document.querySelector('meta[name="viewport"]');
    if (!vp) {
      vp = document.createElement('meta');
      vp.name = 'viewport';
      (document.head || document.documentElement).appendChild(vp);
    }
    vp.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
  }
  ensureViewport();

  let touchWakeTimer = 0;
  function wakeOnTouch() {
    const root = document.documentElement;
    if (!root.classList.contains('atv-watch')) return;
    root.classList.add('atv-awake');
    clearTimeout(touchWakeTimer);
    touchWakeTimer = setTimeout(() => {
      const v = document.querySelector('#movie_player video');
      if (v && v.paused) return;
      if (root.classList.contains('atv-panel')) return;
      root.classList.remove('atv-awake');
    }, 3200);
  }
  document.addEventListener('touchstart', wakeOnTouch, { passive: true });
  document.addEventListener('pointerdown', wakeOnTouch, { passive: true });

  window.__cinemaHandleBack = () => {
    const nav = document.getElementById('atv-nav');
    if (nav && nav.classList.contains('searching')) {
      nav.classList.remove('searching');
      const inp = nav.querySelector('input');
      if (inp) { inp.value = ''; inp.blur(); }
      const sg = document.getElementById('atv-suggest');
      if (sg) sg.replaceChildren();
      return 'handled';
    }
    if (nav && nav.classList.contains('menu')) {
      nav.classList.remove('menu');
      return 'handled';
    }
    if (document.documentElement.classList.contains('atv-panel')) {
      const scrim = document.getElementById('atv-scrim');
      if (scrim) scrim.click();
      return 'handled';
    }
    return 'back';
  };

  function isSignedIn() {
    const hasAvatar = !!document.querySelector('#atv-nav .atv-acct-img img, ytd-masthead #avatar-btn img, ytd-topbar-menu-button-renderer #avatar-btn img');
    if (hasAvatar) return true;
    const hasSignInBtn = !!document.querySelector('ytd-masthead a[href*="ServiceLogin"], ytd-masthead a[href*="accounts.google.com"]');
    if (hasSignInBtn) return false;
    return null;
  }

  let emptyTicks = 0;

  function enhanceUI() {
    const nav = document.getElementById('atv-nav');
    const menu = document.getElementById('atv-menu');
    const signed = isSignedIn();

    if (menu && !menu.dataset.mobileEnhanced) {
      menu.dataset.mobileEnhanced = '1';

      const signInLink = document.createElement('a');
      signInLink.href = SIGNIN_URL;
      signInLink.className = 'atv-signin-item';
      signInLink.textContent = 'Sign in with Google';
      menu.insertBefore(signInLink, menu.firstChild);

      const toggleBtn = document.createElement('a');
      toggleBtn.href = '#';
      toggleBtn.textContent = 'Toggle Top Bar';
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const cur = document.documentElement.classList.contains('atv-classic');
        try { chrome.storage.sync.set({ classic: !cur }); } catch (err) {}
        if (nav) nav.classList.remove('menu');
      });
      menu.appendChild(toggleBtn);

      const reloadBtn = document.createElement('a');
      reloadBtn.href = '#';
      reloadBtn.textContent = 'Reload';
      reloadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        location.reload();
      });
      menu.appendChild(reloadBtn);
    }

    if (nav) {
      const acctBtn = nav.querySelector('.atv-acct');
      const signInMenuItem = menu && menu.querySelector('.atv-signin-item');
      if (signed === false) {
        if (acctBtn) acctBtn.classList.add('atv-signed-out');
        if (signInMenuItem) signInMenuItem.style.display = '';
      } else if (signed === true) {
        if (acctBtn) acctBtn.classList.remove('atv-signed-out');
        if (signInMenuItem) signInMenuItem.style.display = 'none';
      }
    }

    const home = document.getElementById('atv-home');
    if (home && document.documentElement.classList.contains('atv-home')) {
      const loading = home.querySelector('.atv-loading');
      const hasContent = !!home.querySelector('.atv-hero, .atv-rows');
      if (loading && !hasContent) {
        emptyTicks++;
        if (emptyTicks >= 6 && !home.querySelector('.atv-guest-card')) {
          const card = document.createElement('div');
          card.className = 'atv-guest-card';

          const h2 = document.createElement('h2');
          h2.textContent = 'Cinema YouTube';

          const p = document.createElement('p');
          p.textContent = signed === false
            ? 'Sign in with your Google account to load your For You feed, Subscriptions, Playlists, and History.'
            : 'Loading your YouTube feed… If you are not signed in yet, tap below to sign in.';

          const a = document.createElement('a');
          a.className = 'atv-btn atv-btn-main';
          a.href = SIGNIN_URL;
          a.textContent = 'Sign in with Google';

          card.append(h2, p, a);
          loading.appendChild(card);
        }
      } else {
        emptyTicks = 0;
      }
    }
  }

  setInterval(enhanceUI, 800);
})();
