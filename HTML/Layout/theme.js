/* EE7 theme sync — applies data-theme to <html> in any content frame */
(function () {
  var KEY = "ee7-theme";
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t || "dark");
  }
  // Init: prefer localStorage (set by parent shell)
  var t = "dark";
  try {
    t = localStorage.getItem(KEY) || "dark";
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
