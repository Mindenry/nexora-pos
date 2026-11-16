#!/usr/bin/env python3
"""Validate the POS domain skills pack.

Checks structure, YAML frontmatter, naming, description quality and uniqueness,
required sections, cross-skill references and basic hygiene.

Usage:
    python scripts/validate-pos-skills.py [--root .agents/skills] [--json report.json]

Exit code 0 = no errors (warnings allowed), 1 = errors found.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import yaml

EXPECTED = [
    "pos-domain-expert",
    "pos-sales-checkout",
    "pos-inventory-management",
    "pos-payment-reconciliation",
    "pos-shift-cash-management",
    "pos-offline-sync-engine",
    "pos-multi-tenant-saas",
    "pos-thailand-commerce",
    "pos-customer-loyalty",
    "pos-profit-intelligence",
    "pos-hardware-integration",
    "pos-backup-recovery",
]

# Section headings that must appear (case-insensitive substring match).
REQUIRED_SECTIONS = [
    ("when to use", ["when to use"]),
    ("business rules", ["business rules"]),
    ("edge cases", ["edge cases"]),
    ("security", ["security"]),
    ("error handling", ["error handling"]),
    ("testing", ["testing requirements", "testing"]),
    ("anti-patterns", ["anti-patterns"]),
    ("cross-skill references", ["cross-skill references", "cross-skill"]),
    ("workflow", ["workflow", "workflows"]),
]

ALLOWED_FRONTMATTER_KEYS = {"name", "description", "metadata", "license", "compatibility"}

STOPWORDS = set(
    """a an and are as at be by for from has have in into is it its not of on or that the their
    this to use used uses using when with without you your within across per via also only own
    pos point sale sales system design build debug review task any all more most other than
    include includes including work works working need needs""".split()
)

NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILL_REF_RE = re.compile(r"\bpos-[a-z0-9]+(?:-[a-z0-9]+)*\b")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$", re.MULTILINE)
PLACEHOLDER_RE = re.compile(r"\b(TODO|TBD|FIXME|XXX|lorem ipsum)\b", re.IGNORECASE)


def split_frontmatter(text: str) -> tuple[str | None, str, list[str]]:
    errors: list[str] = []
    if text.startswith("\ufeff"):
        errors.append("file starts with a UTF-8 BOM")
        text = text.lstrip("\ufeff")
    if not text.startswith("---"):
        return None, text, errors + ["missing YAML frontmatter (must start with ---)"]
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, text, errors + ["unterminated YAML frontmatter"]
    return parts[1], parts[2], errors


def normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def tokens(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in STOPWORDS and len(w) > 2}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def count_lines(text: str) -> int:
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def load_skill(path: Path, known_ids: set[str]) -> dict:
    result: dict = {
        "id": path.parent.name,
        "path": str(path),
        "errors": [],
        "warnings": [],
    }
    raw = path.read_bytes()
    if b"\r\n" in raw:
        result["warnings"].append("CRLF line endings (pack uses LF)")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        result["errors"].append(f"not valid UTF-8: {exc}")
        return result

    fm_text, body, fm_errors = split_frontmatter(text)
    result["errors"].extend(fm_errors)
    meta: dict = {}
    if fm_text is not None:
        try:
            loaded = yaml.safe_load(fm_text)
            if not isinstance(loaded, dict):
                result["errors"].append("frontmatter is not a YAML mapping")
            else:
                meta = loaded
        except yaml.YAMLError as exc:
            result["errors"].append(f"invalid YAML: {exc}")

    result["meta"] = meta
    extra = set(meta) - ALLOWED_FRONTMATTER_KEYS
    if extra:
        result["warnings"].append(f"unexpected frontmatter keys: {sorted(extra)}")

    name = meta.get("name")
    desc = meta.get("description")

    if not isinstance(name, str) or not name.strip():
        result["errors"].append("frontmatter.name missing or not a string")
    else:
        if name != name.strip():
            result["errors"].append("frontmatter.name has leading/trailing whitespace")
        if name != path.parent.name:
            result["errors"].append(
                f"frontmatter.name '{name}' != folder '{path.parent.name}'"
            )
        if not NAME_RE.match(name):
            result["errors"].append(f"name '{name}' is not lowercase kebab-case")
        if not (1 <= len(name) <= 64):
            result["errors"].append("name length outside 1..64")
        if name not in EXPECTED:
            result["warnings"].append("name is not one of the 12 expected pack skills")

    if not isinstance(desc, str) or not desc.strip():
        result["errors"].append("frontmatter.description missing or not a string")
        desc = ""
    else:
        desc_n = normalise(desc)
        result["description"] = desc_n
        if len(desc_n) < 180:
            result["warnings"].append(f"description short ({len(desc_n)} chars); discovery may suffer")
        if len(desc_n) > 1400:
            result["warnings"].append(f"description long ({len(desc_n)} chars); metadata budget")
        if desc_n.count(". ") + desc_n.count(".") < 2:
            result["warnings"].append("description lacks trigger/disambiguation sentences")
        if "not for" not in desc_n:
            result["warnings"].append("description has no 'Not for ...' disambiguation")
        english = len(re.findall(r"[a-z]", desc_n)) / max(len(desc_n), 1)
        if english < 0.5:
            result["warnings"].append("description is mostly non-ASCII; discovery may suffer")
        if "\n" in desc.strip() and ":" in desc and not desc.strip().startswith(">"):
            result["warnings"].append("multi-line description without folded scalar")

    headings = [m.group(2).strip() for m in HEADING_RE.finditer(body)]
    result["headings"] = headings
    lower_headings = [h.lower() for h in headings]
    for label, aliases in REQUIRED_SECTIONS:
        if not any(any(a in h for a in aliases) for h in lower_headings):
            result["errors"].append(f"missing required section: {label}")

    refs = set(SKILL_REF_RE.findall(body))
    result["refs"] = sorted(refs)
    unknown = sorted(r for r in refs if r not in known_ids)
    if unknown:
        result["errors"].append(f"references unknown skills: {unknown}")
    if result["id"] in refs:
        result["warnings"].append("self-reference in cross-skill section")
    if len(refs - {result["id"]}) < 2:
        result["warnings"].append("fewer than 2 cross-skill references")

    if PLACEHOLDER_RE.search(body):
        result["errors"].append("placeholder text found (TODO/TBD/FIXME/XXX)")

    # Hygiene
    trailing = [i + 1 for i, line in enumerate(text.splitlines()) if line != line.rstrip()]
    if trailing:
        result["warnings"].append(f"trailing whitespace on {len(trailing)} line(s)")
    if "\t" in body:
        result["warnings"].append("tab characters present")
    if body.count("```") % 2 != 0:
        result["errors"].append("unbalanced fenced code blocks")

    result["lines"] = count_lines(body)
    if result["lines"] > 500:
        result["warnings"].append(f"{result['lines']} lines (>500 progressive-disclosure guidance)")
    words = len(re.findall(r"[A-Za-z0-9\u0E00-\u0E7F]+", body))
    result["words"] = words
    if words < 900:
        result["warnings"].append(f"thin body ({words} words)")

    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".agents/skills")
    ap.add_argument("--json", default="")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"ERROR: skills root not found: {root}")
        return 1

    skill_paths = sorted(p / "SKILL.md" for p in root.iterdir() if p.is_dir() and (p / "SKILL.md").is_file())
    ids = {p.parent.name for p in skill_paths}

    global_roots = [
        Path.home() / ".agents" / "skills",
        Path.home() / ".config" / "opencode" / "skills",
    ]
    global_ids: set[str] = set()
    for gr in global_roots:
        if gr.is_dir():
            global_ids |= {p.name for p in gr.iterdir() if p.is_dir()}

    known_ids = ids | set(EXPECTED)
    results = [load_skill(p, known_ids) for p in skill_paths]

    # Pack completeness
    missing = sorted(set(EXPECTED) - ids)
    extra = sorted(ids - set(EXPECTED))
    collisions = sorted(ids & global_ids)

    # Description uniqueness
    pairs = []
    for i, a in enumerate(results):
        for b in results[i + 1 :]:
            score = jaccard(tokens(a.get("description", "")), tokens(b.get("description", "")))
            pairs.append((score, a["id"], b["id"]))
    pairs.sort(reverse=True)
    for score, a, b in pairs:
        if score >= 0.6:
            for r in results:
                if r["id"] in (a, b):
                    r["errors"].append(f"description too similar to sibling (jaccard={score:.2f})")
        elif score >= 0.4:
            for r in results:
                if r["id"] in (a, b):
                    r["warnings"].append(f"description overlap with sibling (jaccard={score:.2f})")

    # Duplicate first sentences / identical descriptions
    desc_counter = Counter(r.get("description", "") for r in results)
    for desc, n in desc_counter.items():
        if n > 1 and desc:
            for r in results:
                if r.get("description") == desc:
                    r["errors"].append("description duplicated verbatim")

    errors = sum(len(r["errors"]) for r in results) + len(missing) + len(collisions)
    warnings = sum(len(r["warnings"]) for r in results)

    if missing:
        print(f"ERROR missing expected skills: {missing}")
    if extra:
        print(f"WARN unexpected skill folders: {extra}")
    if collisions:
        print(f"ERROR id collisions with globally installed skills: {collisions}")

    for r in results:
        status = "FAIL" if r["errors"] else ("WARN" if r["warnings"] else "OK")
        print(f"[{status:4}] {r['id']:<28} {r.get('lines', 0):>4} lines  {r.get('words', 0):>5} words")
        for e in r["errors"]:
            print(f"         error: {e}")
        for w in r["warnings"]:
            print(f"         warn:  {w}")

    print()
    print(f"skills: {len(results)}/{len(EXPECTED)}  errors: {errors}  warnings: {warnings}")
    print("top description similarity:")
    for score, a, b in pairs[:5]:
        print(f"  {score:.3f}  {a} ↔ {b}")

    report = {
        "root": str(root),
        "expected": EXPECTED,
        "found": sorted(ids),
        "missing": missing,
        "unexpected": extra,
        "global_collisions": collisions,
        "skills": results,
        "similarity": [{"score": round(s, 3), "a": a, "b": b} for s, a, b in pairs],
        "totals": {"skills": len(results), "errors": errors, "warnings": warnings},
    }
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"report: {args.json}")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
