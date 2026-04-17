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
