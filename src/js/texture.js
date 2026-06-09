/* Paper grain: fade the fixed noise layers out while scrolling and back in
   when motion stops. Fixed noise behind moving content is a documented
   motion-sickness trigger, so this is an accessibility win for the
   default state. Users with prefers-reduced-motion get the noise hidden
   entirely (handled in CSS). */
(function () {
  'use strict';

  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return; // CSS already drops the layers; no JS needed.

  var body = document.body;
  var timer = null;
  var DEBOUNCE_MS = 220;

  function onScroll() {
    if (!body.classList.contains('is-scrolling')) {
      body.classList.add('is-scrolling');
    }
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(function () {
      body.classList.remove('is-scrolling');
    }, DEBOUNCE_MS);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
})();
