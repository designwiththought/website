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
