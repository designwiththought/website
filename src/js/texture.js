/* Paper grain: smoothly track scroll velocity instead of toggling on/off.
   The noise is set as opacity via a CSS custom property on <body>. We
   measure instant scroll velocity per event, exponentially smooth it,
   and map it to a target opacity. A short CSS transition smooths the
   discrete per-event updates into a continuous fade, so the grain
   dissolves as the page accelerates and breathes back in as it settles.

   Fixed noise behind moving content is a documented motion-sickness
   trigger, so this is the default for everyone. Users with
   prefers-reduced-motion get the noise hidden entirely via CSS, and
   the JS bails. */
(function () {
  'use strict';

  var prefersReduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) return;

  var body = document.body;
  var lastY = window.pageYOffset || 0;
  var lastT = performance.now();
  var smoothed = 0;  // exponentially-smoothed |velocity| in px/ms
  var raf = null;

  // Tunables.
  //   MIN_OPACITY: floor while scrolling. The grain dims but doesn't
  //                vanish — the presence-not-gone state is what we want
  //                during motion, since the issue is the motion itself
  //                not the texture's existence.
  //   VEL_TO_FADE: how aggressively velocity drives the dim. Lower is
  //                more gradual; reaching the floor takes more speed.
  //   SMOOTH_IN:   weight of new measurement when entering motion.
  //   SMOOTH_OUT:  decay multiplier per frame when idle (gentle return).
  var MIN_OPACITY = 0.3;
  var VEL_TO_FADE = 0.3;
  var SMOOTH_IN = 0.06;   // velocity ramps up slowly: gradual dim-down
  var SMOOTH_OUT = 0.97;  // velocity decays slowly: ~3s breathe-back
  var IDLE_EPS = 0.002;

  function setOpacity() {
    var range = 1 - MIN_OPACITY;
    var t = smoothed * VEL_TO_FADE;
    if (t > 1) t = 1;
    var op = 1 - t * range;
    if (op < MIN_OPACITY) op = MIN_OPACITY;
    if (op > 1) op = 1;
    body.style.setProperty('--grain-opacity', op.toFixed(3));
  }

  function tick() {
    smoothed *= SMOOTH_OUT;
    setOpacity();
    if (smoothed > IDLE_EPS) {
      raf = window.requestAnimationFrame(tick);
    } else {
      smoothed = 0;
      setOpacity();
      raf = null;
    }
  }

  function onScroll() {
    var now = performance.now();
    var y = window.pageYOffset || 0;
    var dy = Math.abs(y - lastY);
    var dt = now - lastT;
    if (dt < 1) dt = 1;
    var instant = dy / dt;
    // Exponential smoothing biased toward the new sample.
    smoothed = smoothed * (1 - SMOOTH_IN) + instant * SMOOTH_IN;
    lastY = y;
    lastT = now;
    if (raf == null) raf = window.requestAnimationFrame(tick);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
})();
