"""Summarize a saved REA capture_browser_scenario result (SOP-03).

Claude Code saves oversized MCP results as JSON files under the session's
tool-results folder. This script prints the facts a research note needs and
extracts the final step's accessibility tree and screenshot.

Usage:
  python -I -X utf8 scripts/rea-probe-capture.py <capture.json> <label> [--out DIR] [--preview N]

Outputs (in --out, default: the capture file's folder):
  <label>-accessibility.txt   final step's accessibility tree (if requested in the capture)
  <label>.png                 final step's screenshot (if requested in the capture)
Prints: evidence id, step statuses and errors, final URL, completeness,
bot-check markers, a text preview, and the distinct request templates per host.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from collections import Counter
from urllib.parse import urlsplit

BOT_MARKERS = ("just a moment", "verify you are human", "cloudflare", "access denied", "enable javascript")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("capture")
    ap.add_argument("label")
    ap.add_argument("--out", default=None)
    ap.add_argument("--preview", type=int, default=1500)
    args = ap.parse_args()
    out_dir = args.out or os.path.dirname(os.path.abspath(args.capture))
    os.makedirs(out_dir, exist_ok=True)

    with open(args.capture, encoding="utf-8") as f:
        d = json.load(f)
    nr = d.get("normalized_result") or {}
    steps = nr.get("steps") or []

    print(f"== {args.label} ==")
    print("evidence_id:", d.get("evidence_id"))
    print("confidence:", d.get("confidence"), "| duration_ms:", nr.get("duration_ms"))
    env = (d.get("parameters") or {}).get("environment") or {}
    print("viewport:", env.get("viewport"))
    for s in steps:
        print(f"  step {s.get('step_index')} {s.get('step_id')!s:18} {s.get('action')!s:16} status={s.get('status')} error={json.dumps(s.get('error'))[:160]}")
    if steps:
        print("final url:", ((steps[-1].get("after_url") or {}).get("url")))
    print("completeness:", json.dumps(nr.get("completeness"))[:300])
    print("limitations:", len(nr.get("limitations") or []))

    if not steps:
        return 0
    artifacts = steps[-1].get("artifacts") or {}

    acc = ((artifacts.get("accessibility") or {}).get("value") or {}).get("text")
    if acc:
        path = os.path.join(out_dir, f"{args.label}-accessibility.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(acc)
        low = acc.lower()
        print(f"accessibility: {len(acc)} chars -> {path}")
        print("bot-check markers:", [m for m in BOT_MARKERS if m in low] or "none")
        if args.preview:
            print("---- preview ----")
            print(acc[: args.preview])
            print("---- end preview ----")
    else:
        print("accessibility: not captured (state:", (artifacts.get("accessibility") or {}).get("state"), ")")

    shot = (artifacts.get("screenshot") or {}).get("value") or {}
    if shot.get("data_base64"):
        raw = base64.b64decode(shot["data_base64"])
        path = os.path.join(out_dir, f"{args.label}.png")
        with open(path, "wb") as f:
            f.write(raw)
        print(f"screenshot: {len(raw)} bytes {shot.get('media_type')} sha256={str(shot.get('sha256'))[:12]}… -> {path}")
    else:
        print("screenshot: not captured (state:", (artifacts.get("screenshot") or {}).get("state"), ")")

    items = (nr.get("events") or {}).get("items") or []
    templates: Counter = Counter()
    kinds: Counter = Counter()
    for e in items:
        if not isinstance(e, dict):
            continue
        kinds[str(e.get("kind"))] += 1
        if e.get("kind") != "request":
            continue
        u = e.get("url")
        if isinstance(u, dict):
            u = u.get("url")
        if not u:
            continue
        sp = urlsplit(u)
        tmpl = re.sub(r"/[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*", "/{id}", sp.path)
        templates[(e.get("method") or "?", sp.netloc, tmpl)] += 1
    if items:
        print("event kinds:", dict(kinds))
        print("request templates (top 40):")
        for (m, host, p), n in templates.most_common(40):
            print(f"  {n:4} {m:5} {host}{p}")
    else:
        print("events: none retained (add capture.events: [\"network\"] to record endpoints)")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
