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
    // Sun/moon visibility is driven by CSS based on the data-theme attribute
    // (.theme-toggle__sun / .theme-toggle__moon rules in site.css).
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


/* Accessible tag filter for the writing index pages (/essays/, /studies/).
 *
 * Markup contract (rendered by build.js renderFilterRow + writing-index.html):
 *   <div class="filter-row" data-tag-filter>
 *     <span id="tag-filter-label-…" class="filter-row__label">…</span>
 *     <div class="filter-bar filter-bar--tags" role="group" aria-labelledby="…">
 *       <button data-tag="all"   aria-pressed="true"  class="filter-bar__btn is-active">All</button>
 *       <button data-tag="A11y"  aria-pressed="false" class="filter-bar__btn">A11y</button>
 *       …
 *     </div>
 *     <p id="tag-filter-live-…" class="visually-hidden" aria-live="polite" aria-atomic="true"></p>
 *   </div>
 *   <div class="essay-list" data-tag-target>
 *     <a class="essay-card" data-tags="A11y|Keyboard|Craft">…</a>
 *     …
 *     <p class="empty-state" data-tag-empty hidden>…</p>
 *   </div>
 *
 * One filter per page (each /essays/ and /studies/ index gets its own).
 * Without JS: every chip stays inert and every card is visible.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var filter = document.querySelector('[data-tag-filter]');
    var list = document.querySelector('[data-tag-target]');
    if (!filter || !list) return;

    var bar = filter.querySelector('.filter-bar--tags');
    var live = filter.querySelector('[aria-live]');
    var emptyState = list.querySelector('[data-tag-empty]');
    var resetBtn = list.querySelector('[data-tag-reset]');
    var cards = Array.prototype.slice.call(list.querySelectorAll('[data-tags]'));
    if (!bar || !cards.length) return;

    function applyTag(tag) {
      var visible = 0;
      cards.forEach(function (card) {
        var tags = (card.getAttribute('data-tags') || '').split('|');
        var match = tag === 'all' || tags.indexOf(tag) !== -1;
        if (match) {
          card.hidden = false;
          visible++;
        } else {
          card.hidden = true;
        }
      });

      // Reflect pressed state on every chip so screen readers hear the change.
      var btns = bar.querySelectorAll('[data-tag]');
      Array.prototype.forEach.call(btns, function (b) {
        var on = b.getAttribute('data-tag') === tag;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('is-active', on);
      });

      if (emptyState) emptyState.hidden = visible !== 0;

      if (live) {
        var noun = visible === 1 ? 'item' : 'items';
        var msg = tag === 'all'
          ? 'Showing all ' + visible + ' ' + noun + '.'
          : 'Showing ' + visible + ' ' + noun + ' tagged ' + tag + '.';
        live.textContent = msg;
      }
    }

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tag]');
      if (!btn) return;
      applyTag(btn.getAttribute('data-tag'));
    });

    bar.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var btns = Array.prototype.slice.call(bar.querySelectorAll('[data-tag]'));
      var idx = btns.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      var next = e.key === 'ArrowRight'
        ? btns[(idx + 1) % btns.length]
        : btns[(idx - 1 + btns.length) % btns.length];
      next.focus();
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        applyTag('all');
        var allBtn = bar.querySelector('[data-tag="all"]');
        if (allBtn) allBtn.focus();
      });
    }
  });
})();
