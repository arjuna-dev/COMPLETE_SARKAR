#!/usr/bin/env python3
"""
Build the full-text search index for EE7.

Walks HTML/Discourses/, extracts every paragraph (using the <!-- block -->
markers already present in every discourse file), strips HTML tags, decodes
HTML entities, and writes HTML/search_index.js as a JS variable:

    var searchIndex = [
      {"t": "Title", "f": "Discourses/File.html", "a": "42", "x": "paragraph text"},
      ...
    ];

Notes on normalization / positions:
  The JS search page normalizes text with NFD + remove combining marks, which
  preserves string length (each NFC precomposed char like ś → s is still 1
  code unit after normalization), so match positions in normalized text map
  directly to the same positions in the original text.  This enables accurate
  snippet extraction with diacritics preserved in the displayed text.
"""

import os
import re
import html
import json

DISCOURSES_DIR = os.path.join("HTML", "Discourses")
OUTPUT_FILE = os.path.join("HTML", "search_index.js")

# Minimum paragraph length (chars) to include — filters out section headings
MIN_PARA_LEN = 30


def strip_tags(text):
    """Remove all HTML tags from a string."""
    return re.sub(r"<[^>]+>", "", text)


def decode(text):
    """Strip HTML tags and decode HTML entities."""
    return html.unescape(strip_tags(text)).strip()


def extract_title(content):
    """
    Try several patterns to get the discourse title.
    Returns a clean plain-text string.
    """
    # 1. Block marker (most precise)
    m = re.search(
        r"<!-- block a=title type=title -->(.*?)<!-- /block -->", content, re.DOTALL
    )
    if m:
        t = decode(m.group(1))
        if t:
            return t

    # 2. discourse_title div
    m = re.search(
        r'<div[^>]+class=["\']?discourse_title["\']?[^>]*>(.*?)</div>',
        content,
        re.DOTALL | re.IGNORECASE,
    )
    if m:
        t = decode(m.group(1))
        if t:
            return t

    # 3. <title> tag (strip "EE7+ - " prefix)
    m = re.search(r"<title[^>]*>(.*?)</title>", content, re.DOTALL | re.IGNORECASE)
    if m:
        t = decode(m.group(1))
        t = re.sub(r"^EE7[\.\d]*\s*[-–]\s*", "", t)
        if t:
            return t

    return ""


def extract_paragraphs(content):
    """
    Return list of (anchor_str, plain_text) for every paragraph block.
    Only blocks with type=paragraph are included; headings, titles, etc. are skipped.
    """
    paragraphs = []
    pattern = re.compile(
        r"<!-- block a=(\w+) type=paragraph -->(.*?)<!-- /block -->", re.DOTALL
    )
    for m in pattern.finditer(content):
        anchor = m.group(1)
        text = decode(m.group(2))
        # Normalise internal whitespace
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= MIN_PARA_LEN:
            paragraphs.append((anchor, text))
    return paragraphs


def main():
    if not os.path.isdir(DISCOURSES_DIR):
        print(f"ERROR: Directory not found: {DISCOURSES_DIR}")
        print("Run this script from the ee7 workspace root.")
        return

    entries = []
    file_count = 0
    skipped = 0

    for filename in sorted(os.listdir(DISCOURSES_DIR)):
        if not filename.endswith(".html"):
            continue

        filepath = os.path.join(DISCOURSES_DIR, filename)
        with open(filepath, encoding="utf-8", errors="replace") as f:
            content = f.read()

        title = extract_title(content)
        if not title:
            skipped += 1
            continue

        paragraphs = extract_paragraphs(content)
        if not paragraphs:
            skipped += 1
            continue

        rel_path = f"Discourses/{filename}"
        for anchor, text in paragraphs:
            entries.append(
                {
                    "t": title,
                    "f": rel_path,
                    "a": anchor,
                    "x": text,
                }
            )

        file_count += 1

    # Write JS file
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("var searchIndex = [\n")
        for i, entry in enumerate(entries):
            comma = "," if i < len(entries) - 1 else ""
            f.write(json.dumps(entry, ensure_ascii=False) + comma + "\n")
        f.write("];\n")

    print(f"Done.")
    print(f"  Discourses indexed : {file_count}")
    print(f"  Discourses skipped : {skipped}")
    print(f"  Paragraph entries  : {len(entries)}")
    print(f"  Output             : {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
