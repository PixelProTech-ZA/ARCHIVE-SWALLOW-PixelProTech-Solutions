/* PWA glue: service worker + install button. External file because CSP blocks inline scripts. */
(function () {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./service-worker.js').catch(function (e) { console.warn('SW failed', e); });
    });
  }
  var btn = document.getElementById('btn-install');
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e; if (btn) btn.hidden = false;
  });
  if (btn) btn.addEventListener('click', async function () {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch (_) {}
    deferred = null; btn.hidden = true;
  });
  window.addEventListener('appinstalled', function () { if (btn) btn.hidden = true; });
})();
