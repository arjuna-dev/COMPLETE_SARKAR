/* EE7 reading state - localStorage-backed discourse positions. */
(function () {
  "use strict";

  var KEY = "ee7-currently-reading";
  var LIMIT = 5;

  function toStringSafe(value) {
    return value == null ? "" : String(value);
  }

  function normalizeHref(href) {
    href = toStringSafe(href);
    if (!href) return "";

    try {
      var url = new URL(href, document.baseURI);
      var path = url.pathname;
      var idx = path.indexOf("/HTML/");
      if (idx !== -1) path = path.slice(idx + 6);
      else path = path.replace(/^\/+/, "");
      return path.replace(/^\/+/, "");
    } catch (e) {
      var fallback = href.replace(/[?#].*$/, "");
      var fallbackIndex = fallback.indexOf("/HTML/");
      if (fallbackIndex !== -1) fallback = fallback.slice(fallbackIndex + 6);
      return fallback.replace(/^\/+/, "");
    }
  }

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function normalizeEntry(entry) {
    var progress = finiteNumber(entry && entry.progress, 0);
    return {
      href: normalizeHref(entry && entry.href),
      title: toStringSafe(entry && entry.title).trim(),
      scrollTop: Math.max(0, finiteNumber(entry && entry.scrollTop, 0)),
      scrollHeight: Math.max(0, finiteNumber(entry && entry.scrollHeight, 0)),
      viewportHeight: Math.max(0, finiteNumber(entry && entry.viewportHeight, 0)),
      progress: Math.min(1, Math.max(0, progress)),
      updatedAt: Math.max(0, finiteNumber(entry && entry.updatedAt, Date.now())),
    };
  }

  function read() {
    var raw = "";
    try {
      raw = localStorage.getItem(KEY) || "";
    } catch (e) {}
    if (!raw) return [];

    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var seen = Object.create(null);
      var items = [];
      for (var i = 0; i < parsed.length; i++) {
        var item = normalizeEntry(parsed[i]);
        if (!item.href || seen[item.href]) continue;
        seen[item.href] = true;
        if (!item.title) item.title = item.href;
        items.push(item);
      }
      items.sort(function (a, b) {
        return b.updatedAt - a.updatedAt;
      });
      return items.slice(0, LIMIT);
    } catch (e2) {
      return [];
    }
  }

  function write(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items.slice(0, LIMIT)));
    } catch (e) {}
  }

  function findIndex(items, href) {
    href = normalizeHref(href);
    for (var i = 0; i < items.length; i++) {
      if (items[i].href === href) return i;
    }
    return -1;
  }

  function notifyChange() {
    try {
      window.dispatchEvent(new CustomEvent("ee7-reading-changed"));
    } catch (e) {}
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: "ee7-reading-changed" }, "*");
      } catch (e2) {}
    }
  }

  function save(entry) {
    var normalized = normalizeEntry(entry);
    if (!normalized.href) return read();

    var items = read();
    var index = findIndex(items, normalized.href);
    if (index !== -1) items.splice(index, 1);
    if (!normalized.title) normalized.title = normalized.href;
    normalized.updatedAt = Date.now();
    items.unshift(normalized);
    items = items.slice(0, LIMIT);
    write(items);
    notifyChange();
    return items;
  }

  function find(href) {
    var items = read();
    var index = findIndex(items, href);
    return index === -1 ? null : items[index];
  }

  function touch(href, title) {
    var items = read();
    var index = findIndex(items, href);
    if (index === -1) return null;
    var item = items.splice(index, 1)[0];
    if (title) item.title = toStringSafe(title).trim() || item.title;
    item.updatedAt = Date.now();
    items.unshift(item);
    write(items);
    notifyChange();
    return item;
  }

  function remove(href) {
    var items = read();
    var index = findIndex(items, href);
    if (index === -1) return false;
    items.splice(index, 1);
    write(items);
    notifyChange();
    return true;
  }

  function clear() {
    var items = read();
    if (!items.length) return false;
    write([]);
    notifyChange();
    return true;
  }

  window.EE7ReadingState = {
    key: KEY,
    limit: LIMIT,
    normalizeHref: normalizeHref,
    read: read,
    write: write,
    save: save,
    find: find,
    touch: touch,
    remove: remove,
    clear: clear,
  };

  window.addEventListener("storage", function (e) {
    if (e && e.key === KEY) {
      try {
        window.dispatchEvent(new CustomEvent("ee7-reading-changed"));
      } catch (err) {}
    }
  });
})();
