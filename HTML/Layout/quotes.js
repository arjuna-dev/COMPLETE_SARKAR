/* EE7 quotes - localStorage-backed text selections and persistent highlights. */
(function () {
  "use strict";

  var KEY = "ee7-quotes";
  var STYLE_ID = "ee7-quotes-style";
  var MENU_ID = "ee7-quote-selection-menu";

  var boundDocument = null;
  var boundWindow = null;
  var boundHandlers = null;
  var selectionMenu = null;
  var pendingSelection = null;

  function toStringSafe(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return toStringSafe(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function normalizeQuote(quote) {
    var text = toStringSafe(quote && quote.text)
      .replace(/\s+/g, " ")
      .trim();
    return {
      id: toStringSafe(quote && quote.id),
      href: normalizeHref(quote && quote.href),
      title: toStringSafe(quote && quote.title).trim(),
      text: text,
      startOffset: Math.max(0, Math.round(finiteNumber(quote && quote.startOffset, 0))),
      endOffset: Math.max(0, Math.round(finiteNumber(quote && quote.endOffset, 0))),
      createdAt: Math.max(0, finiteNumber(quote && quote.createdAt, Date.now())),
    };
  }

  function readQuotes() {
    var raw = "";
    try {
      raw = localStorage.getItem(KEY) || "";
    } catch (e) {}
    if (!raw) return [];

    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      var out = [];
      for (var i = 0; i < parsed.length; i++) {
        var quote = normalizeQuote(parsed[i]);
        if (!quote.id) quote.id = "quote-" + quote.createdAt + "-" + i;
        if (!quote.href || !quote.text || quote.endOffset <= quote.startOffset) {
          continue;
        }
        if (!quote.title) quote.title = quote.href;
        out.push(quote);
      }
      out.sort(function (a, b) {
        return b.createdAt - a.createdAt;
      });
      return out;
    } catch (e2) {
      return [];
    }
  }

  function writeQuotes(items) {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) {}
  }

  function notifyChange() {
    try {
      window.dispatchEvent(new CustomEvent("ee7-quotes-changed"));
    } catch (e) {}
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage({ type: "ee7-quotes-changed" }, "*");
      } catch (e2) {}
    }
  }

  function makeId() {
    var stamp = Date.now().toString(36);
    var random = Math.random().toString(36).slice(2, 8);
    return "quote-" + stamp + "-" + random;
  }

  function isReaderDocument(doc) {
    if (!doc || !doc.location) return false;
    var path = doc.location.pathname || "";
    return (
      path.indexOf("/Discourses/") !== -1 ||
      path.indexOf("/Books/") !== -1 ||
      path.indexOf("/Stories/") !== -1 ||
      path.indexOf("/Other-Spiritual-Books/") !== -1 ||
      path.indexOf("/Acharya-Philosophy/") !== -1
    );
  }

  function getPageHref(doc) {
    if (!doc || !doc.location) return "";
    return normalizeHref(doc.location.href);
  }

  function getReaderTitle(doc) {
    if (!doc) return "Untitled";
    var selectors = [
      ".discourse_title",
      ".book_title",
      "body > h1",
      "body h1",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var node = doc.querySelector(selectors[i]);
      if (node && node.textContent) {
        var title = node.textContent.replace(/\s+/g, " ").trim();
        if (title) return title;
      }
    }
    return (
      toStringSafe(doc.title)
        .replace(/^EE7\+\s*-\s*/i, "")
        .replace(/\s+-\s+(?:Baba stories|Other spiritual books)\s*$/i, "")
        .trim() || "Untitled"
    );
  }

  function isSelectableTextNode(doc, node) {
    if (!node || !node.nodeValue || !node.nodeValue.length) return false;
    var element = node.parentElement;
    while (element && element !== doc.body) {
      var tag = element.tagName && element.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "textarea") {
        return false;
      }
      if (
        element.id === MENU_ID ||
        (element.classList && element.classList.contains("ee7-quote-selection-menu"))
      ) {
        return false;
      }
      if (element.hasAttribute && element.hasAttribute("hidden")) return false;
      if (element.classList && element.classList.contains("discourse_box")) {
        var win = doc.defaultView;
        var style = win && win.getComputedStyle ? win.getComputedStyle(element) : null;
        if (style && style.display === "none") return false;
      }
      element = element.parentElement;
    }
    return true;
  }

  function textNodes(doc) {
    if (!doc || !doc.body || !doc.createTreeWalker) return [];
    var nodes = [];
    var walker = doc.createTreeWalker(doc.body, 4, null);
    var node = walker.nextNode();
    while (node) {
      if (isSelectableTextNode(doc, node)) nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function isDescendant(node, ancestor) {
    var current = node;
    while (current) {
      if (current === ancestor) return true;
      current = current.parentNode;
    }
    return false;
  }

  function pointOffset(doc, container, offset, nodes) {
    var total = 0;
    var i;
    if (container && container.nodeType === 3) {
      for (i = 0; i < nodes.length; i++) {
        if (nodes[i] === container) {
          return total + Math.min(container.nodeValue.length, Math.max(0, offset));
        }
        total += nodes[i].nodeValue.length;
      }
      return null;
    }

    if (!container) return null;
    var firstInside = -1;
    for (i = 0; i < nodes.length; i++) {
      if (isDescendant(nodes[i], container)) {
        firstInside = i;
        break;
      }
      total += nodes[i].nodeValue.length;
    }
    if (firstInside === -1) return total;

    var local = doc.createRange();
    try {
      local.selectNodeContents(container);
      local.setEnd(container, Math.max(0, Math.min(container.childNodes.length, offset)));
      return total + local.toString().length;
    } catch (e) {
      return total;
    }
  }

  function selectionSnapshot(doc) {
    if (!isReaderDocument(doc) || !doc.getSelection) return null;
    var selection = doc.getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
    var range = selection.getRangeAt(0);
    if (!doc.body.contains(range.commonAncestorContainer)) return null;
    var rawText = range.toString();
    if (!rawText || !rawText.trim()) return null;

    var nodes = textNodes(doc);
    var start = pointOffset(doc, range.startContainer, range.startOffset, nodes);
    var end = pointOffset(doc, range.endContainer, range.endOffset, nodes);
    if (start == null || end == null) return null;
    if (end < start) {
      var swap = start;
      start = end;
      end = swap;
    }

    var leading = rawText.search(/\S/);
    var trailingMatch = rawText.match(/\s+$/);
    var trailing = trailingMatch ? trailingMatch[0].length : 0;
    if (leading < 0) return null;
    start += leading;
    end -= trailing;
    if (end <= start) return null;

    return {
      text: rawText.slice(leading, rawText.length - trailing).replace(/\s+/g, " ").trim(),
      startOffset: start,
      endOffset: end,
      rect: range.getBoundingClientRect(),
    };
  }

  function wrapTextNodeSlice(doc, node, start, end, id) {
    if (!node || !node.parentNode || end <= start) return;
    var parent = node.parentElement;
    if (parent && parent.classList && parent.classList.contains("ee7-quote-highlight")) {
      return;
    }

    var target = node;
    if (start > 0) target = node.splitText(start);
    var selectedLength = end - start;
    if (selectedLength < target.nodeValue.length) target.splitText(selectedLength);

    var mark = doc.createElement("mark");
    mark.className = "ee7-quote-highlight";
    mark.setAttribute("data-ee7-quote-id", id);
    target.parentNode.replaceChild(mark, target);
    mark.appendChild(target);
  }

  function applyHighlightOffsets(doc, startOffset, endOffset, id) {
    if (!doc || !doc.body || endOffset <= startOffset) return false;
    var nodes = textNodes(doc);
    var total = 0;
    var wrapped = false;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var nodeStart = total;
      var nodeEnd = total + node.nodeValue.length;
      var overlapStart = Math.max(startOffset, nodeStart);
      var overlapEnd = Math.min(endOffset, nodeEnd);
      if (overlapEnd > overlapStart) {
        wrapTextNodeSlice(
          doc,
          node,
          overlapStart - nodeStart,
          overlapEnd - nodeStart,
          id,
        );
        wrapped = true;
      }
      total = nodeEnd;
      if (total >= endOffset) break;
    }
    return wrapped;
  }

  function normalizedTextIndex(doc, value) {
    var nodes = textNodes(doc);
    var normalized = "";
    var rawIndexes = [];
    var rawOffset = 0;
    var previousWasSpace = false;
    for (var i = 0; i < nodes.length; i++) {
      var content = nodes[i].nodeValue;
      for (var j = 0; j < content.length; j++) {
        var character = content.charAt(j);
        if (/\s/.test(character)) {
          if (!previousWasSpace) {
            normalized += " ";
            rawIndexes.push(rawOffset + j);
          }
          previousWasSpace = true;
        } else {
          normalized += character;
          rawIndexes.push(rawOffset + j);
          previousWasSpace = false;
        }
      }
      rawOffset += content.length;
    }
    normalized = normalized.trim();
    var needle = toStringSafe(value).replace(/\s+/g, " ").trim();
    var index = normalized.indexOf(needle);
    if (index === -1 || !needle) return null;
    var start = rawIndexes[index];
    var endIndex = index + needle.length - 1;
    var end = rawIndexes[endIndex] + 1;
    return { startOffset: start, endOffset: end };
  }

  function clearHighlights(doc) {
    if (!doc || !doc.querySelectorAll) return;
    var marks = doc.querySelectorAll("mark.ee7-quote-highlight");
    for (var i = marks.length - 1; i >= 0; i--) {
      var mark = marks[i];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      if (parent.normalize) parent.normalize();
    }
  }

  function quotesForHref(href) {
    href = normalizeHref(href);
    return readQuotes().filter(function (quote) {
      return quote.href === href;
    });
  }

  function applyHighlights(doc) {
    if (!isReaderDocument(doc)) return;
    var href = getPageHref(doc);
    var items = quotesForHref(href).sort(function (a, b) {
      return b.startOffset - a.startOffset;
    });
    for (var i = 0; i < items.length; i++) {
      var quote = items[i];
      var offsets = {
        startOffset: quote.startOffset,
        endOffset: quote.endOffset,
      };
      var allText = textNodes(doc).reduce(function (length, node) {
        return length + node.nodeValue.length;
      }, 0);
      if (
        offsets.startOffset < 0 ||
        offsets.endOffset > allText ||
        offsets.endOffset <= offsets.startOffset
      ) {
        offsets = normalizedTextIndex(doc, quote.text);
      }
      if (!offsets) continue;
      applyHighlightOffsets(doc, offsets.startOffset, offsets.endOffset, quote.id);
    }
  }

  function injectStyle(doc) {
    if (!doc || !doc.head || doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      'html[data-theme="dusk"]{--ee7-quote-highlight-bg:rgba(224,120,32,.28);--ee7-quote-highlight-text:inherit}' +
      'html[data-theme="light"]{--ee7-quote-highlight-bg:rgba(192,96,16,.22);--ee7-quote-highlight-text:inherit}' +
      'html[data-theme="dark"]{--ee7-quote-highlight-bg:rgba(239,139,50,.3);--ee7-quote-highlight-text:inherit}' +
      'html[data-theme="dawn"]{--ee7-quote-highlight-bg:rgba(255,244,218,.42);--ee7-quote-highlight-text:#321607}' +
      ".ee7-quote-highlight{background:var(--ee7-quote-highlight-bg,rgba(224,120,32,.28));color:var(--ee7-quote-highlight-text,inherit);border-radius:.18em;box-shadow:0 .08em 0 rgba(224,120,32,.18);padding:.02em .08em;-webkit-box-decoration-break:clone;box-decoration-break:clone}" +
      ".ee7-quote-selection-menu{position:fixed;z-index:2147483000;display:flex;align-items:center;padding:4px;background:var(--surface,#352f28);border:1px solid var(--border,#4a3c30);border-radius:7px;box-shadow:0 7px 22px rgba(0,0,0,.25);font:10pt/1.2 Tahoma,Arial,sans-serif;white-space:nowrap}" +
      ".ee7-quote-selection-menu button{border:0;border-radius:4px;background:var(--accent,#e07820);color:#fff7ec;cursor:pointer;font:700 9pt/1 Tahoma,Arial,sans-serif;padding:8px 11px}" +
      ".ee7-quote-selection-menu button:hover{filter:brightness(1.08)}" +
      ".ee7-quote-selection-menu button:focus-visible{outline:2px solid var(--accent,#e07820);outline-offset:2px}" +
      "@media(prefers-reduced-motion:reduce){.ee7-quote-selection-menu button{transition:none}}";
    doc.head.appendChild(style);
  }

  function removeSelectionMenu() {
    if (selectionMenu && selectionMenu.parentNode) {
      selectionMenu.parentNode.removeChild(selectionMenu);
    }
    selectionMenu = null;
    pendingSelection = null;
  }

  function positionSelectionMenu(doc, rect) {
    if (!selectionMenu || !rect) return;
    var win = doc.defaultView;
    var viewportWidth = (win && win.innerWidth) || doc.documentElement.clientWidth || 0;
    var viewportHeight = (win && win.innerHeight) || doc.documentElement.clientHeight || 0;
    var menuWidth = selectionMenu.offsetWidth || 120;
    var menuHeight = selectionMenu.offsetHeight || 34;
    var left = rect.left + rect.width / 2 - menuWidth / 2;
    left = Math.max(8, Math.min(left, viewportWidth - menuWidth - 8));
    var top = rect.bottom + 10;
    if (top + menuHeight > viewportHeight - 8) top = rect.top - menuHeight - 10;
    top = Math.max(8, top);
    selectionMenu.style.left = Math.round(left) + "px";
    selectionMenu.style.top = Math.round(top) + "px";
  }

  function saveQuote(doc, snapshot, options) {
    if (!snapshot || !snapshot.text || !isReaderDocument(doc)) return null;
    var href = getPageHref(doc);
    var title = (options && options.title) || getReaderTitle(doc);
    var items = readQuotes();
    for (var i = 0; i < items.length; i++) {
      if (
        items[i].href === href &&
        items[i].startOffset === snapshot.startOffset &&
        items[i].endOffset === snapshot.endOffset &&
        items[i].text === snapshot.text
      ) {
        applyHighlightOffsets(doc, items[i].startOffset, items[i].endOffset, items[i].id);
        return { quote: items[i], alreadySaved: true };
      }
    }

    var quote = {
      id: makeId(),
      href: href,
      title: title,
      text: snapshot.text,
      startOffset: snapshot.startOffset,
      endOffset: snapshot.endOffset,
      createdAt: Date.now(),
    };
    items.unshift(quote);
    writeQuotes(items);
    applyHighlightOffsets(doc, quote.startOffset, quote.endOffset, quote.id);
    notifyChange();
    return { quote: quote, alreadySaved: false };
  }

  function showSelectionMenu(doc, options) {
    removeSelectionMenu();
    var snapshot = selectionSnapshot(doc);
    if (!snapshot) return;
    pendingSelection = { doc: doc, snapshot: snapshot, options: options || {} };
    injectStyle(doc);

    var menu = doc.createElement("div");
    menu.id = MENU_ID;
    menu.className = "ee7-quote-selection-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = '<button type="button" role="menuitem">Save quote</button>';
    menu.addEventListener("mousedown", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    menu.querySelector("button").addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!pendingSelection) return;
      var state = pendingSelection;
      var result = saveQuote(state.doc, state.snapshot, state.options);
      removeSelectionMenu();
      var selection = state.doc.getSelection && state.doc.getSelection();
      if (selection && selection.removeAllRanges) selection.removeAllRanges();
      if (result && typeof state.options.onSaved === "function") {
        state.options.onSaved(result.quote, result.alreadySaved);
      }
    });
    doc.body.appendChild(menu);
    selectionMenu = menu;
    positionSelectionMenu(doc, snapshot.rect);
  }

  function unbindReaderDocument() {
    if (boundDocument && boundHandlers) {
      boundDocument.removeEventListener("mouseup", boundHandlers.mouseup);
      boundDocument.removeEventListener("touchend", boundHandlers.touchend);
      boundDocument.removeEventListener("mousedown", boundHandlers.mousedown);
      boundDocument.removeEventListener("keydown", boundHandlers.keydown);
      boundDocument.removeEventListener("scroll", boundHandlers.scroll, true);
    }
    if (boundWindow && boundHandlers && boundHandlers.resize) {
      boundWindow.removeEventListener("resize", boundHandlers.resize);
    }
    removeSelectionMenu();
    boundDocument = null;
    boundWindow = null;
    boundHandlers = null;
  }

  function bindReaderDocument(doc, options) {
    unbindReaderDocument();
    if (!isReaderDocument(doc) || !doc.body) return;
    injectStyle(doc);
    applyHighlights(doc);
    var config = options || {};
    var scheduleTimer = null;
    var handleSelection = function () {
      clearTimeout(scheduleTimer);
      scheduleTimer = setTimeout(function () {
        showSelectionMenu(doc, config);
      }, 0);
    };
    var handlers = {
      mouseup: handleSelection,
      touchend: handleSelection,
      mousedown: function (event) {
        var target = event.target;
        if (
          !target ||
          !target.closest ||
          !target.closest("." + "ee7-quote-selection-menu")
        ) {
          removeSelectionMenu();
        }
      },
      keydown: function (event) {
        if (event.key === "Escape") removeSelectionMenu();
      },
      scroll: function () {
        removeSelectionMenu();
      },
      resize: function () {
        if (selectionMenu && pendingSelection) {
          positionSelectionMenu(doc, pendingSelection.snapshot.rect);
        }
      },
    };
    doc.addEventListener("mouseup", handlers.mouseup);
    doc.addEventListener("touchend", handlers.touchend, { passive: true });
    doc.addEventListener("mousedown", handlers.mousedown);
    doc.addEventListener("keydown", handlers.keydown);
    doc.addEventListener("scroll", handlers.scroll, true);
    var win = doc.defaultView;
    if (win) win.addEventListener("resize", handlers.resize);
    boundDocument = doc;
    boundWindow = win;
    boundHandlers = handlers;
  }

  function refreshReaderHighlights(doc) {
    if (!isReaderDocument(doc)) return;
    clearHighlights(doc);
    applyHighlights(doc);
  }

  function deleteQuote(id) {
    id = toStringSafe(id);
    var items = readQuotes();
    var next = items.filter(function (quote) {
      return quote.id !== id;
    });
    if (next.length === items.length) return false;
    writeQuotes(next);
    notifyChange();
    return true;
  }

  function renderQuotesPage(container, emptyMessage) {
    var items = readQuotes();
    if (!container) return items;
    if (!items.length) {
      container.innerHTML =
        '<div class="quotes-empty">' +
        escapeHtml(
          emptyMessage ||
            "No quotes yet. Select a passage in a book or discourse to save it here.",
        ) +
        "</div>";
      return items;
    }

    var html = "";
    for (var i = 0; i < items.length; i++) {
      var quote = items[i];
      html +=
        '<article class="quote-card" data-quote-id="' +
        escapeHtml(quote.id) +
        '">' +
        '<blockquote class="quote-text">' +
        escapeHtml(quote.text) +
        "</blockquote>" +
        '<div class="quote-card-footer">' +
        '<a class="quote-source" href="' +
        escapeHtml(quote.href) +
        '" target="Client">' +
        escapeHtml(quote.title) +
        "</a>" +
        '<button class="quote-delete" type="button" data-quote-delete="' +
        escapeHtml(quote.id) +
        '" aria-label="Delete quote">Delete</button>' +
        "</div></article>";
    }
    container.innerHTML = html;
    return items;
  }

  injectStyle(document);

  window.EE7Quotes = {
    key: KEY,
    normalizeHref: normalizeHref,
    readQuotes: readQuotes,
    writeQuotes: writeQuotes,
    deleteQuote: deleteQuote,
    bindReaderDocument: bindReaderDocument,
    unbindReaderDocument: unbindReaderDocument,
    refreshReaderHighlights: refreshReaderHighlights,
    renderQuotesPage: renderQuotesPage,
    isReaderDocument: isReaderDocument,
    getReaderTitle: getReaderTitle,
  };

  window.addEventListener("storage", function (event) {
    if (event && event.key === KEY) {
      if (boundDocument) refreshReaderHighlights(boundDocument);
      try {
        window.dispatchEvent(new CustomEvent("ee7-quotes-changed"));
      } catch (e) {}
    }
  });
})();
