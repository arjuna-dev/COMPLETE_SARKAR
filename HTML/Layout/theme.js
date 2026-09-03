/* EE7 theme sync — applies data-theme to <html> in any content frame */
(function () {
  var KEY = "ee7-theme";
  var VERSION_KEY = "ee7-theme-version";
  var THEMES = ["light", "dusk", "dark", "dawn"];

  function normalizeTheme(theme) {
    return THEMES.indexOf(theme) === -1 ? "dusk" : theme;
  }

  function apply(t) {
    document.documentElement.setAttribute("data-theme", normalizeTheme(t));
  }

  // Init: prefer localStorage (set by parent shell). Legacy dark was the
  // original brown theme, now named dusk.
  var t = "dusk";
  try {
    t = localStorage.getItem(KEY) || "dusk";
    if (!localStorage.getItem(VERSION_KEY) && t === "dark") t = "dusk";
  } catch (e) {}
  apply(t);

  // React to parent postMessage (theme toggle)
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "ee7-theme") {
      apply(e.data.theme);
      try {
        localStorage.setItem(KEY, e.data.theme);
      } catch (e2) {}
    }
  });
})();
