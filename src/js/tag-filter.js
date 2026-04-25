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
