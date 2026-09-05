#!/usr/bin/env python3
"""Bidirectional docs<->code links.

Every core/ module carries `@doc docs/.../file.md#anchor` resolving to a real
file and heading. Every docs/design/ doc names at least one implementing module.

See docs/decisions/0006-docs-are-canonical.md
"""
from __future__ import annotations
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC_HEADER = re.compile(r"@doc\s+(\S+?\.md)(?:#(\S+))?")
IMPL_BY = re.compile(r"\*\*Implemented by:\*\*(.+)", re.I)
MODULE_REF = re.compile(r"`([\w/]+\.ts)`")


def anchors(path: Path) -> set[str]:
    out = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("#"):
            title = line.lstrip("#").strip()
            slug = re.sub(r"[^a-z0-9\s-]", "", title.lower())
            out.add(re.sub(r"\s+", "-", slug).strip("-"))
    return out


def check_markdown_links(errors: list[str]) -> int:
    """Every [text](file.md#anchor) between docs must resolve.

    Added after an agent noticed 01-illumination.md pointing at a heading in
    10-first-run.md that does not exist. This script validated `@doc` headers in
    code and nothing at all between documents -- so in a repository whose whole
    premise is that the documentation is canonical, the links inside it were the
    one thing nobody checked.
    """
    LINK = re.compile(r"\[[^\]]+\]\(([^)\s]+\.md)(?:#([^)\s]+))?\)")
    checked = 0
    for doc in sorted(ROOT.glob("docs/**/*.md")) + [ROOT / "README.md", ROOT / "AGENTS.md", ROOT / "TODO.md"]:
        if not doc.exists():
            continue
        for target, anchor in LINK.findall(doc.read_text(encoding="utf-8")):
            checked += 1
            dest = (doc.parent / target).resolve()
            rel = doc.relative_to(ROOT)
            if not dest.exists():
                errors.append(f"{rel}: links to missing file {target}")
            elif anchor and anchor not in anchors(dest):
                errors.append(f"{rel}: '#{anchor}' is not a heading in {target}")
    return checked


def main() -> int:
    errors: list[str] = []
    modules = sorted((ROOT / "core").rglob("*.ts"))

    # code -> docs
    for f in modules:
        head = f.read_text(encoding="utf-8")[:2000]
        m = DOC_HEADER.search(head)
        rel = f.relative_to(ROOT)
        if not m:
            errors.append(f"{rel}: missing '@doc <path>.md#<anchor>' header")
            continue
        doc = ROOT / m.group(1)
        if not doc.exists():
            errors.append(f"{rel}: @doc points at missing file {m.group(1)}")
        elif m.group(2) and m.group(2) not in anchors(doc):
            errors.append(f"{rel}: @doc anchor '#{m.group(2)}' not a heading in {m.group(1)}")

    # docs -> code
    declared: set[str] = set()
    pending: set[str] = set()
    design = sorted((ROOT / "docs" / "design").glob("*.md"))
    for doc in design:
        m = IMPL_BY.search(doc.read_text(encoding="utf-8"))
        rel = doc.relative_to(ROOT)
        if not m:
            errors.append(f"{rel}: no '**Implemented by:**' line")
            continue
        refs = MODULE_REF.findall(m.group(1))
        if not refs:
            errors.append(f"{rel}: 'Implemented by' names no `module.ts`")
        for r in refs:
            declared.add(r)
            if not (ROOT / r).exists():
                # Docs are canonical and lead the code, so a design doc naming a
                # module not yet written is expected, not an error. Once the file
                # exists it must carry a resolving @doc header (checked above).
                pending.add(r)

    links = check_markdown_links(errors)

    for e in errors:
        print(f"  {e}", file=sys.stderr)
    if errors:
        print(f"\n{len(errors)} doc-link problem(s).", file=sys.stderr)
        return 1
    note = f", {len(pending)} module(s) specced but unwritten" if pending else ""
    print(f"    doc links: {len(modules)} module(s), {len(design)} design doc(s), {links} cross-reference(s){note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
