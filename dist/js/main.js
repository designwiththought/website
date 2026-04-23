/* Theme toggle — warm light / warm dark */
(function () {
  'use strict';

  var STORAGE_KEY = 'dwt-theme';
  var root = document.documentElement;

  function applyTheme(theme) {
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    var moon = document.querySelector('.theme-toggle__moon');
    var sun = document.querySelector('.theme-toggle__sun');
    if (moon && sun) {
      if (theme === 'dark') {
        moon.style.display = 'none';
        sun.style.display = '';
      } else {
        moon.style.display = '';
        sun.style.display = 'none';
      }
    }
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
  }

  function currentTheme() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch (e) {}
    return 'light';
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(currentTheme());
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  });

  // Apply immediately (before DOMContentLoaded) to avoid flash
  applyTheme(currentTheme());
})();


/* Reserved — accessibility affordances handled via CSS :focus-visible and nav.js focus trap. */


/* Drawer dialog — full-screen menu */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var openBtn = document.getElementById('menu-open');
    var closeBtn = document.getElementById('menu-close');
    var dialog = document.getElementById('site-menu-dialog');
    var heading = document.getElementById('site-menu-dialog-heading');
    if (!openBtn || !dialog) return;

    var inertEls = [];

    function markBackgroundInert() {
      inertEls = [];
      var body = document.body;
      Array.prototype.forEach.call(body.children, function (el) {
        if (el === dialog) return;
        if (el.contains(dialog)) return;
        el.setAttribute('inert', '');
        el.setAttribute('aria-hidden', 'true');
        inertEls.push(el);
      });
    }

    function clearBackgroundInert() {
      inertEls.forEach(function (el) {
        el.removeAttribute('inert');
        el.removeAttribute('aria-hidden');
      });
      inertEls = [];
    }

    function open() {
      dialog.hidden = false;
      openBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      markBackgroundInert();
      requestAnimationFrame(function () {
        if (heading && typeof heading.focus === 'function') heading.focus();
      });
      document.addEventListener('keydown', onKey);
    }

    function close() {
      dialog.hidden = true;
      openBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      clearBackgroundInert();
      document.removeEventListener('keydown', onKey);
      if (typeof openBtn.focus === 'function') openBtn.focus();
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      var focusables = dialog.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea'
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
  });
})();


/* Reserved — paper texture provided via SVG turbulence in CSS tokens. */


/* Reserved — floorboards motif is not used in the current design. */


/* Essays / Studies index — client-side kind + tag filter */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var filters = document.getElementById('filters');
    if (!filters) return;

    var kindBar = filters.querySelector('[data-filter-bar="kind"]');
    var tagBar = filters.querySelector('[data-filter-bar="tag"]');
    var cards = document.querySelectorAll('[data-essay]');
    var empty = document.querySelector('[data-empty-state]');
    if (!cards.length) return;

    var activeKind = 'all';
    var activeTag = 'all';

    // Allow deep-linking: /articles/?filter=Study or #tag=A11y
    var params = new URLSearchParams(window.location.search);
    if (params.get('filter')) activeKind = params.get('filter');
    if (params.get('tag')) activeTag = params.get('tag');

    function setActive(bar, attr, value) {
      bar.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('is-active', b.getAttribute(attr) === value);
      });
    }

    function apply() {
      var visible = 0;
      cards.forEach(function (el) {
        var kind = el.getAttribute('data-kind') || '';
        var tagsRaw = el.getAttribute('data-tags') || '';
        var tags = tagsRaw ? tagsRaw.split('|') : [];
        var kindOk = activeKind === 'all' || kind === activeKind;
        var tagOk = activeTag === 'all' || tags.indexOf(activeTag) !== -1;
        var show = kindOk && tagOk;
        el.hidden = !show;
        if (show) visible++;
      });
      if (empty) empty.hidden = visible > 0;
    }

    setActive(kindBar, 'data-filter', activeKind);
    setActive(tagBar, 'data-tag', activeTag);
    apply();

    kindBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      activeKind = btn.getAttribute('data-filter');
      setActive(kindBar, 'data-filter', activeKind);
      apply();
    });

    tagBar.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-tag]');
      if (!btn) return;
      activeTag = btn.getAttribute('data-tag');
      setActive(tagBar, 'data-tag', activeTag);
      apply();
    });
  });
})();
