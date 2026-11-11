/*
 * userguide.js: in-app User Guide panel for Seeking Eureka learning apps.
 *
 * Reads UserGuide.md (the single source of truth) and renders it in a
 * slide-over panel. No dependencies, no build step.
 *
 * Usage:
 *   <button data-userguide-open>User Guide</button>
 *   <script src="userguide.js" defer
 *           data-src="UserGuide.md"
 *           data-fallback="https://github.com/<org>/<repo>/blob/main/UserGuide.md"></script>
 *
 * Deep link: append #guide to the app URL to open the panel on load.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var SRC = (script && script.dataset.src) || 'UserGuide.md';
  var FALLBACK = (script && script.dataset.fallback) || '';
  var HASH = '#guide';

  var panel, backdrop, body, titleEl, lastFocus, loaded = false;

  /* ---------- Minimal Markdown renderer ---------- */
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      var safe = /^(https?:|mailto:|#|\.?\/)/i.test(u) ? u : '#';
      var ext = /^https?:/i.test(safe) ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + safe + '"' + ext + '>' + t + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + esc(codes[+i]) + '</code>'; });
    return s;
  }
  function slug(s) {
    return 'ug-' + s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function cells(row) {
    return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); });
  }
  function render(md) {
    var lines = md.replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0, title = '';
    var isTableSep = function (l) { return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l); };
    var isBlockStart = function (l, next) {
      return /^#{1,6}\s/.test(l) || /^\s*([-*+]|\d+\.)\s+/.test(l) || /^>\s?/.test(l) ||
        /^```/.test(l) || /^(\*{3,}|-{3,}|_{3,})\s*$/.test(l) || (/^\s*\|/.test(l) && next !== undefined && isTableSep(next));
    };
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      var h = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        var lvl = h[1].length, txt = inline(h[2]);
        if (lvl === 1 && !title) { title = txt; i++; continue; }
        out.push('<h' + lvl + ' id="' + slug(txt) + '">' + txt + '</h' + lvl + '>'); i++; continue;
      }
      if (/^```/.test(l)) {
        var buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue;
      }
      if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(l) && lines[i + 1] !== undefined && isTableSep(lines[i + 1])) {
        var head = cells(l); i += 2;
        var t = '<div class="ug-tablewrap"><table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
        while (i < lines.length && /^\s*\|/.test(lines[i])) {
          t += '<tr>' + cells(lines[i]).map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; i++;
        }
        out.push(t + '</tbody></table></div>'); continue;
      }
      if (/^>\s?/.test(l)) {
        var q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + render(q.join('\n')).html + '</blockquote>'); continue;
      }
      var lm = l.match(/^\s*([-*+]|\d+\.)\s+/);
      if (lm) {
        var ordered = /\d/.test(lm[1]), items = [];
        while (i < lines.length) {
          var m = lines[i].match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
          if (m && /\d/.test(m[1]) === ordered) { items.push(m[2]); i++; }
          else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; }
          else break;
        }
        var tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + tag + '>'); continue;
      }
      var p = [];
      while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1])) p.push(lines[i++].trim());
      if (!p.length) p.push(lines[i++].trim());
      out.push('<p>' + inline(p.join(' ')) + '</p>');
    }
    return { title: title, html: out.join('\n') };
  }

  /* ---------- Panel ---------- */
  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'ug-backdrop';
    backdrop.hidden = true;
    backdrop.addEventListener('click', close);

    panel = document.createElement('aside');
    panel.className = 'ug-panel';
    panel.id = 'user-guide';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'ug-title');
    panel.hidden = true;
    panel.innerHTML =
      '<header class="ug-head">' +
        '<div><div class="ug-kicker">User Guide</div><h2 id="ug-title" class="ug-title">Loading…</h2></div>' +
        '<button type="button" class="ug-close" aria-label="Close user guide">' +
          '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</header>' +
      '<div class="ug-body" tabindex="-1"></div>';
    body = panel.querySelector('.ug-body');
    titleEl = panel.querySelector('.ug-title');
    panel.querySelector('.ug-close').addEventListener('click', close);
    panel.addEventListener('keydown', trap);

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
  }

  function load() {
    if (loaded) return;
    loaded = true;
    fetch(SRC, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (md) {
        var r = render(md);
        titleEl.innerHTML = r.title || 'User Guide';
        body.innerHTML = r.html;
      })
      .catch(function () {
        loaded = false;
        titleEl.textContent = 'User Guide';
        body.innerHTML = '<p>The guide couldn\u2019t be loaded here.' +
          (FALLBACK ? ' You can <a href="' + esc(FALLBACK) + '" target="_blank" rel="noopener">read it on GitHub</a>.' : '') + '</p>';
      });
  }

  function isOpen() { return panel && !panel.hidden; }

  function open() {
    if (!panel) build();
    if (isOpen()) return;
    load();
    lastFocus = document.activeElement;
    backdrop.hidden = false; panel.hidden = false;
    requestAnimationFrame(function () { backdrop.classList.add('is-open'); panel.classList.add('is-open'); });
    document.documentElement.classList.add('ug-lock');
    setOpeners(true);
    if (location.hash !== HASH) history.replaceState(null, '', HASH);
    panel.querySelector('.ug-close').focus();
  }

  function close() {
    if (!isOpen()) return;
    panel.classList.remove('is-open'); backdrop.classList.remove('is-open');
    document.documentElement.classList.remove('ug-lock');
    setOpeners(false);
    setTimeout(function () { panel.hidden = true; backdrop.hidden = true; }, 220);
    if (location.hash === HASH) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function setOpeners(state) {
    document.querySelectorAll('[data-userguide-open]').forEach(function (b) { b.setAttribute('aria-expanded', state); });
  }

  function trap(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var f = panel.querySelectorAll('a[href],button,[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function syncHash() { if (location.hash === HASH) open(); else close(); }

  function init() {
    document.querySelectorAll('[data-userguide-open]').forEach(function (b) {
      b.setAttribute('aria-controls', 'user-guide');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function (e) { e.preventDefault(); open(); });
    });
    window.addEventListener('hashchange', syncHash);
    if (location.hash === HASH) open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.UserGuide = { open: open, close: close, render: render };
})();
