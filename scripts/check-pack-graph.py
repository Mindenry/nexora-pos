#!/usr/bin/env python3
"""Independent second-pass checks: YAML, H1 uniqueness, reference graph, doc refs."""
import re
import pathlib
import yaml

root = pathlib.Path(".agents/skills")
skills = sorted(p for p in root.iterdir() if p.is_dir())
ids = [p.name for p in skills]
print("dirs:", len(ids))
rows = []
refs_out = {}
h1s = {}
for s in skills:
    t = (s / "SKILL.md").read_text(encoding="utf-8")
    fm = t.split("---", 2)[1]
    yaml.safe_load(fm)
    body = t.split("---", 2)[2]
    h1 = re.search(r"^# (.+)$", body, re.M).group(1)
    h1s.setdefault(h1, []).append(s.name)
    refs = set(re.findall(r"\bpos-[a-z0-9]+(?:-[a-z0-9]+)*\b", body)) - {s.name}
    refs_out[s.name] = refs
    rows.append((s.name, len(body.splitlines()), len(re.findall(r"[A-Za-z0-9\u0E00-\u0E7F]+", body)), len(refs)))
print(f"{'skill':30}{'lines':>6}{'words':>7}{'refs':>6}")
for r in rows:
    print(f"{r[0]:30}{r[1]:>6}{r[2]:>7}{r[3]:>6}")
print("\nH1 uniqueness:", "OK" if len(h1s) == len(ids) else [k for k, v in h1s.items() if len(v) > 1])
inbound = {i: set() for i in ids}
for a, rs in refs_out.items():
    for b in rs:
        if b in inbound:
            inbound[b].add(a)
print("\nref graph (out / in):")
for i in ids:
    print(f"  {i:30} {len(refs_out[i]):>2} / {len(inbound[i]):>2}")
print("\nunreferenced by peers:", [i for i in ids if not inbound[i]])
allrefs = set().union(*refs_out.values())
print("unknown ids referenced:", sorted(r for r in allrefs if r not in ids))
docs = [root / "README.md", root / "ARCHITECTURE.md", root / "ROUTING.md"]
docrefs = set()
for d in docs:
    text = d.read_text(encoding="utf-8")
    # Ignore file names/paths (validate-pos-skills.py, .pos-baseline/) when auditing skill IDs.
    text = re.sub(r"[`\w./\\-]*pos-[\w./-]*(?:\.py|\.json|/)", " ", text)
    docrefs |= set(re.findall(r"`(pos-[a-z0-9]+(?:-[a-z0-9]+)*)`", text))
print("doc refs not in pack:", sorted(r for r in docrefs if r not in ids))
print("total body words:", sum(r[2] for r in rows))
