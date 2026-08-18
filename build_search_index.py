#!/usr/bin/env python3
"""
Build the full-text search index for EE7.

The index contains the existing discourse paragraphs and, when the Stories/
directory is present, bounded passages from the Baba story books. Discourse
entries link to HTML/Discourses/*.html. Story entries link to generated
HTML/Stories/*.html pages so every result remains readable from the static
site.

The generated JavaScript uses short field names to keep the browser payload
small:

    {"t": "Title", "f": "Discourses/File.html", "a": "42",
     "x": "passage text", "s": "discourses"}
"""

import argparse
import html
import json
import re
import unicodedata
from pathlib import Path


DISCOURSES_DIR = Path("HTML") / "Discourses"
STORIES_DIR = Path("Stories")
STORY_PAGES_DIR = Path("HTML") / "Stories"
OUTPUT_FILE = Path("HTML") / "search_index.js"

MIN_PARA_LEN = 30
STORY_MAX_BLOCKS = 4
STORY_MAX_CHARACTERS = 2400

STORY_ATX_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$")
STORY_SETEXT_HEADING_RE = re.compile(r"^\s*(?:=+|-+)\s*$")
STORY_LIST_ITEM_RE = re.compile(
    r"^\s{0,3}(?P<marker>[-+*]|\d+[.)])\s+(?P<text>.+?)\s*$"
)
STORY_BLOCKQUOTE_RE = re.compile(r"^\s{0,3}>\s?(?P<text>.*)$")
STORY_FENCE_RE = re.compile(r"^\s{0,3}(?:`{3,}|~{3,})")
STORY_PAGE_COMMENT_RE = re.compile(
    r"^\s*<!--\s*(?:page|p|baba-ocr-page)\s*"
    r"(?::|=|-|\s)\s*0*\d+\s*-->\s*$",
    re.IGNORECASE,
)
STORY_PAGE_HEADING_RE = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?:\[\s*)?(?:pdf\s+)?page\s*"
    r"(?::|=|-|\s)+0*\d+\s*(?:\])?\s*$",
    re.IGNORECASE,
)


def strip_tags(text):
    """Remove all HTML tags from a string."""

    return re.sub(r"<[^>]+>", "", text)


def html_to_text(fragment):
    """Strip markup while retaining boundaries between HTML block elements."""

    with_boundaries = re.sub(
        r"<\s*(?:br|p|/p|div|/div|li|/li|tr|/tr|td|/td|h[1-6]|/h[1-6])\b[^>]*>",
        " ",
        fragment,
        flags=re.IGNORECASE,
    )
    without_tags = re.sub(r"<[^>]+>", " ", with_boundaries)
    return normalize_whitespace(html.unescape(without_tags))


def decode(text):
    """Strip HTML tags and decode HTML entities."""

    return html_to_text(text)


def normalize_whitespace(text):
    return re.sub(r"\s+", " ", text).strip()


def normalize_for_comparison(text):
    decomposed = unicodedata.normalize("NFD", text)
    without_marks = "".join(
        char for char in decomposed if not unicodedata.combining(char)
    )
    return normalize_whitespace(without_marks).casefold()


def humanize_filename(stem):
    return normalize_whitespace(re.sub(r"[_-]+", " ", stem)).strip() or stem


def extract_title(content):
    """
    Try several patterns to get the discourse title.
    Returns a clean plain-text string.
    """

    patterns = (
        r"<!--\s*block\s+a=title\s+type=title\s*-->(.*?)<!--\s*/block\s*-->",
        r'<div[^>]*class\s*=\s*["\'][^"\']*\bdiscourse_title\b[^"\']*["\'][^>]*>(.*?)</div>',
        r"<title[^>]*>(.*?)</title>",
        r'<(?:p|div|h1)[^>]*class\s*=\s*(?:["\'][^"\']*\btitle\b[^"\']*["\']|[^\s>]*\btitle\b[^\s>]*)[^>]*>(.*?)</(?:p|div|h1)>',
    )
    for pattern in patterns:
        match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
        if not match:
            continue
        title = decode(match.group(1))
        title = re.sub(r"^EE7[.\d]*\s*[-\u2013]\s*", "", title)
        if title:
            return title
    return ""


def extract_paragraphs(content):
    """
    Return list of (anchor_str, plain_text) for every discourse paragraph.
    """

    paragraphs = []
    pattern = re.compile(
        r"<!--\s*block\s+a=([^\s]+)\s+type=paragraph\s*-->(.*?)"
        r"<!--\s*/block\s*-->",
        re.DOTALL | re.IGNORECASE,
    )
    for match in pattern.finditer(content):
        anchor = match.group(1).strip("\"'")
        text = normalize_whitespace(decode(match.group(2)))
        if len(text) >= MIN_PARA_LEN:
            paragraphs.append((anchor, text))
    return paragraphs


def parse_front_matter(content):
    """Read the small, flat YAML header used by the OCR Markdown files."""

    match = re.match(r"\s*---\s*\n(.*?)\n---\s*(?:\n|$)", content, re.DOTALL)
    if not match:
        return {}, content

    metadata = {}
    for line in match.group(1).splitlines():
        field = re.match(r"\s*([A-Za-z0-9_]+)\s*:\s*(.*?)\s*$", line)
        if not field:
            continue
        value = field.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        metadata[field.group(1).lower()] = value
    return metadata, content[match.end() :]


def markdown_to_text(markdown):
    """Convert the story Markdown into searchable, citation-friendly text."""

    text = re.sub(r"^\s*```[^\n]*\n", "", markdown, flags=re.MULTILINE)
    text = re.sub(r"^\s*```\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[*_~]", "", text)
    return normalize_whitespace(html.unescape(text))


def is_story_page_metadata_line(line):
    return bool(
        STORY_PAGE_COMMENT_RE.match(line) or STORY_PAGE_HEADING_RE.match(line)
    )


def story_heading(line):
    match = STORY_ATX_HEADING_RE.match(line)
    if not match or is_story_page_metadata_line(line):
        return None
    text = markdown_to_text(match.group(2))
    if not text:
        return None
    return len(match.group(1)), text


def render_story_block(kind, lines):
    """Render a Markdown block while retaining useful structural cues."""

    if kind == "heading":
        heading = story_heading(lines[0])
        if heading is None:
            return ""
        level, text = heading
        return f"{'#' * level} {text}"

    if kind == "list":
        rendered = []
        for line in lines:
            match = STORY_LIST_ITEM_RE.match(line)
            if match:
                marker = match.group("marker")
                if marker in {"+", "*"}:
                    marker = "-"
                item_text = markdown_to_text(match.group("text"))
                if item_text:
                    rendered.append(f"{marker} {item_text}")
            else:
                continuation = markdown_to_text(line)
                if continuation:
                    rendered.append(continuation)
        return "\n".join(rendered).strip()

    if kind == "quote":
        rendered = []
        for line in lines:
            match = STORY_BLOCKQUOTE_RE.match(line)
            quote_text = markdown_to_text(match.group("text") if match else line)
            if quote_text:
                rendered.append(f"> {quote_text}")
        return "\n".join(rendered).strip()

    return normalize_whitespace(markdown_to_text("\n".join(lines)))


def story_markdown_blocks(markdown):
    """Parse meaningful Markdown blocks without relying on PDF page breaks."""

    blocks = []
    current_kind = None
    current_lines = []
    in_fence = False

    def flush():
        nonlocal current_kind, current_lines
        if current_kind is not None and current_lines:
            text = render_story_block(current_kind, current_lines)
            if text:
                blocks.append((current_kind, text))
        current_kind = None
        current_lines = []

    lines = markdown.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].rstrip()

        if is_story_page_metadata_line(line):
            index += 1
            continue

        if in_fence:
            current_lines.append(line)
            if STORY_FENCE_RE.match(line):
                in_fence = False
            index += 1
            continue

        if not line.strip() or re.fullmatch(r"\s*<!--.*?-->\s*", line):
            flush()
            index += 1
            continue

        heading = story_heading(line)
        if heading is not None:
            flush()
            level, text = heading
            blocks.append(("heading", f"{'#' * level} {text}"))
            index += 1
            continue

        if (
            index + 1 < len(lines)
            and line.strip()
            and STORY_SETEXT_HEADING_RE.match(lines[index + 1])
            and not is_story_page_metadata_line(lines[index + 1])
        ):
            heading_text = markdown_to_text(line)
            if heading_text:
                flush()
                blocks.append(("heading", f"## {heading_text}"))
                index += 2
                continue

        if STORY_FENCE_RE.match(line):
            if current_kind != "code":
                flush()
                current_kind = "code"
            current_lines.append(line)
            in_fence = True
            index += 1
            continue

        if STORY_LIST_ITEM_RE.match(line):
            kind = "list"
        elif STORY_BLOCKQUOTE_RE.match(line):
            kind = "quote"
        else:
            kind = "paragraph"

        if current_kind != kind:
            if not (
                current_kind == "list"
                and kind == "paragraph"
                and re.match(r"^\s{2,}\S", line)
            ):
                flush()
                current_kind = kind
        current_lines.append(line)
        index += 1

    flush()
    return blocks


def story_sections(blocks):
    sections = []
    heading = None
    body = []
    for kind, text in blocks:
        if kind == "heading":
            if heading is not None or body:
                sections.append((heading, body))
            heading = text
            body = []
        else:
            body.append((kind, text))
    if heading is not None or body:
        sections.append((heading, body))
    return sections


def pack_story_units(units, separator, max_characters):
    packed = []
    current = ""
    for raw_unit in units:
        unit = raw_unit.strip()
        if not unit:
            continue
        if len(unit) > max_characters:
            if current:
                packed.append(current)
                current = ""
            words = unit.split()
            word_chunk = ""
            for word in words:
                candidate = f"{word_chunk} {word}".strip()
                if word_chunk and len(candidate) > max_characters:
                    packed.append(word_chunk)
                    word_chunk = word
                else:
                    word_chunk = candidate
            if word_chunk:
                current = word_chunk
            continue
        candidate = f"{current}{separator}{unit}" if current else unit
        if current and len(candidate) > max_characters:
            packed.append(current)
            current = unit
        else:
            current = candidate
    if current:
        packed.append(current)
    return packed


def split_story_block(kind, text, max_characters):
    if len(text) <= max_characters:
        return [text]
    if kind in {"list", "quote"}:
        return pack_story_units(text.splitlines(), "\n", max_characters)
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return pack_story_units(sentences, " ", max_characters)


def story_chunks(blocks):
    """Return (anchor, text) chunks used by both the index and story pages."""

    chunks = []
    for section_number, (heading, body) in enumerate(story_sections(blocks), 1):
        part_max_characters = STORY_MAX_CHARACTERS
        if heading:
            part_max_characters = max(
                1, STORY_MAX_CHARACTERS - len(heading) - 2
            )
        parts = []
        for kind, text in body:
            parts.extend(split_story_block(kind, text, part_max_characters))

        current = [heading] if heading else []
        body_count = 0
        current_characters = len(heading) if heading else 0
        section_chunks = []
        for part in parts:
            separator_length = 2 if current else 0
            exceeds_window = (
                body_count > 0
                and (
                    body_count >= STORY_MAX_BLOCKS
                    or current_characters + separator_length + len(part)
                    > STORY_MAX_CHARACTERS
                )
            )
            if exceeds_window:
                section_chunks.append("\n\n".join(current).strip())
                current = [heading] if heading else []
                body_count = 0
                current_characters = len(heading) if heading else 0
                separator_length = 2 if current else 0
            current.append(part)
            body_count += 1
            current_characters += separator_length + len(part)

        if current:
            section_chunks.append("\n\n".join(current).strip())

        for chunk_number, text in enumerate(section_chunks, 1):
            chunks.append(
                (f"section-{section_number}-chunk-{chunk_number}", text)
            )
    return chunks


def story_title(metadata, path):
    title = metadata.get("title", "").strip()
    source_pdf = metadata.get("source_pdf", "").strip()
    source_stem = Path(source_pdf).stem if source_pdf else ""
    if not title:
        title = source_stem or path.stem
    if (
        " " not in title
        and ("_" in title or title.casefold() == path.stem.casefold())
    ):
        title = humanize_filename(title)
    return normalize_whitespace(title)


def story_document(path):
    content = path.read_text(encoding="utf-8", errors="replace")
    metadata, body = parse_front_matter(content)
    title = story_title(metadata, path)
    blocks = story_markdown_blocks(body)
    if blocks and blocks[0][0] == "heading" and blocks[0][1].startswith("# "):
        first_heading = markdown_to_text(blocks[0][1])
        if normalize_for_comparison(first_heading) == normalize_for_comparison(title):
            blocks = blocks[1:]
    return title, metadata.get("source_pdf", ""), story_chunks(blocks)


def render_story_block_html(text):
    rendered = []
    for block in text.split("\n\n"):
        lines = block.splitlines()
        if not lines:
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", lines[0])
        if heading and len(lines) == 1:
            level = len(heading.group(1))
            rendered.append(
                f"<h{level}>{html.escape(heading.group(2))}</h{level}>"
            )
            continue

        if lines and all(STORY_BLOCKQUOTE_RE.match(line) for line in lines):
            quote = "<br>\n".join(
                html.escape(STORY_BLOCKQUOTE_RE.match(line).group("text"))
                for line in lines
            )
            rendered.append(f"<blockquote>{quote}</blockquote>")
            continue

        list_matches = [STORY_LIST_ITEM_RE.match(line) for line in lines]
        if lines and all(list_matches):
            ordered = bool(re.match(r"\d", list_matches[0].group("marker")))
            tag = "ol" if ordered else "ul"
            items = "".join(
                f"<li>{html.escape(markdown_to_text(match.group('text')))}</li>"
                for match in list_matches
            )
            rendered.append(f"<{tag}>{items}</{tag}>")
            continue

        paragraph = "<br>\n".join(
            html.escape(markdown_to_text(line)) for line in lines
        )
        rendered.append(f"<p>{paragraph}</p>")
    return "\n".join(rendered)


def write_story_page(output_path, title, source_pdf, chunks):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    page = [
        "<!doctype html>",
        '<html lang="en" data-theme="dark">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{html.escape(title)} - Baba stories</title>",
        "<style>",
        ":root { color-scheme: dark; --bg: #2e2a24; --text: #ddd5c8; --dim: #a09088; --accent: #e07820; --border: #4a3c30; }",
        "* { box-sizing: border-box; }",
        "body { max-width: 860px; margin: 0 auto; padding: 36px 24px 72px; background: var(--bg); color: var(--text); font: 11pt/1.65 Tahoma, Arial, sans-serif; }",
        "h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 8px; }",
        "h2, h3, h4, h5, h6 { color: var(--accent); line-height: 1.3; margin: 26px 0 8px; }",
        "h2 { font-size: 16pt; } h3 { font-size: 14pt; } h4, h5, h6 { font-size: 12pt; }",
        ".source { color: var(--dim); font-size: 9pt; margin-bottom: 28px; }",
        "section { scroll-margin-top: 18px; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 28px; }",
        "p { margin: 0 0 14px; }",
        "blockquote { border-left: 3px solid var(--accent); color: var(--dim); margin: 0 0 14px; padding: 4px 0 4px 16px; }",
        "li { margin: 4px 0; }",
        "</style>",
        "</head>",
        "<body>",
        f"<h1>{html.escape(title)}</h1>",
        (
            f'<p class="source">Baba story book'
            + (f": {html.escape(source_pdf)}" if source_pdf else "")
            + "</p>"
        ),
    ]
    for anchor, text in chunks:
        page.append(f'<section id="{html.escape(anchor, quote=True)}">')
        page.append(render_story_block_html(text))
        page.append("</section>")
    page.extend(["</body>", "</html>", ""])
    output_path.write_text("\n".join(page), encoding="utf-8")


def iter_story_files(stories_dir):
    if not stories_dir.is_dir():
        return []
    return sorted(
        (
            path
            for path in stories_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in {".md", ".markdown"}
        ),
        key=lambda path: path.relative_to(stories_dir).as_posix().casefold(),
    )


def write_search_index(entries):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as output:
        output.write("var searchIndex = [\n")
        for index, entry in enumerate(entries):
            comma = "," if index < len(entries) - 1 else ""
            output.write(json.dumps(entry, ensure_ascii=False) + comma + "\n")
        output.write("];\n")


def main():
    parser = argparse.ArgumentParser(description="Build the EE7 search index")
    parser.add_argument(
        "--stories-dir",
        type=Path,
        default=STORIES_DIR,
        help=f"Baba story Markdown directory (default: {STORIES_DIR})",
    )
    args = parser.parse_args()

    if not DISCOURSES_DIR.is_dir():
        print(f"ERROR: Directory not found: {DISCOURSES_DIR}")
        print("Run this script from the COMPLETE_SARKAR workspace root.")
        return 1

    entries = []
    discourse_file_count = 0
    discourse_skipped = 0
    discourse_entry_count = 0

    for filepath in sorted(
        DISCOURSES_DIR.glob("*.html"), key=lambda path: path.name.casefold()
    ):
        content = filepath.read_text(encoding="utf-8", errors="replace")
        title = extract_title(content)
        paragraphs = extract_paragraphs(content) if title else []
        if not title or not paragraphs:
            discourse_skipped += 1
            continue

        for anchor, text in paragraphs:
            entries.append(
                {
                    "t": title,
                    "f": f"Discourses/{filepath.name}",
                    "a": anchor,
                    "x": text,
                    "s": "discourses",
                }
            )
        discourse_file_count += 1
        discourse_entry_count += len(paragraphs)

    story_file_count = 0
    story_skipped = 0
    story_entry_count = 0
    story_page_count = 0
    stories_dir = args.stories_dir.expanduser()
    if stories_dir.is_dir():
        for filepath in iter_story_files(stories_dir):
            try:
                title, source_pdf, chunks = story_document(filepath)
            except OSError as exc:
                print(f"WARNING: Could not read story {filepath}: {exc}")
                story_skipped += 1
                continue
            if not title or not chunks:
                story_skipped += 1
                continue

            relative = filepath.relative_to(stories_dir)
            page_relative = Path("Stories") / relative.with_suffix(".html")
            write_story_page(
                STORY_PAGES_DIR / relative.with_suffix(".html"),
                title,
                source_pdf,
                chunks,
            )
            story_page_count += 1
            for anchor, text in chunks:
                entries.append(
                    {
                        "t": title,
                        "f": page_relative.as_posix(),
                        "a": anchor,
                        "x": text,
                        "s": "stories",
                    }
                )
            story_file_count += 1
            story_entry_count += len(chunks)
    else:
        print(f"Baba story directory not found, omitting stories: {stories_dir}")

    write_search_index(entries)

    print("Done.")
    print(f"  Discourses indexed : {discourse_file_count}")
    print(f"  Discourses skipped : {discourse_skipped}")
    print(f"  Discourse entries  : {discourse_entry_count}")
    print(f"  Baba books indexed : {story_file_count}")
    print(f"  Baba books skipped : {story_skipped}")
    print(f"  Baba entries       : {story_entry_count}")
    print(f"  Story pages        : {story_page_count}")
    print(f"  Total entries      : {len(entries)}")
    print(f"  Output             : {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
