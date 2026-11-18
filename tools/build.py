"""Encrypt The Fantasy Tails Tribune for publishing.

python3 build.py SRC_DIR OUT_DIR LEAGUE_PW ADMIN_PW
- Content key K: reused from OUT_DIR/index.html if the league password unlocks it,
  so signed-in phones keep working week to week. Otherwise a new one is made.
- tribune.html: the whole paper (template, code, lead photo) encrypted with K.
- index.html: K wrapped once with each password (PBKDF2-SHA256 + AES-GCM). No hashes.
"""
import base64, json, os, re, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 310000
b64 = lambda b: base64.b64encode(b).decode()
ub64 = lambda s: base64.b64decode(s)

def kdf(pw, salt):
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode())

def wrap(K, pw):
    salt, iv = os.urandom(16), os.urandom(12)
    return {"s": b64(salt), "i": b64(iv), "c": b64(AESGCM(kdf(pw, salt)).encrypt(iv, K, None))}

def unwrap(w, pw):
    return AESGCM(kdf(pw, ub64(w["s"]))).decrypt(ub64(w["i"]), ub64(w["c"]), None)

def enc(K, data):
    iv = os.urandom(12)
    return b64(iv + AESGCM(K).encrypt(iv, data, None))

src, out, LPW, APW = sys.argv[1:5]

# ---- content key ----
K = None
old = os.path.join(out, "index.html")
if os.path.exists(old):
    m = re.search(r"const KEYS = (\{.*?\});", open(old, encoding="utf-8").read())
    if m:
        try:
            K = unwrap(json.loads(m.group(1))["league"], LPW); print("reusing content key")
        except Exception:
            print("old key did not unlock; making a new one")
if K is None:
    K = AESGCM.generate_key(bit_length=256)

# ---- tribune.html ----
t = open(os.path.join(src, "tribune.html"), encoding="utf-8").read()
head = t[:t.index("<body>")]
body = t[t.index("<body>") + len("<body>"):t.index("</body>")]
gc_start = body.index('<script>try{if(localStorage.getItem("ftt-admin")')
secret, tail = body[:gc_start], body[gc_start:]
tail = tail.replace('<script src="./ftt-admin.js"></script>\n', "").replace('<script src="./ftt-runtime.js"></script>\n', "")
# embed the lead photo (and any other non-texture asset) inside the encrypted part
for ref in sorted(set(re.findall(r'\./assets/([\w.-]+\.(?:jpe?g|png|webp))', secret))):
    if ref == "paper.jpg":
        continue
    data = open(os.path.join(src, "assets", ref), "rb").read()
    mime = "image/png" if ref.endswith(".png") else "image/webp" if ref.endswith(".webp") else "image/jpeg"
    secret = secret.replace("./assets/" + ref, "data:%s;base64,%s" % (mime, b64(data)))
head = re.sub(r'<script>try\{if\(localStorage\.getItem\("ftt-ok"\).*?</script>\n', "", head)
loader = r"""<style>.ftt-wait{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#e8e3d6;color:#4b463e;font:italic 18px Georgia,serif}</style>
<script>
(function () {
  function bytes(s) { var b = atob(s.trim()), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function out() { try { localStorage.removeItem('ftt-k'); localStorage.removeItem('ftt-ok'); localStorage.removeItem('ftt-admin'); } catch (e) {} location.replace('./index.html'); }
  function load(srcs, i) { if (i >= srcs.length) return; var s = document.createElement('script'); s.src = srcs[i]; s.onload = function () { load(srcs, i + 1); }; document.body.appendChild(s); }
  window.addEventListener('DOMContentLoaded', async function () {
    var k = null; try { k = localStorage.getItem('ftt-k'); } catch (e) {}
    if (!k || !window.crypto || !crypto.subtle) return out();
    try {
      var key = await crypto.subtle.importKey('raw', bytes(k), 'AES-GCM', false, ['decrypt']);
      var all = bytes(document.getElementById('ftt-data').textContent);
      var html = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12)));
      var box = document.createElement('div'); box.innerHTML = html;
      var w = document.querySelector('.ftt-wait'); if (w) w.remove();
      while (box.firstChild) document.body.insertBefore(box.firstChild, document.getElementById('ftt-data'));
      load(['./ftt-admin.js', './ftt-runtime.js'], 0);
    } catch (e) { out(); }
  });
})();
</script>
"""
shell = (head.replace("</head>", loader + "</head>") + "<body>\n<div class=\"ftt-wait\">Unfolding the paper&hellip;</div>\n"
         + '<script id="ftt-data" type="application/octet-stream">' + enc(K, secret.encode()) + "</script>\n"
         + tail + "</body>\n</html>\n")
open(os.path.join(out, "tribune.html"), "w", encoding="utf-8").write(shell)

# ---- index.html ----
ix = open(os.path.join(src, "index.html"), encoding="utf-8").read()
keys = json.dumps({"league": wrap(K, LPW), "admin": wrap(K, APW)}, separators=(",", ":"))
ix = re.sub(r"// PASSWORD:.*?const ADMIN_PASSWORD_SHA256 = '[0-9a-f]*';\n",
            "// The paper's key, locked once with each password. A wrong password can't open it.\nconst KEYS = " + keys + ";\nconst ITER = " + str(ITER) + ";\n",
            ix, flags=re.S)
new_check = r"""  async check() {
    const pw = this.state.pw; const admin = this.state.admin;
    if (!pw) { this.setState({ msg: admin ? 'Enter the admin password.' : 'Enter the league password.' }); return; }
    this.setState({ msg: 'Checking...' });
    const ub = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    try {
      const w = admin ? KEYS.admin : KEYS.league;
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
      const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: ub(w.s), iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      let raw;
      try { raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub(w.i) }, kek, ub(w.c))); }
      catch (e) { this.setState({ msg: 'Wrong password. Ask the group chat.', pw: '' }); return; }
      let bin = ''; raw.forEach((b) => { bin += String.fromCharCode(b); });
      try {
        localStorage.setItem('ftt-k', btoa(bin));
        localStorage.setItem('ftt-ok', '1');
        if (admin) localStorage.setItem('ftt-admin', '1'); else localStorage.removeItem('ftt-admin');
      } catch (e) {}
      this.setState({ msg: 'Welcome in.' });
      window.location.href = admin ? ADMIN_URL : NEXT_URL;
    } catch (e) { this.setState({ msg: 'Something went wrong. Try again.' }); }
  }
"""
ix = re.sub(r"  async check\(\) \{.*?\n  \}\n(?=  renderVals)", lambda m: new_check, ix, flags=re.S)
assert "KEYS" in ix and "SHA256" not in ix and "PBKDF2" in ix
open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(ix)
print("built", len(shell), "bytes tribune;", len(ix), "bytes index")
