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
