/* The Fantasy Tails Tribune: tiny page runtime.
   Renders the <x-dc> template on each page with the Component class in
   <script type="text/x-dc">. Supports {{holes}}, <sc-for>, <sc-if>, on* events. */
(function () {
  'use strict';

  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(upd, cb) {
      const part = typeof upd === 'function' ? upd(this.state, this.props) : upd;
      if (part) this.state = Object.assign({}, this.state, part);
      if (this.__schedule) this.__schedule(cb); else if (cb) cb();
    }
  }

  const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  const ONE_HOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    const parts = path.split('.');
    let v;
    for (let i = scope.length - 1; i >= 0; i--) {
      if (scope[i] && Object.prototype.hasOwnProperty.call(scope[i], parts[0])) { v = scope[i][parts[0]]; break; }
    }
    for (let k = 1; k < parts.length; k++) { if (v == null) return undefined; v = v[parts[k]]; }
    return v;
  }
  const str = (v) => (v == null || v === false ? '' : String(v));
  const interp = (s, scope) => s.replace(HOLE, (m, p) => str(lookup(p, scope)));

  // Build a fresh node list from the template for the current values.
  function build(nodes, scope, out) {
    for (const n of nodes) {
      if (n.nodeType === 3) { out.push(document.createTextNode(n.nodeValue.indexOf('{{') < 0 ? n.nodeValue : interp(n.nodeValue, scope))); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.localName;
      if (tag === 'sc-for') {
        const m = ONE_HOLE.exec(n.getAttribute('list') || '');
        const list = m ? lookup(m[1], scope) : null;
        const as = n.getAttribute('as') || 'item';
        if (Array.isArray(list)) list.forEach((item, i) => { const sc = {}; sc[as] = item; sc.index = i; build(n.childNodes, scope.concat([sc]), out); });
        continue;
      }
      if (tag === 'sc-if') {
        const m = ONE_HOLE.exec(n.getAttribute('value') || '');
        if (m && lookup(m[1], scope)) build(n.childNodes, scope, out);
        continue;
      }
      const el = n.namespaceURI === 'http://www.w3.org/2000/svg' ? document.createElementNS(n.namespaceURI, n.tagName) : document.createElement(tag);
      el.__h = {};
      for (const a of Array.from(n.attributes)) {
        const name = a.name;
        if (name.indexOf('hint-') === 0) continue;
        const one = ONE_HOLE.exec(a.value);
        if (name.length > 2 && name.indexOf('on') === 0) {
          const fn = one ? lookup(one[1], scope) : null;
          if (typeof fn === 'function') el.__h[name.slice(2)] = fn;
          continue;
        }
        if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) { el.__val = one ? str(lookup(one[1], scope)) : interp(a.value, scope); continue; }
        const val = a.value.indexOf('{{') < 0 ? a.value : interp(a.value, scope);
        try { if (a.namespaceURI) el.setAttributeNS(a.namespaceURI, name, val); else el.setAttribute(name, val); } catch (e) {}
      }
      const kids = [];
      build(n.childNodes, scope, kids);
      kids.forEach((k) => el.appendChild(k));
      out.push(el);
    }
    return out;
  }

  function setHandlers(el, h) {
    const old = el.__live || {};
    el.__live = old;
    Object.keys(old).forEach((ev) => { if (!h[ev]) { el.removeEventListener(ev, old[ev].w); delete old[ev]; } });
    Object.keys(h).forEach((ev) => {
      if (old[ev]) { old[ev].fn = h[ev]; return; }
      const rec = { fn: h[ev] };
      rec.w = (e) => rec.fn(e);
      old[ev] = rec;
      el.addEventListener(ev, rec.w);
    });
  }
  function applyNew(el) {
    if (el.nodeType !== 1) return;
    setHandlers(el, el.__h || {});
    if (el.__val !== undefined) el.value = el.__val;
    for (const c of el.children) applyNew(c);
  }

  // Patch the live DOM to match the freshly built nodes (keeps focus, scroll and animations).
  function patchChildren(parent, fresh) {
    const cur = Array.from(parent.childNodes);
    for (let i = 0; i < fresh.length; i++) {
      const f = fresh[i], c = cur[i];
      if (!c) { parent.appendChild(f); applyNew(f); continue; }
      if (c.nodeType !== f.nodeType || (c.nodeType === 1 && (c.namespaceURI !== f.namespaceURI || c.localName !== f.localName))) {
        parent.replaceChild(f, c); applyNew(f); continue;
      }
      if (c.nodeType === 3) { if (c.nodeValue !== f.nodeValue) c.nodeValue = f.nodeValue; continue; }
      for (const a of Array.from(c.attributes)) if (!f.hasAttribute(a.name)) c.removeAttribute(a.name);
      for (const a of Array.from(f.attributes)) if (c.getAttribute(a.name) !== a.value) { try { c.setAttribute(a.name, a.value); } catch (e) {} }
      setHandlers(c, f.__h || {});
      if (f.__val !== undefined && c.value !== f.__val) c.value = f.__val;
      patchChildren(c, Array.from(f.childNodes));
    }
    for (let i = cur.length - 1; i >= fresh.length; i--) parent.removeChild(cur[i]);
  }

  function boot() {
    const host = document.querySelector('x-dc');
    const code = document.querySelector('script[type="text/x-dc"]');
    if (!host || !code) return;
    const helmet = host.querySelector('helmet');
    if (helmet) { Array.from(helmet.children).forEach((n) => document.head.appendChild(n)); helmet.remove(); }
    const tpl = document.createElement('template');
    tpl.innerHTML = host.innerHTML;
    const source = Array.from(tpl.content.childNodes);
    const root = document.createElement('div');
    root.className = 'dc-root';
    host.replaceWith(root);

    let Component;
    try { Component = new Function('DCLogic', code.textContent + '\n;return Component;')(DCLogic); }
    catch (e) { console.error(e); return; }
    let props = {};
    try {
      const decl = JSON.parse(code.getAttribute('data-props') || '{}');
      Object.keys(decl).forEach((k) => { if (k[0] !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k].default; });
    } catch (e) {}
    const comp = new Component(props);
    let queued = false; const cbs = [];
    const render = () => {
      let vals;
      try { vals = comp.renderVals(); } catch (e) { console.error(e); return; }
      patchChildren(root, build(source, [vals], []));
    };
    comp.__schedule = (cb) => {
      if (cb) cbs.push(cb);
      if (queued) return;
      queued = true;
      Promise.resolve().then(() => { queued = false; render(); cbs.splice(0).forEach((f) => { try { f(); } catch (e) {} }); });
    };
    render();
    if (typeof comp.componentDidMount === 'function') { try { comp.componentDidMount(); } catch (e) { console.error(e); } }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
