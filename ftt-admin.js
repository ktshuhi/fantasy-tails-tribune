/* The Fantasy Tails Tribune: admin editing + edit storage.
   Readers: loads saved edits for this edition and shows them.
   Admins (signed in with the admin password): a small pencil button turns on
   editing, and every editable block gets a pencil. Saves go straight to the
   GitHub repo (edits/<edition>.json) using a GitHub key kept only on that device.
   Load this BEFORE ftt-runtime.js. */
(function () {
  'use strict';
  if (window.claude && typeof window.claude.use === 'function') return; // inside Claude Design preview

  // ---------- settings ----------
  var FALLBACK_OWNER = 'ktshuhi';
  var FALLBACK_REPO = 'fantasy-tails-tribune';
  var BRANCH = 'main';
  var KEY_STORE = 'ftt-gh-key';
  var NAME_STORE = 'ftt-editor-name';

  var meta = document.querySelector('meta[name="ftt-edition"]');
  var EDITION = (meta && meta.getAttribute('content')) || 'default';
  var PATH = 'edits/' + EDITION + '.json';

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  var IS_ADMIN = ls('ftt-admin') === '1';

  function repo() {
    var h = location.hostname;
    if (/\.github\.io$/.test(h)) {
      var owner = h.split('.')[0];
      var seg = location.pathname.split('/')[1] || '';
      if (seg && !/\.html?$/.test(seg)) return owner + '/' + seg;
      return owner + '/' + owner + '.github.io';
    }
    return FALLBACK_OWNER + '/' + FALLBACK_REPO;
  }

  // ---------- base64 for UTF-8 ----------
  function b64enc(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64dec(b64) {
    var bin = atob(String(b64).replace(/\s/g, '')), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------- encryption (same key as the paper) ----------
  var _ck = null;
  function ckey() {
    if (_ck) return _ck;
    var k = ls('ftt-k'); if (!k) return Promise.reject(new Error('no key'));
    var b = atob(k), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    _ck = crypto.subtle.importKey('raw', u, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return _ck;
  }
  function sealEdits(list) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return ckey().then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(list))); })
      .then(function (ct) { var all = new Uint8Array(12 + ct.byteLength); all.set(iv); all.set(new Uint8Array(ct), 12); var bin = ''; for (var i = 0; i < all.length; i++) bin += String.fromCharCode(all[i]); return btoa(bin); });
  }
  function openEdits(j) {
    if (!j) return Promise.resolve([]);
    if (Array.isArray(j.edits)) return Promise.resolve(j.edits);
    if (!j.enc) return Promise.resolve([]);
    var b = atob(j.enc), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return ckey().then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, k, u.slice(12)); })
      .then(function (pt) { var l = JSON.parse(new TextDecoder().decode(pt)); return Array.isArray(l) ? l : []; });
  }

  // ---------- edit list ----------
  var edits = [];
  var listeners = [];
  function emit() {
    var snap = { docs: edits.map(function (e) { var d = Object.assign({}, e); delete d.id; return { id: e.id, data: function () { return d; } }; }) };
    listeners.forEach(function (l) { try { l(snap); } catch (e) {} });
  }

  function loadPublic() {
    return fetch('./' + PATH + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(openEdits)
      .catch(function () { return null; });
  }

  // ---------- GitHub write ----------
  function api(method, body) {
    var key = ls(KEY_STORE);
    var url = 'https://api.github.com/repos/' + repo() + '/contents/' + PATH + (method === 'GET' ? '?ref=' + BRANCH + '&t=' + Date.now() : '');
    return fetch(url, {
      method: method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  function readRemote() {
    return api('GET').then(function (r) {
      if (r.status === 404) return { sha: null, edits: [] };
      if (r.status === 401 || r.status === 403) { var e = new Error('bad key'); e.code = 'bad_key'; throw e; }
      if (!r.ok) { var e2 = new Error('read ' + r.status); e2.code = 'unavailable'; throw e2; }
      return r.json().then(function (j) {
        var parsed = null; try { parsed = JSON.parse(b64dec(j.content || '')); } catch (e) {}
        return openEdits(parsed).then(function (list) { return { sha: j.sha, edits: list }; });
      });
    });
  }
  // Read, change, write; retry if someone else saved at the same moment.
  function commit(mutate, message, tries) {
    tries = tries || 0;
    return readRemote().then(function (cur) {
      var next = mutate(cur.edits.slice());
      return sealEdits(next).then(function (sealed) {
      var body = { message: message, branch: BRANCH, content: b64enc(JSON.stringify({ edition: EDITION, enc: sealed }) + '\n') };
      if (cur.sha) body.sha = cur.sha;
      return api('PUT', body);
      }).then(function (r) {
        if ((r.status === 409 || r.status === 422) && tries < 3) return commit(mutate, message, tries + 1);
        if (r.status === 401 || r.status === 403) { var e = new Error('bad key'); e.code = 'bad_key'; throw e; }
        if (!r.ok) { var e2 = new Error('write ' + r.status); e2.code = 'unavailable'; throw e2; }
        return next;
      });
    });
  }

  // ---------- GitHub key prompt (admins only, once per device) ----------
  function askKey(msg) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'ftt-key';
      wrap.innerHTML =
        '<div class="ftt-key-box" role="dialog" aria-modal="true" aria-labelledby="ftt-key-h">' +
        '<b id="ftt-key-h">Connect this device</b>' +
        '<p>' + (msg || 'Edits are saved to the site on GitHub. Paste your GitHub key once and this phone will remember it.') + '</p>' +
        '<label>Your name (shown on the change log)<input class="ftt-key-name" autocomplete="name" value=""></label>' +
        '<label>GitHub key<input class="ftt-key-in" type="password" autocomplete="off" placeholder="github_pat_..."></label>' +
        '<div class="tc-row"><button type="button" class="tc-b ok ftt-key-ok">Save key</button><button type="button" class="tc-b ftt-key-no">Cancel</button></div>' +
        '</div>';
      document.body.appendChild(wrap);
      var nameIn = wrap.querySelector('.ftt-key-name'), keyIn = wrap.querySelector('.ftt-key-in');
      nameIn.value = ls(NAME_STORE) || '';
      setTimeout(function () { (nameIn.value ? keyIn : nameIn).focus(); }, 30);
      function done(v) { wrap.remove(); resolve(v); }
      wrap.querySelector('.ftt-key-ok').onclick = function () {
        var k = keyIn.value.trim(); if (!k) { keyIn.focus(); return; }
        ls(KEY_STORE, k); if (nameIn.value.trim()) ls(NAME_STORE, nameIn.value.trim());
        done(true);
      };
      wrap.querySelector('.ftt-key-no').onclick = function () { done(false); };
      keyIn.onkeydown = function (e) { if (e.key === 'Enter') wrap.querySelector('.ftt-key-ok').click(); };
    });
  }
  function ensureKey(msg) {
    if (ls(KEY_STORE)) return Promise.resolve(true);
    return askKey(msg);
  }
  function withKey(fn) {
    return ensureKey().then(function (ok) {
      if (!ok) { var e = new Error('cancelled'); e.code = 'cancelled'; throw e; }
      return fn().catch(function (err) {
        if (err && err.code === 'bad_key') {
          ls(KEY_STORE, null);
          return askKey('GitHub turned that key down. It may have expired or may not have write access to this repo. Paste a new one.')
            .then(function (ok2) { if (!ok2) throw err; return fn(); });
        }
        throw err;
      });
    });
  }

  // ---------- the db / user shim the page already speaks ----------
  function uid() { return IS_ADMIN ? 'ed:' + (ls(NAME_STORE) || 'Editor') : 'reader'; }
  var query = {
    orderBy: function () { return query; },
    limit: function () { return query; },
    onSnapshot: function (cb, errCb) {
      listeners.push(cb);
      var refresh = function () {
        var p = (IS_ADMIN && ls(KEY_STORE)) ? readRemote().then(function (r) { return r.edits; }).catch(function () { return loadPublic(); }) : loadPublic();
        return p.then(function (list) { if (list) { edits = list; emit(); } });
      };
      refresh();
      var iv = setInterval(refresh, 120000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
      return function () { clearInterval(iv); listeners = listeners.filter(function (l) { return l !== cb; }); };
    },
    add: function (obj) {
      var rec = Object.assign({}, obj, { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), status: 'accepted', author: uid() });
      return withKey(function () {
        rec.author = uid();
        return commit(function (list) { list.push(rec); return list; }, 'Edit');
      }).then(function (list) { edits = list; emit(); return { id: rec.id }; });
    }
  };
  var db = {
    collection: function () { return query; },
    doc: function (path) {
      var id = String(path).split('/').pop();
      return {
        update: function (patch) {
          return withKey(function () {
            return commit(function (list) { return list.map(function (e) { return e.id === id ? Object.assign({}, e, patch) : e; }); }, 'Edit');
          }).then(function (list) { edits = list; emit(); });
        }
      };
    }
  };
  var user = {
    id: function () { return Promise.resolve(uid()); },
    canEdit: function () { return Promise.resolve(IS_ADMIN); },
    profiles: function (ids) {
      var out = {};
      (ids || []).forEach(function (i) { out[i] = { name: String(i).indexOf('ed:') === 0 ? String(i).slice(3) : 'Someone' }; });
      return Promise.resolve(out);
    }
  };
  window.claude = { use: function (what) { return Promise.resolve(what === 'db' ? db : what === 'user' ? user : null); } };

  // ---------- pencil look (admins only) ----------
  if (!IS_ADMIN) return;
  var PENCIL = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 20h9'/%3E%3Cpath d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'/%3E%3C/svg%3E\")";
  var css =
    /* floating pencil switch */
    '.tc-dock{left:auto!important;right:14px!important;bottom:calc(14px + env(safe-area-inset-bottom))!important;transform:none!important;width:54px;height:54px;padding:0!important;border-radius:50%!important;justify-content:center;gap:0!important;overflow:hidden}' +
    '.tc-dock>:not(.tc-switch){display:none!important}' +
    '.tc-switch{width:100%;height:100%;padding:0!important;justify-content:center;font-size:0!important}' +
    '.tc-switch>span{display:none!important}' +
    '.tc-switch::before{content:"";width:24px;height:24px;background:var(--ink);-webkit-mask:' + PENCIL + ' center/contain no-repeat;mask:' + PENCIL + ' center/contain no-repeat}' +
    '.tc-dock:has(.tc-switch[aria-checked="true"]){background:var(--ink)!important}' +
    '.tc-switch[aria-checked="true"]::before{background:var(--paper)}' +
    /* per-block pencil */
    '.tc-tools{margin:-2px 0 10px!important;text-align:right!important}' +
    '.tc-edit{font-size:0!important;width:32px;height:32px;min-height:32px!important;opacity:.75;padding:0!important;border:1px solid var(--ink2)!important;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}' +
    '.tc-edit::before{content:"";width:15px;height:15px;background:var(--ink);-webkit-mask:' + PENCIL + ' center/contain no-repeat;mask:' + PENCIL + ' center/contain no-repeat}' +
    '.tc-card,.tc-mark{display:none!important}' +
    /* key dialog */
    '.ftt-key{position:fixed;inset:0;z-index:1000;background:rgba(20,18,15,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px}' +
    '@media(min-width:700px){.ftt-key{align-items:center}}' +
    '.ftt-key-box{width:min(440px,100%);background:#e8e3d6;color:#1f1c18;border:2px solid #1f1c18;box-shadow:5px 5px 0 #1f1c18;padding:18px;font-family:"Old Standard TT",Georgia,serif}' +
    '.ftt-key-box b{display:block;font-family:Oswald,sans-serif;text-transform:uppercase;letter-spacing:.1em;font-size:16px;margin-bottom:6px}' +
    '.ftt-key-box p{margin:0 0 12px;font-size:15px;line-height:1.4}' +
    '.ftt-key-box label{display:block;font-family:Oswald,sans-serif;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}' +
    '.ftt-key-box input{display:block;width:100%;box-sizing:border-box;margin-top:4px;font:16px Georgia,serif;padding:10px 6px;border:0;border-bottom:2px solid #1f1c18;background:transparent;color:#1f1c18;border-radius:0}';
  var st = document.createElement('style'); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
