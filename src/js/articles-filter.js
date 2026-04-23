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
