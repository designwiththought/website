/**
 * Theme Engine
 * Dynamic luminance-based color system with oklch.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var rulerEl = document.getElementById('ruler');
  var rulerFill = document.getElementById('ruler-fill');
  var rulerWrap = document.getElementById('ruler-wrap');
  var brightnessBtn = document.getElementById('btn-brightness');
  var sunIcon = document.getElementById('icon-brightness-sun');
  var moonIcon = document.getElementById('icon-brightness-moon');
  var announcer = document.getElementById('sr-announcer');

  var MIN_LUM = 15;
  var MAX_LUM = 98;
  var lum = MIN_LUM;
  var isDragging = false;
  var rulerVisible = false;

  // Detect system preference
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    lum = 92;
  }

  // Read stored preference
  var stored = localStorage.getItem('lum');
  if (stored !== null) {
    lum = Math.max(MIN_LUM, Math.min(MAX_LUM, parseFloat(stored)));
  }

  function applyTheme(l) {
    var t = (l - MIN_LUM) / (MAX_LUM - MIN_LUM);
    // Warm hue shift: 30° at extremes → 50° at midpoint
    var bgHue = 30 + Math.sin(t * Math.PI) * 20;
    // Saturation: low at extremes, peaks at mid
    var bgSat = 5 + Math.sin(t * Math.PI) * 25;
    var isLight = l > 55;

    // Foreground: near-black on light, near-white on dark
    var fgL = isLight ? 8 : 96;
    var surfaceL = isLight ? l - 10 : l + 10;
    // Accent: warm gold/amber
    var accH = 35;
    var accS = 70;
    var accL = isLight ? 35 : 70;

    root.style.setProperty('--lum', l);
    root.style.setProperty('--bg', 'hsl(' + bgHue.toFixed(0) + ', ' + bgSat.toFixed(0) + '%, ' + l + '%)');
    root.style.setProperty('--fg', 'hsl(30, 5%, ' + fgL + '%)');
    root.style.setProperty('--surface', 'hsl(' + bgHue.toFixed(0) + ', ' + bgSat.toFixed(0) + '%, ' + surfaceL.toFixed(0) + '%)');
    root.style.setProperty('--accent', 'hsl(' + accH + ', ' + accS + '%, ' + accL + '%)');
    root.style.setProperty('--border', isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.2)');
    root.style.setProperty('--nav-bg', isLight ? 'rgba(255,255,255,0.98)' : 'rgba(10,10,10,0.98)');

    // Update icon visibility
    if (sunIcon && moonIcon) {
      sunIcon.style.display = l > 50 ? '' : 'none';
      moonIcon.style.display = l > 50 ? 'none' : '';
    }

    // Update fill height
    if (rulerFill) {
      var pct = ((l - MIN_LUM) / (MAX_LUM - MIN_LUM)) * 100;
      rulerFill.style.height = pct + '%';
    }

    // Update ARIA
    if (rulerEl) {
      rulerEl.setAttribute('aria-valuenow', Math.round(l));
      rulerEl.setAttribute('aria-valuetext', 'Luminance ' + Math.round(l) + ' percent');
    }

    localStorage.setItem('lum', l);
  }

  function toggleRuler() {
    rulerVisible = !rulerVisible;
    if (rulerWrap) {
      rulerWrap.setAttribute('aria-hidden', rulerVisible ? 'false' : 'true');
    }
    if (brightnessBtn) {
      brightnessBtn.classList.toggle('toolbar__btn--active', rulerVisible);
    }
  }

  function updateFromPointer(clientY) {
    if (!rulerEl) return;
    var rect = rulerEl.getBoundingClientRect();
    var relY = Math.min(Math.max(0, rect.bottom - clientY), rect.height);
    lum = MIN_LUM + (relY / rect.height) * (MAX_LUM - MIN_LUM);
    applyTheme(lum);
  }

  function onMouseMove(e) { updateFromPointer(e.clientY); }
  function onTouchMove(e) {
    if (isDragging) e.preventDefault();
    updateFromPointer(e.touches[0].clientY);
  }
  function stopDrag() {
    isDragging = false;
    if (rulerFill) rulerFill.classList.remove('ruler__fill--dragging');
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', stopDrag);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', stopDrag);
    // Announce final value
    if (announcer) {
      announcer.textContent = 'Luminance set to ' + Math.round(lum) + ' percent';
    }
  }

  function startDrag(startY) {
    isDragging = true;
    if (rulerFill) rulerFill.classList.add('ruler__fill--dragging');
    updateFromPointer(startY);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
  }

  // Keyboard control for slider
  function onRulerKeyDown(e) {
    var step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      lum = Math.min(MAX_LUM, lum + step);
      applyTheme(lum);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      lum = Math.max(MIN_LUM, lum - step);
      applyTheme(lum);
    }
  }

  // Bind events
  if (brightnessBtn) {
    brightnessBtn.addEventListener('click', toggleRuler);
  }

  if (rulerEl) {
    rulerEl.addEventListener('mousedown', function (e) { startDrag(e.clientY); });
    rulerEl.addEventListener('touchstart', function (e) { startDrag(e.touches[0].clientY); }, { passive: true });
    rulerEl.addEventListener('keydown', onRulerKeyDown);
  }

  // Apply initial theme
  applyTheme(lum);

  // Listen for system color scheme changes
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function (e) {
      if (localStorage.getItem('lum') === null) {
        lum = e.matches ? 92 : MIN_LUM;
        applyTheme(lum);
      }
    });
  }
})();


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


/**
 * Navigation
 * No floating nav — page is a linear scroll document.
 * This file is kept for future use if needed.
 */


/**
 * Noise Texture
 * Generates a subtle grain overlay using canvas.
 * Fades out as the user scrolls down (full at top, gone by 40% of page).
 */
(function () {
  'use strict';

  var size = 200;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  if (!ctx) return;

  var imageData = ctx.createImageData(size, size);
  var data = imageData.data;

  for (var i = 0; i < data.length; i += 4) {
    var v = Math.floor(Math.random() * 255);
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);

  var noiseUrl = 'url(' + canvas.toDataURL('image/png') + ')';

  // Generate a subtler version for hover states (lower alpha per pixel)
  var hoverData = ctx.createImageData(size, size);
  var hd = hoverData.data;
  for (var j = 0; j < hd.length; j += 4) {
    var hv = Math.floor(Math.random() * 255);
    hd[j] = hv;
    hd[j + 1] = hv;
    hd[j + 2] = hv;
    hd[j + 3] = 12; // very faint hint
  }
  ctx.putImageData(hoverData, 0, 0);
  var noiseUrlSubtle = 'url(' + canvas.toDataURL('image/png') + ')';

  // Expose as CSS custom properties
  document.documentElement.style.setProperty('--noise-url', noiseUrl);
  document.documentElement.style.setProperty('--noise-url-subtle', noiseUrlSubtle);

  var overlay = document.createElement('div');
  overlay.id = 'noise-overlay';
  overlay.style.backgroundImage = noiseUrl;
  document.body.appendChild(overlay);

  // Fade out on scroll
  var MAX_OPACITY = 0.12;
  var ticking = false;

  function updateOpacity() {
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var fadeEnd = window.innerHeight * 0.8; // fully gone by ~80% of first viewport
    var t = Math.min(1, scrollTop / fadeEnd);
    overlay.style.opacity = (MAX_OPACITY * (1 - t)).toFixed(3);
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(updateOpacity);
      ticking = true;
    }
  }, { passive: true });

  updateOpacity();
})();
