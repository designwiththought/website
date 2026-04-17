/**
 * Accessibility
 * Reduced motion, reduced complexity, reveal animations, preference persistence.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var motionBtn = document.getElementById('btn-motion');
  var simplifyBtn = document.getElementById('btn-simplify');
  var zapIcon = document.getElementById('icon-motion-zap');
  var zapOffIcon = document.getElementById('icon-motion-zapoff');
  var announcer = document.getElementById('sr-announcer');

  // --- Reduced Motion ---
  var reducedMotion = false;

  // Detect system preference
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reducedMotion = true;
  }

  // Read stored preference
  var storedMotion = localStorage.getItem('reducedMotion');
  if (storedMotion !== null) {
    reducedMotion = storedMotion === 'true';
  }

  function applyMotion() {
    root.setAttribute('data-reduced-motion', reducedMotion);
    if (motionBtn) {
      motionBtn.setAttribute('aria-pressed', reducedMotion);
    }
    if (zapIcon && zapOffIcon) {
      zapIcon.style.display = reducedMotion ? 'none' : '';
      zapOffIcon.style.display = reducedMotion ? '' : 'none';
    }
    localStorage.setItem('reducedMotion', reducedMotion);
  }

  if (motionBtn) {
    motionBtn.addEventListener('click', function () {
      reducedMotion = !reducedMotion;
      applyMotion();
      if (announcer) {
        announcer.textContent = reducedMotion ? 'Motion reduced' : 'Motion enabled';
      }
    });
  }

  applyMotion();

  // --- Reduced Complexity (Simplify) ---
  var simplified = false;

  var storedSimplify = localStorage.getItem('simplified');
  if (storedSimplify !== null) {
    simplified = storedSimplify === 'true';
  }

  function applySimplify() {
    root.setAttribute('data-simplify', simplified);
    if (simplifyBtn) {
      simplifyBtn.classList.toggle('toolbar__btn--active', simplified);
      simplifyBtn.setAttribute('aria-pressed', simplified);
    }
    // Toggle visibility of normal vs simple content
    document.querySelectorAll('[data-content="normal"]').forEach(function (el) {
      el.hidden = simplified;
    });
    document.querySelectorAll('[data-content="simple"]').forEach(function (el) {
      el.hidden = !simplified;
    });
    localStorage.setItem('simplified', simplified);
  }

  if (simplifyBtn) {
    simplifyBtn.addEventListener('click', function () {
      simplified = !simplified;
      applySimplify();
      if (announcer) {
        announcer.textContent = simplified ? 'Simplified view enabled' : 'Full view restored';
      }
    });
  }

  applySimplify();

  // --- Reveal on scroll ---
  var reveals = document.querySelectorAll('.reveal');

  if (reducedMotion) {
    // Immediately reveal all
    reveals.forEach(function (el) { el.classList.add('is-revealed'); });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    reveals.forEach(function (el) { observer.observe(el); });
  }
})();
