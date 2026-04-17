/**
 * Floorboards
 * Three wide horizontal planks that spread apart vertically and fade on scroll.
 * No rotation. Comes back together on scroll up.
 */
(function () {
  'use strict';

  var container = document.getElementById('floorboards');
  if (!container) return;

  var planks = container.querySelectorAll('.plank');
  if (!planks.length) return;

  // Vertical spread: top drifts up, bottom drifts down, center stays
  var spread = [-1, 0, 1];
  var MAX_SPREAD = 25;
  var ticking = false;

  function update() {
    var rect = container.getBoundingClientRect();
    var viewH = window.innerHeight;

    // 0 = just entered bottom of viewport, 1+ = scrolled past
    var progress = 1 - (rect.top / viewH);
    progress = Math.max(0, Math.min(1.5, progress));

    // Separation starts after 40% visible, eases out
    var t = Math.max(0, Math.min(1, (progress - 0.4) / 0.6));
    t = t * t;

    // Fade starts at 50%, gone by 120%
    var opacity = 1;
    if (progress > 0.5) {
      opacity = Math.max(0, 1 - ((progress - 0.5) / 0.7));
    }

    container.style.opacity = opacity.toFixed(3);

    for (var i = 0; i < planks.length && i < spread.length; i++) {
      var y = spread[i] * MAX_SPREAD * t;
      planks[i].setAttribute('transform', 'translate(0, ' + y.toFixed(1) + ')');
    }

    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  window.addEventListener('resize', update, { passive: true });
  update();
})();
