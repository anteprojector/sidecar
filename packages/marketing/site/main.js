// Theme toggle and copy buttons. No build step, no dependencies — ships as-is.

(function () {
  'use strict';

  // Theme: system -> light -> dark -> yellow -> system. Yellow is the default,
  // so "system" — which drops the attribute and lets prefers-color-scheme take
  // over — has to be stored explicitly rather than recorded as "nothing saved".
  var themeButton = document.querySelector('.theme');
  if (themeButton) {
    var MODES = ['system', 'light', 'dark', 'yellow'];

    function applyTheme(mode) {
      if (mode === 'system') {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = mode;
      }
      themeButton.dataset.mode = mode;
      themeButton.setAttribute('aria-label', 'Theme: ' + mode);
      themeButton.title = 'Theme: ' + mode;
      try { localStorage.setItem('theme', mode); } catch (e) {}
    }

    var stored;
    try { stored = localStorage.getItem('theme'); } catch (e) {}
    applyTheme(MODES.indexOf(stored) > -1 ? stored : 'yellow');

    themeButton.addEventListener('click', function () {
      var next = MODES[(MODES.indexOf(themeButton.dataset.mode) + 1) % MODES.length];
      applyTheme(next);
    });

    // The explorer panel drives the same state, so the nav button stays in sync.
    window.sidecarTheme = {
      modes: MODES,
      apply: applyTheme,
      current: function () { return themeButton.dataset.mode; }
    };
  }

  // navigator.clipboard rejects when the document isn't focused, so fall back to
  // the old selection-based copy rather than silently doing nothing.
  function copyText(text) {
    if (navigator.clipboard) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    var field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(field);
    field.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(field);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  document.querySelectorAll('.step[data-copy]').forEach(function (step) {
    step.addEventListener('click', function () {
      var code = step.querySelector('code');
      if (!code) return;
      copyText(code.textContent).then(function () {
        // The icon swap is driven entirely by this attribute.
        step.setAttribute('data-copied', '');
        setTimeout(function () {
          step.removeAttribute('data-copied');
        }, 1600);
      }, function () {
        /* nothing copied — leave the button as-is rather than lying about it */
      });
    });
  });
})();

// GitHub star count. The markup ships with a build-time count stamped in by
// scripts/stamp-stars.mjs, so this refresh is progressive enhancement: it
// corrects the number client-side at most once an hour per visitor.
(function () {
  'use strict';

  var els = document.querySelectorAll('[data-stars]');
  if (!els.length || !window.fetch) return;

  var KEY = 'sidecar-stars';
  var HOUR = 60 * 60 * 1000;

  function format(count) {
    if (count < 1000) return String(count);
    var thousands = count / 1000;
    return (thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10) + 'k';
  }

  function show(count) {
    els.forEach(function (el) {
      el.textContent = format(count);
    });
  }

  try {
    var cached = JSON.parse(localStorage.getItem(KEY));
    if (cached && typeof cached.count === 'number' && Date.now() - cached.at < HOUR) {
      show(cached.count);
      return;
    }
  } catch (e) {
    /* unreadable cache — fall through to the fetch */
  }

  fetch('https://api.github.com/repos/anteprojector/sidecar')
    .then(function (response) {
      return response.ok ? response.json() : Promise.reject(new Error(String(response.status)));
    })
    .then(function (repo) {
      if (typeof repo.stargazers_count !== 'number') return;
      show(repo.stargazers_count);
      try {
        localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), count: repo.stargazers_count }));
      } catch (e) {
        /* storage full or blocked — the fetch still updated the page */
      }
    })
    .catch(function () {
      /* offline or rate-limited — keep the build-time count */
    });
})();
