/* EE7 quotes - localStorage-backed text selections and persistent highlights. */
(function () {
  "use strict";

  var KEY = "ee7-quotes";
  var STYLE_ID = "ee7-quotes-style";
  var MENU_ID = "ee7-quote-selection-menu";
  var MAX_QUOTE_WORDS = 2000;

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

  function normalizeQuoteText(value) {
    return toStringSafe(value).replace(/\s+/g, " ").trim();
  }

  function quoteWordCount(value) {
    var text = normalizeQuoteText(value);
    return text ? text.split(/\s+/).length : 0;
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
    var text = normalizeQuoteText(quote && quote.text);
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

  function closestHighlight(node) {
    var element = node && node.nodeType === 1 ? node : node && node.parentElement;
    return element && element.closest
      ? element.closest("mark.ee7-quote-highlight")
      : null;
  }

  function quoteIdForRange(range) {
    var startMark = closestHighlight(range && range.startContainer);
    var endMark = closestHighlight(range && range.endContainer);
    if (!startMark || startMark !== endMark) return "";
    return toStringSafe(startMark.getAttribute("data-ee7-quote-id"));
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

    var text = normalizeQuoteText(rawText);
    if (!text) return null;

    return {
      text: text,
      startOffset: start,
      endOffset: end,
      rect: range.getBoundingClientRect(),
      range: range.cloneRange(),
      quoteId: quoteIdForRange(range),
    };
  }

  function wrapTextNodeSlice(doc, node, start, end, id) {
    if (!node || !node.parentNode || end <= start) return false;
    var parent = node.parentElement;
    if (parent && parent.classList && parent.classList.contains("ee7-quote-highlight")) {
      return false;
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
    return true;
  }

  function applyHighlightRange(doc, sourceRange, id) {
    if (!doc || !doc.body || !sourceRange || sourceRange.collapsed) return false;
    var range = sourceRange.cloneRange();
    var rangeApi = doc.defaultView && doc.defaultView.Range;
    var startToEnd = rangeApi ? rangeApi.START_TO_END : 1;
    var endToStart = rangeApi ? rangeApi.END_TO_START : 3;
    var nodes = textNodes(doc);
    var slices = [];

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var nodeRange = doc.createRange();
      nodeRange.selectNodeContents(node);
      var intersects = false;
      try {
        if (range.intersectsNode) {
          intersects = range.intersectsNode(node);
        } else {
          intersects =
            range.compareBoundaryPoints(startToEnd, nodeRange) < 0 &&
            range.compareBoundaryPoints(endToStart, nodeRange) > 0;
        }
      } catch (e) {
        continue;
      }
      if (!intersects) continue;

      var start = node === range.startContainer ? range.startOffset : 0;
      var end = node === range.endContainer ? range.endOffset : node.nodeValue.length;
      start = Math.max(0, Math.min(node.nodeValue.length, start));
      end = Math.max(0, Math.min(node.nodeValue.length, end));
      if (end > start && /\S/.test(node.nodeValue)) {
        slices.push({ node: node, start: start, end: end });
      }
    }

    var wrapped = false;
    for (var j = slices.length - 1; j >= 0; j--) {
      wrapped =
        wrapTextNodeSlice(
          doc,
          slices[j].node,
          slices[j].start,
          slices[j].end,
          id,
        ) || wrapped;
    }
    return wrapped;
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
        wrapped =
          wrapTextNodeSlice(
            doc,
            node,
            overlapStart - nodeStart,
            overlapEnd - nodeStart,
            id,
          ) || wrapped;
      }
      total = nodeEnd;
      if (total >= endOffset) break;
    }
    return wrapped;
  }

  var BLOCK_TAGS = {
    ADDRESS: true,
    ARTICLE: true,
    ASIDE: true,
    BLOCKQUOTE: true,
    DIV: true,
    DL: true,
    FIELDSET: true,
    FIGURE: true,
    FOOTER: true,
    FORM: true,
    H1: true,
    H2: true,
    H3: true,
    H4: true,
    H5: true,
    H6: true,
    HEADER: true,
    HR: true,
    LI: true,
    MAIN: true,
    NAV: true,
    OL: true,
    P: true,
    PRE: true,
    SECTION: true,
    TABLE: true,
    UL: true,
  };

  function blockAncestor(doc, node) {
    var element = node && node.parentElement;
    while (element && element !== doc.body) {
      if (BLOCK_TAGS[element.tagName]) return element;
      element = element.parentElement;
    }
    return doc.body;
  }

  function normalizedTextMap(doc) {
    var nodes = textNodes(doc);
    var entries = [];
    var rawOffset = 0;
    var previousNode = null;
    var previousWasSpace = false;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var content = node.nodeValue;
      if (
        previousNode &&
        content &&
        !previousWasSpace &&
        !/\s/.test(content.charAt(0)) &&
        blockAncestor(doc, previousNode) !== blockAncestor(doc, node)
      ) {
        entries.push({
          character: " ",
          node: previousNode,
          offset: previousNode.nodeValue.length,
          rawOffset: rawOffset,
        });
        previousWasSpace = true;
      }

      for (var j = 0; j < content.length; j++) {
        var character = content.charAt(j);
        if (/\s/.test(character)) {
          if (!previousWasSpace) {
            entries.push({
              character: " ",
              node: node,
              offset: j,
              rawOffset: rawOffset + j,
            });
          }
          previousWasSpace = true;
        } else {
          entries.push({
            character: character,
            node: node,
            offset: j,
            rawOffset: rawOffset + j,
          });
          previousWasSpace = false;
        }
      }
      rawOffset += content.length;
      previousNode = node;
    }

    while (entries.length && entries[0].character === " ") entries.shift();
    while (entries.length && entries[entries.length - 1].character === " ") {
      entries.pop();
    }
    return {
      entries: entries,
      text: entries
        .map(function (entry) {
          return entry.character;
        })
        .join(""),
    };
  }

  function findTextRange(doc, value, preferredOffset) {
    var needle = normalizeQuoteText(value);
    if (!needle) return null;
    var map = normalizedTextMap(doc);
    var index = map.text.indexOf(needle);
    var bestIndex = -1;
    var bestDistance = Infinity;
    while (index !== -1) {
      var distance =
        typeof preferredOffset === "number"
          ? Math.abs(map.entries[index].rawOffset - preferredOffset)
          : index;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
      index = map.text.indexOf(needle, index + 1);
    }
    if (bestIndex === -1) return null;

    var first = map.entries[bestIndex];
    var last = map.entries[bestIndex + needle.length - 1];
    if (!first || !last) return null;
    var range = doc.createRange();
    try {
      range.setStart(first.node, first.offset);
      range.setEnd(last.node, last.offset + 1);
    } catch (e) {
      return null;
    }
    return {
      range: range,
      startOffset: first.rawOffset,
      endOffset: last.rawOffset + 1,
    };
  }

  function normalizedTextIndex(doc, value, preferredOffset) {
    var match = findTextRange(doc, value, preferredOffset);
    return match
      ? { startOffset: match.startOffset, endOffset: match.endOffset }
      : null;
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
      var textMatch = findTextRange(doc, quote.text, quote.startOffset);
      if (textMatch && applyHighlightRange(doc, textMatch.range, quote.id)) {
        continue;
      }
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
      ".ee7-quote-selection-menu button{border:1px solid rgba(255,255,255,.14);border-radius:4px;background:#30363a;color:#f7f4ec;cursor:pointer;font:700 9pt/1 Tahoma,Arial,sans-serif;padding:8px 11px}" +
      ".ee7-quote-selection-menu button:hover{background:#454d52}" +
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

  function applyQuoteHighlight(doc, text, startOffset, endOffset, id, sourceRange) {
    if (sourceRange && applyHighlightRange(doc, sourceRange, id)) return true;
    var textMatch = findTextRange(doc, text, startOffset);
    if (textMatch && applyHighlightRange(doc, textMatch.range, id)) return true;
    return applyHighlightOffsets(doc, startOffset, endOffset, id);
  }

  function saveQuote(doc, snapshot, options) {
    if (
      !snapshot ||
      !snapshot.text ||
      quoteWordCount(snapshot.text) > MAX_QUOTE_WORDS ||
      !isReaderDocument(doc)
    ) {
      return null;
    }
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
        applyQuoteHighlight(
          doc,
          items[i].text,
          items[i].startOffset,
          items[i].endOffset,
          items[i].id,
          snapshot.range,
        );
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
    applyQuoteHighlight(
      doc,
      quote.text,
      quote.startOffset,
      quote.endOffset,
      quote.id,
      snapshot.range,
    );
    notifyChange();
    return { quote: quote, alreadySaved: false };
  }

  function showActionMenu(doc, options, action, snapshot, quoteId, rect) {
    removeSelectionMenu();
    pendingSelection = {
      doc: doc,
      snapshot: snapshot,
      options: options || {},
      action: action,
      quoteId: quoteId || "",
      rect: rect,
    };
    injectStyle(doc);

    var menu = doc.createElement("div");
    menu.id = MENU_ID;
    menu.className = "ee7-quote-selection-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML =
      '<button type="button" role="menuitem">' +
      (action === "remove" ? "Remove quote" : "Save quote") +
      "</button>";
    menu.addEventListener("mousedown", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    menu.querySelector("button").addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (!pendingSelection) return;
      var state = pendingSelection;
      var result = null;
      if (state.action === "remove") {
        var removed = deleteQuote(state.quoteId);
        if (removed) refreshReaderHighlights(state.doc);
        removeSelectionMenu();
        var removeSelection = state.doc.getSelection && state.doc.getSelection();
        if (removeSelection && removeSelection.removeAllRanges) {
          removeSelection.removeAllRanges();
        }
        if (removed && typeof state.options.onRemoved === "function") {
          state.options.onRemoved(state.quoteId);
        }
        return;
      }
      result = saveQuote(state.doc, state.snapshot, state.options);
      removeSelectionMenu();
      var selection = state.doc.getSelection && state.doc.getSelection();
      if (selection && selection.removeAllRanges) selection.removeAllRanges();
      if (result && typeof state.options.onSaved === "function") {
        state.options.onSaved(result.quote, result.alreadySaved);
      }
    });
    doc.body.appendChild(menu);
    selectionMenu = menu;
    positionSelectionMenu(doc, rect);
  }

  function showSelectionMenu(doc, options) {
    var snapshot = selectionSnapshot(doc);
    if (!snapshot) return;
    var config = options || {};
    if (quoteWordCount(snapshot.text) > MAX_QUOTE_WORDS) {
      removeSelectionMenu();
      if (typeof config.onLimit === "function") {
        config.onLimit(MAX_QUOTE_WORDS);
      }
      return;
    }
    showActionMenu(
      doc,
      config,
      snapshot.quoteId ? "remove" : "save",
      snapshot,
      snapshot.quoteId,
      snapshot.rect,
    );
  }

  function showRemoveMenu(doc, mark, options) {
    if (!mark) return;
    var quoteId = toStringSafe(mark.getAttribute("data-ee7-quote-id"));
    if (!quoteId) return;
    showActionMenu(
      doc,
      options || {},
      "remove",
      null,
      quoteId,
      mark.getBoundingClientRect(),
    );
  }

  function unbindReaderDocument() {
    if (boundDocument && boundHandlers) {
      boundDocument.removeEventListener("mouseup", boundHandlers.mouseup);
      boundDocument.removeEventListener("touchend", boundHandlers.touchend);
      boundDocument.removeEventListener("mousedown", boundHandlers.mousedown);
      boundDocument.removeEventListener("keydown", boundHandlers.keydown);
      boundDocument.removeEventListener("keyup", boundHandlers.keyup);
      boundDocument.removeEventListener("click", boundHandlers.click);
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
      keyup: function (event) {
        if (
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "Home" ||
          event.key === "End"
        ) {
          handleSelection();
        }
      },
      click: function (event) {
        var target = event.target;
        var mark =
          target && target.closest
            ? target.closest("mark.ee7-quote-highlight")
            : null;
        if (!mark) return;
        var selection = doc.getSelection && doc.getSelection();
        if (selection && !selection.isCollapsed) return;
        showRemoveMenu(doc, mark, config);
      },
      scroll: function () {
        removeSelectionMenu();
      },
      resize: function () {
        if (selectionMenu && pendingSelection) {
          positionSelectionMenu(
            doc,
            pendingSelection.snapshot
              ? pendingSelection.snapshot.rect
              : pendingSelection.rect,
          );
        }
      },
    };
    doc.addEventListener("mouseup", handlers.mouseup);
    doc.addEventListener("touchend", handlers.touchend, { passive: true });
    doc.addEventListener("mousedown", handlers.mousedown);
    doc.addEventListener("keydown", handlers.keydown);
    doc.addEventListener("keyup", handlers.keyup);
    doc.addEventListener("click", handlers.click);
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
        '<div class="quote-preview" data-quote-expand role="button" tabindex="0" aria-expanded="false">' +
        '<blockquote class="quote-text">' +
        escapeHtml(quote.text) +
        "</blockquote>" +
        '<span class="quote-expand-label">Show full quote</span>' +
        "</div>" +
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
    maxQuoteWords: MAX_QUOTE_WORDS,
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
