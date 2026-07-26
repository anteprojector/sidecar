// ---------------------------------------------------------------------------
// Theme explorer. A paintbrush in the bottom-right corner opens a panel with
// two carousels: theme and typeface. Deliberately shipping while the design
// settles — visitors can play with it too, and every choice is local to
// their browser. (The favicon row retired when the gold wedge shipped; the
// faces still live in site/assets/faces/ if it ever comes back.)
//
// Caveat of exploration mode: the typeface row loads its candidates from the
// Google Fonts CDN, the one exception to the page's no-third-party-requests
// rule (see the @font-face comment in style.css).
//
// To retire it someday: delete this file and its <script> tag in index.html,
// and self-host the winning font the way the shipped one is handled in
// style.css (one variable woff2, latin subset).
//
// Keys: F / shift+F cycle the font. Every choice survives reload.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var FONTS = [
    { name: 'Schibsted Grotesk',  note: 'current — editorial grotesque' },
    { name: 'Space Grotesk',      note: 'techy, flat-topped a' },
    { name: 'Geist',              note: 'cleanest, most neutral' },
    { name: 'Instrument Sans',    note: 'neutral-modern, slightly narrow' },
    { name: 'Familjen Grotesk',   note: 'humanist, a little quirky' },
    { name: 'Chivo',              note: 'sturdy grotesque with character' },
    { name: 'Sora',               note: 'geometric, distinctly "tech"' },
    { name: 'Bricolage Grotesque', note: 'most expressive, odd widths' }
  ];

  var THEMES = [
    { id: 'system', note: 'follows the OS' },
    { id: 'light',  note: 'white paper, black ink' },
    { id: 'dark',   note: 'black paper, white ink' },
    { id: 'yellow', note: 'brand yellow paper' }
  ];

  var STACK = ', -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  var FONT_KEY = 'font-cycler-2';
  // Feedback on the shipped defaults lands as an issue, prefilled so the
  // reporter only has to name the combination they liked.
  var ISSUE_URL = 'https://github.com/anteprojector/sidecar/issues/new?' +
    'title=' + encodeURIComponent('Theme explorer: feedback') +
    '&labels=' + encodeURIComponent('feedback') +
    '&body=' + encodeURIComponent(
      'Theme:\nFont:\n\nWhat worked, what didn\'t:\n');

  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?' +
    FONTS.map(function (f) {
      return 'family=' + f.name.replace(/ /g, '+') + ':wght@400..700';
    }).join('&') + '&display=swap';
  document.head.appendChild(link);

  var BRUSH =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/>' +
    '<path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 ' +
    '2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02Z"/></svg>';

  function row(key, label) {
    return '<div class="ex-row" data-row="' + key + '">' +
      '<span class="ex-key">' + label + '</span>' +
      '<button type="button" data-step="-1" aria-label="Previous ' + label + '">&larr;</button>' +
      '<span class="ex-text"><span><b></b><i></i></span></span>' +
      '<button type="button" data-step="1" aria-label="Next ' + label + '">&rarr;</button>' +
      '</div>';
  }

  var root = document.createElement('div');
  root.id = 'explorer';
  root.innerHTML =
    '<div class="ex-panel" hidden>' +
      row('theme', 'theme') +
      row('font', 'font') +
      '<p class="ex-note"><a href="' + ISSUE_URL + '" target="_blank" ' +
        'rel="noopener">Give us feedback on github (and a star)</a></p>' +
    '</div>' +
    '<button class="ex-toggle" type="button" aria-expanded="false" ' +
      'aria-label="Open the theme explorer">' + BRUSH + '</button>';

  var style = document.createElement('style');
  style.textContent = [
    '#explorer{position:fixed;right:1.25rem;bottom:1.25rem;z-index:9999;display:flex;',
      'flex-direction:column;align-items:flex-end;gap:0.625rem;font-family:var(--mono);font-size:0.6875rem}',
    '#explorer .ex-toggle{display:flex;align-items:center;justify-content:center;',
      'width:2.5rem;height:2.5rem;padding:0;border:1.5px solid var(--rule);border-radius:0.5rem;',
      'background:var(--bg);color:var(--muted);box-shadow:0.1875rem 0.1875rem 0 var(--shadow);cursor:pointer;',
      'transition:transform .12s,box-shadow .12s,border-color .12s,color .12s}',
    '#explorer .ex-toggle:hover{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--shadow);',
      'border-color:var(--ink);color:var(--ink)}',
    '#explorer .ex-toggle[aria-expanded="true"]{background:var(--wash);',
      'border-color:var(--ink);color:var(--ink)}',
    '#explorer .ex-toggle svg{width:1.1875rem;height:1.1875rem;fill:none;stroke:currentColor;',
      'stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '#explorer .ex-panel{display:flex;flex-direction:column;gap:0.5rem;padding:0.75rem 0.875rem;',
      'border:1.5px solid var(--ink);border-radius:0.5rem;background:var(--bg);color:var(--ink);',
      'box-shadow:0.1875rem 0.1875rem 0 var(--shadow)}',
    // display:flex above outranks the UA's [hidden]{display:none}, so the
    // hidden attribute does nothing unless it's restated at this specificity.
    '#explorer .ex-panel[hidden]{display:none}',
    '#explorer .ex-note{margin:2px 0 0;padding-top:0.5rem;border-top:1px solid var(--rule);',
      'font-size:0.625rem;color:var(--faint)}',
    '#explorer .ex-note a{color:inherit;text-decoration:none}',
    '#explorer .ex-note a:hover{color:var(--ink);text-decoration:underline}',
    '#explorer .ex-row{display:flex;align-items:center;gap:0.5rem}',
    '#explorer .ex-key{width:3.25rem;color:var(--faint);text-transform:uppercase;',
      'letter-spacing:.06em;font-size:0.59375rem}',
    '#explorer button[data-step]{background:none;border:1px solid var(--rule);color:var(--muted);',
      'cursor:pointer;font:inherit;padding:2px 0.4375rem;line-height:1.4;border-radius:0.25rem}',
    '#explorer button[data-step]:hover{color:var(--ink);border-color:var(--ink)}',
    '#explorer .ex-text{display:flex;align-items:center;gap:0.5rem;min-width:11.625rem}',
    '#explorer .ex-text>span{display:flex;flex-direction:column}',
    '#explorer b{font-weight:600}',
    '#explorer i{font-style:normal;color:var(--faint);font-size:0.625rem}',
    '@media (prefers-reduced-motion:reduce){#explorer .ex-toggle{transition:none}}'
  ].join('');

  var fontIndex = 0;
  try {
    var f = FONTS.findIndex(function (x) { return x.name === localStorage.getItem(FONT_KEY); });
    if (f > -1) fontIndex = f;
  } catch (e) {}

  function paint(key, title, note) {
    var r = root.querySelector('[data-row="' + key + '"]');
    r.querySelector('b').textContent = title;
    r.querySelector('i').textContent = note;
    return r;
  }

  function applyFont(i) {
    fontIndex = (i + FONTS.length) % FONTS.length;
    var font = FONTS[fontIndex];
    document.documentElement.style.setProperty('--sans', '"' + font.name + '"' + STACK);
    paint('font', (fontIndex + 1) + '/' + FONTS.length + '  ' + font.name, font.note);
    try { localStorage.setItem(FONT_KEY, font.name); } catch (e) {}
  }

  // main.js owns the theme so the nav brush and this row can't drift apart.
  function themeIndex() {
    var current = window.sidecarTheme ? window.sidecarTheme.current() : 'system';
    var i = THEMES.findIndex(function (t) { return t.id === current; });
    return i < 0 ? 0 : i;
  }

  function applyTheme(i) {
    var theme = THEMES[(i + THEMES.length) % THEMES.length];
    if (window.sidecarTheme) window.sidecarTheme.apply(theme.id);
    paint('theme', (THEMES.indexOf(theme) + 1) + '/' + THEMES.length + '  ' + theme.id, theme.note);
  }

  function start() {
    document.head.appendChild(style);
    document.body.appendChild(root);

    var toggle = root.querySelector('.ex-toggle');
    var panel = root.querySelector('.ex-panel');
    // Always starts closed — the panel is a detour, not the state of the page.
    var open = false;

    function setOpen(next) {
      open = next;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', (open ? 'Close' : 'Open') + ' the theme explorer');
    }

    toggle.addEventListener('click', function () { setOpen(!open); });
    setOpen(open);

    root.querySelectorAll('button[data-step]').forEach(function (b) {
      var key = b.closest('.ex-row').dataset.row;
      var step = Number(b.dataset.step);
      b.addEventListener('click', function () {
        if (key === 'font') applyFont(fontIndex + step);
        else applyTheme(themeIndex() + step);
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f') applyFont(fontIndex + 1);
      if (e.key === 'F') applyFont(fontIndex - 1);
    });

    applyFont(fontIndex);
    applyTheme(themeIndex());

    // The nav brush can change the theme too; keep the row's text honest.
    var navBrush = document.querySelector('.theme');
    if (navBrush) {
      navBrush.addEventListener('click', function () { applyTheme(themeIndex()); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
