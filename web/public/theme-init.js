// Same-origin first-paint bootstrap script (compliant with strict `script-src 'self'` CSP):
// synchronously applies persisted theme and locale attributes to prevent FOUC without hardcoding locale lists.
(function () {
  var root = document.documentElement;
  var mode = 'dark';
  try {
    var raw = localStorage.getItem('pikbay:v1:theme');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 1 && typeof parsed.data === 'string' && /^[a-z][a-z0-9-]{1,23}$/.test(parsed.data)) {
        mode = parsed.data;
      }
    }
  } catch (_) {
    // Ignore storage access errors
  }

  var resolved = mode;
  if (mode === 'system') {
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    resolved = prefersLight ? 'light' : 'dark';
  }

  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', mode);

  try {
    var rawLocale = localStorage.getItem('pikbay:v1:locale');
    if (rawLocale) {
      var parsedLocale = JSON.parse(rawLocale);
      if (
        parsedLocale &&
        parsedLocale.v === 1 &&
        typeof parsedLocale.data === 'string' &&
        /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(parsedLocale.data)
      ) {
        root.setAttribute('lang', parsedLocale.data);
      }
    }
  } catch (_) {
    // Ignore storage access errors
  }
})();
