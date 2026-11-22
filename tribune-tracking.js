/*
 * Fantasy Tails Tribune: extra GoatCounter tracking
 *
 * Nothing in this file shows up on the page. It only sends quiet events
 * to your GoatCounter dashboard.
 *
 * MEMBERS are tracked:
 *   notify-me-click          tapped "Notify me"
 *   notify-granted / denied  their answer to the browser's notification prompt
 *   pwa-installed            installed to home screen (Android only)
 *   homescreen-first-launch  first time this device opened the site from the home screen icon
 *   homescreen-launch        every open from the home screen icon
 *
 * ADMINS (you and Doug) are only counted as:
 *   admin-signin             once per browser session
 * Admin devices never send the member events above, so they don't inflate member numbers.
 *
 * HOW A DEVICE GETS MARKED AS ADMIN (either one works):
 *   a) It opens any page whose address contains "admin" (e.g. admin.html), or
 *   b) Your admin login code calls  window.tribuneMarkAdmin()  after the admin password succeeds.
 * Once marked, that browser stays marked (even on member pages) until its storage is cleared.
 *
 * SETUP: add this AFTER the GoatCounter script tag on every page, member and admin:
 *   <script data-goatcounter="https://fantasy-tails-tribune.goatcounter.com/count"
 *           async src="//gc.zgo.at/count.js"></script>
 *   <script src="tribune-tracking.js" defer></script>
 */
(function () {
  var ADMIN_KEY = 'tribune-is-admin';

  // Send an event, waiting for GoatCounter's count.js to finish loading if needed.
  function track(path, title, tries) {
    tries = tries || 0;
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      window.goatcounter.count({ path: path, title: title, event: true });
    } else if (tries < 50) {
      setTimeout(function () { track(path, title, tries + 1); }, 200);
    }
  }

  function storageGet(store, key) { try { return store.getItem(key); } catch (e) { return null; } }
  function storageSet(store, key, val) { try { store.setItem(key, val); } catch (e) {} }

  // Also treats a device signed in with the Tribune admin password (ftt-admin) as admin.
  function isAdmin() { return storageGet(localStorage, ADMIN_KEY) === '1' || storageGet(localStorage, 'ftt-admin') === '1'; }

  function countAdminSignin() {
    if (storageGet(sessionStorage, 'tribune-admin-counted') === '1') return;
    storageSet(sessionStorage, 'tribune-admin-counted', '1');
    track('admin-signin', 'Admin sign-in');
  }

  // Call this from your admin login code after the admin password is accepted.
  window.tribuneMarkAdmin = function () {
    storageSet(localStorage, ADMIN_KEY, '1');
    countAdminSignin();
  };

  // Option (a): any page with "admin" in the address marks this device as admin.
  if (/admin/i.test(window.location.pathname + window.location.hash)) {
    window.tribuneMarkAdmin();
  }

  // Admin devices: count the sign-in (above) and stop. No member tracking.
  if (isAdmin()) {
    countAdminSignin();
    return;
  }

  // ---------------- MEMBER TRACKING ----------------

  // 1. "Notify me" button: found by its text, or by data-track="notify-me".
  function isNotifyButton(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('data-track') === 'notify-me') return true;
    return (el.textContent || '').trim().toLowerCase().indexOf('notify me') !== -1;
  }

  document.addEventListener('click', function (e) {
    if (isAdmin()) return; // in case admin login happened on this page
    var el = e.target.closest ? e.target.closest('button, a, [role="button"], [data-track]') : null;
    if (!isNotifyButton(el)) return;

    track('notify-me-click', 'Notify me clicked');

    // Record their answer to the notification prompt, if the browser supports it.
    if ('Notification' in window) {
      var before = Notification.permission;
      var checks = 0;
      var timer = setInterval(function () {
        checks++;
        if (Notification.permission !== before || checks > 60) {
          clearInterval(timer);
          if (Notification.permission !== 'default') {
            track('notify-' + Notification.permission, 'Notify permission: ' + Notification.permission);
          }
        }
      }, 500);
    }
  }, true);

  // 2. Saved to home screen
  // Android / Chrome: fires the moment someone installs.
  window.addEventListener('appinstalled', function () {
    if (isAdmin()) return;
    track('pwa-installed', 'Installed to home screen (Android)');
  });

  // iPhone + Android: detect when the site is opened from the home screen icon.
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                   window.navigator.standalone === true;

  if (standalone) {
    track('homescreen-launch', 'Opened from home screen');
    if (storageGet(localStorage, 'tribune-hs-counted') !== '1') {
      storageSet(localStorage, 'tribune-hs-counted', '1');
      track('homescreen-first-launch', 'New home screen user');
    }
  } else if (storageGet(sessionStorage, 'tribune-browser-counted') !== '1') {
    // Opened in a normal browser tab (link from the group chat, typed address, etc.).
    // Counted once per visit so it lines up with homescreen-launch.
    storageSet(sessionStorage, 'tribune-browser-counted', '1');
    track('browser-launch', 'Opened in browser');
  }
})();
