#!/usr/bin/env python3
"""Final pre-delivery check: links, encoding, tree, and metadata summary."""
import pathlib
import re

root = pathlib.Path(".agents/skills")
docs = ["README.md", "ARCHITECTURE.md", "ROUTING.md", "VALIDATION.md", "FILE-MANIFEST.md"]
bad_links = []
for d in docs:
    text = (root / d).read_text(encoding="utf-8")
    for label, target in re.findall(r"\[([^\]]+)\]\(([^)#]+)\)", text):
        if target.startswith(("http://", "https://", "mailto:")):
            continue
        if not (root / target).exists():
            bad_links.append((d, label, target))
print("broken relative links:", bad_links or "none")

bad_encoding = []
for p in list(root.rglob("*.md")) + list(pathlib.Path("scripts").glob("*.py")):
    t = p.read_text(encoding="utf-8")
    if "\ufffd" in t or "\x00" in t:
        bad_encoding.append(str(p))
print("encoding anomalies:", bad_encoding or "none")

print("\npack tree:")
for p in sorted(root.rglob("*")):
    if p.is_file():
        print(f"  {p.relative_to(root)}  ({p.stat().st_size:,} bytes)")

print("\nskill metadata:")
for p in sorted(root.glob("*/SKILL.md")):
    t = p.read_text(encoding="utf-8")
    name = re.search(r"^name: (.+)$", t, re.M).group(1)
    desc = re.search(r"^description: >\n((?:  .+\n)+)", t, re.M)
    first = " ".join(desc.group(1).split())[:95] if desc else "(single-line)"
    print(f"  {name:28} folder={p.parent.name:28} match={name == p.parent.name}")
    print(f"      {first}...")
