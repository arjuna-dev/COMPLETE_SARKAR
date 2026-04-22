/* EE7 favorites — localStorage-backed favorites and UI helpers. */
(function () {
  "use strict";

  var KEY = "ee7-favorites";
  var STYLE_ID = "ee7-favorites-style";

  function toStringSafe(value) {
    return value == null ? "" : String(value);
  }

  function normalizeHref(href) {
    href = toStringSafe(href);
    if (!href) return "";

    try {
      var url = new URL(href, document.baseURI);
      href = url.pathname;
      var idx = href.indexOf("/HTML/");
      if (idx !== -1) {
        href = href.slice(idx + 6);
      } else {
        href = href.replace(/^\/+/, "");
      }
      return href;
    } catch (e) {
      var idx2 = href.indexOf("/HTML/");
      if (idx2 !== -1) href = href.slice(idx2 + 6);
      href = href.replace(/[?#].*$/, "");
      return href.replace(/^\/+/, "");
    }
  }

  function normalizeEntry(entry) {
    return {
      href: normalizeHref(entry && entry.href),
      title: toStringSafe(entry && entry.title).trim(),
    };
  }

  function escapeHtml(s) {
    return toStringSafe(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function readFavorites() {
    var raw = "";
    try {
      raw = localStorage.getItem(KEY) || "";
    } catch (e) {}
    if (!raw) return [];

    try {
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.length) return [];
      var out = [];
      for (var i = 0; i < parsed.length; i++) {
        var item = normalizeEntry(parsed[i]);
        if (!item.href) continue;
        if (!item.title) item.title = item.href;
        out.push(item);
      }
      return out;
    } catch (e2) {
      return [];
    }
  }

  function writeFavorites(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {}
  }

  function findFavoriteIndex(items, href) {
    href = normalizeHref(href);
    for (var i = 0; i < items.length; i++) {
      if (items[i].href === href) return i;
    }
    return -1;
  }

  function isFavorite(href) {
    return findFavoriteIndex(readFavorites(), href) !== -1;
  }

  function setFavorite(entry, shouldFavorite) {
    entry = normalizeEntry(entry);
    if (!entry.href) return readFavorites();

    var items = readFavorites();
    var idx = findFavoriteIndex(items, entry.href);

    if (shouldFavorite) {
      if (idx === -1) {
        items.unshift(entry);
      } else {
        items[idx] = entry;
      }
    } else if (idx !== -1) {
      items.splice(idx, 1);
    }

    writeFavorites(items);
    return items;
  }

  function toggleFavorite(entry) {
    entry = normalizeEntry(entry);
    if (!entry.href) return false;

    var items = readFavorites();
    var idx = findFavoriteIndex(items, entry.href);
    var nowFavorite = idx === -1;

    if (nowFavorite) {
      items.unshift(entry);
    } else {
      items.splice(idx, 1);
    }

    writeFavorites(items);
    return nowFavorite;
  }

  function removeFavorite(href) {
    setFavorite({ href: href, title: href }, false);
  }

  function starSvg(active) {
    if (active) {
      return (
        '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">' +
        '<path d="M8 1.6l1.7 3.44 3.8.55-2.75 2.68.65 3.79L8 10.28 4.6 12.06l.65-3.79L2.5 5.59l3.8-.55L8 1.6z"/>' +
        "</svg>"
      );
    }
    return (
      '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 1.6l1.7 3.44 3.8.55-2.75 2.68.65 3.79L8 10.28 4.6 12.06l.65-3.79L2.5 5.59l3.8-.55L8 1.6z"/>' +
      "</svg>"
    );
  }

  function buttonLabel(active) {
    return active ? "Remove from favorites" : "Add to favorites";
  }

  function createButton(entry, options) {
    entry = normalizeEntry(entry);
    options = options || {};

    var button = document.createElement("button");
    button.type = "button";
    button.className = "ee7-favorite-toggle";
    if (options.compact) button.className += " ee7-favorite-toggle--compact";
    if (options.floater) button.className += " ee7-favorite-toggle--floater";
    button.setAttribute("data-ee7-favorite-href", entry.href);
    button.setAttribute("data-ee7-favorite-title", entry.title || entry.href);
    button.setAttribute("aria-label", buttonLabel(isFavorite(entry.href)));
    button.setAttribute("aria-pressed", isFavorite(entry.href) ? "true" : "false");
    button.title = buttonLabel(isFavorite(entry.href));
    button.innerHTML = starSvg(isFavorite(entry.href));
    return button;
  }

  function favoriteButtonHtml(entry, options) {
    return createButton(entry, options).outerHTML;
  }

  function updateButton(button) {
    var href = button.getAttribute("data-ee7-favorite-href");
    var title = button.getAttribute("data-ee7-favorite-title") || href;
    var active = isFavorite(href);
    button.classList.toggle("is-favorite", active);
    button.setAttribute("aria-label", buttonLabel(active));
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.title = buttonLabel(active);
    button.setAttribute("data-ee7-favorite-title", title);
    button.innerHTML = starSvg(active);
  }

  function wireButton(button, root) {
    if (!button || button.__ee7FavoritesBound) return;
    button.__ee7FavoritesBound = true;
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!window.EE7Favorites) return;
      window.EE7Favorites.toggleFavorite({
        href: button.getAttribute("data-ee7-favorite-href"),
        title: button.getAttribute("data-ee7-favorite-title"),
      });
      updateButton(button);
      syncFavoriteButtons(root || document);
      if (typeof window.EE7FavoritesOnChange === "function") {
        window.EE7FavoritesOnChange();
      }
    });
  }

  function syncFavoriteButtons(root) {
    root = root || document;
    var buttons = root.querySelectorAll(".ee7-favorite-toggle[data-ee7-favorite-href]");
    for (var i = 0; i < buttons.length; i++) updateButton(buttons[i]);
  }

  function injectStyle(doc) {
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".ee7-favorite-toggle{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid var(--border);background:var(--bg);color:var(--text-dim);cursor:pointer;transition:border-color .15s,color .15s,background .15s,transform .15s;padding:0;line-height:1}" +
      ".ee7-favorite-toggle:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}" +
      ".ee7-favorite-toggle.is-favorite{border-color:var(--accent);background:var(--accent-dim);color:var(--accent)}" +
      ".ee7-favorite-toggle svg{display:block}" +
      ".ee7-favorite-toggle--compact{width:22px;height:22px;border-radius:999px}" +
      ".ee7-favorite-toggle--compact svg{width:11px;height:11px}" +
      ".ee7-favorite-toggle--floater{width:34px;height:34px;border-radius:999px;box-shadow:0 3px 12px rgba(0,0,0,.18)}" +
      ".ee7-favorite-toggle--floater svg{width:15px;height:15px}" +
      ".ee7-favorites-floater{position:fixed;top:14px;right:14px;z-index:9999}";
    doc.head.appendChild(style);
  }

  function getDiscourseTitle(doc) {
    var el = doc.querySelector(".discourse_title");
    if (el && el.textContent) return el.textContent.replace(/\s+/g, " ").trim();
    var title = toStringSafe(doc.title).replace(/^EE7\+\s*-\s*/, "");
    return title.trim() || "Untitled";
  }

  function decorateDiscoursePage(doc) {
    if (!doc || !doc.body || !doc.location) return;
    if (doc.location.pathname.indexOf("/Discourses/") === -1) return;

    injectStyle(doc);

    var href = normalizeHref(doc.location.href);
    var title = getDiscourseTitle(doc);
    var existing = doc.getElementById("ee7-favorites-floater");

    if (!existing) {
      var wrap = doc.createElement("div");
      wrap.id = "ee7-favorites-floater";
      wrap.className = "ee7-favorites-floater";
      var button = createButton({ href: href, title: title }, { floater: true });
      wireButton(button, doc);
      wrap.appendChild(button);
      doc.body.appendChild(wrap);
    } else {
      var button = existing.querySelector(".ee7-favorite-toggle");
      if (!button) {
        existing.innerHTML = "";
        button = createButton({ href: href, title: title }, { floater: true });
        wireButton(button, doc);
        existing.appendChild(button);
      } else {
        button.setAttribute("data-ee7-favorite-href", href);
        button.setAttribute("data-ee7-favorite-title", title);
        updateButton(button);
        wireButton(button, doc);
      }
    }

    syncFavoriteButtons(doc);
  }

  function renderFavoritesPage(container, emptyMessage) {
    var items = readFavorites();
    if (!container) return items;

    if (!items.length) {
      container.innerHTML =
        '<div class="favorites-empty">' +
        escapeHtml(emptyMessage || "No favorites yet.") +
        "</div>";
      return items;
    }

    var html = "";
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      html +=
        '<div class="favorite-row">' +
        '<div class="favorite-main">' +
        '<a class="favorite-title" href="' +
        escapeHtml(item.href) +
        '" target="Client">' +
        escapeHtml(item.title || item.href) +
        "</a>" +
        '<div class="favorite-href">' +
        escapeHtml(item.href) +
        "</div>" +
        "</div>" +
        '<div class="favorite-actions">' +
        favoriteButtonHtml({ href: item.href, title: item.title }, { compact: true }) +
        "</div>" +
        "</div>";
    }
    container.innerHTML = html;
    syncFavoriteButtons(container);
    return items;
  }

  window.EE7Favorites = {
    key: KEY,
    normalizeHref: normalizeHref,
    readFavorites: readFavorites,
    writeFavorites: writeFavorites,
    isFavorite: isFavorite,
    setFavorite: setFavorite,
    toggleFavorite: toggleFavorite,
    removeFavorite: removeFavorite,
    favoriteButtonHtml: favoriteButtonHtml,
    createButton: createButton,
    updateButton: updateButton,
    syncFavoriteButtons: syncFavoriteButtons,
    decorateDiscoursePage: decorateDiscoursePage,
    renderFavoritesPage: renderFavoritesPage,
    getDiscourseTitle: getDiscourseTitle,
  };

  window.addEventListener("storage", function (e) {
    if (e && e.key === KEY) {
      syncFavoriteButtons(document);
      if (typeof window.EE7FavoritesOnChange === "function") {
        window.EE7FavoritesOnChange();
      }
    }
  });
})();
