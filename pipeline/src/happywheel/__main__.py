"""Command line: `python -m happywheel run|check-size`."""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

from .config import load_cities

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = ROOT / "config" / "cities.yaml"
DEFAULT_OUT = ROOT.parent / "web" / "public" / "data"
DEFAULT_CACHE = ROOT / ".cache"
PAD_DEG = 0.005


def merge_index(old: dict | None, new: dict, order: list[str]) -> dict:
    """New entries replace old ones; old entries of cities not run are kept; ordered by `order`."""
    entries = {c["id"]: c for c in (old or {}).get("cities", [])}
    entries.update({c["id"]: c for c in new["cities"]})
    merged = dict(new)
    merged["cities"] = [entries[i] for i in order if i in entries]
    return merged


def _cmd_run(args) -> int:
    cities = load_cities(Path(args.config))
    known = {c.id for c in cities}
    wanted = args.city or [c.id for c in cities]
    unknown = [i for i in wanted if i not in known]
    if unknown:
        print(f"error: unknown city: {', '.join(unknown)} (known: {', '.join(sorted(known))})",
              file=sys.stderr)
        return 2

    # heavy imports only when actually running
    from .elevation import CopernicusDEM
    from .export import build_cities_index, build_city_outputs, write_outputs
    from .network import annotate, fetch_network
    from .pois import fetch_pois

    out, cache = Path(args.out), Path(args.cache)
    metrics: dict[str, dict] = {}
    failed = []
    for city in (c for c in cities if c.id in wanted):
        t0 = time.time()
        try:
            print(f"[{city.id}] network...", flush=True)
            G = fetch_network(city, cache)
            xs = [d["x"] for _, d in G.nodes(data=True)]
            ys = [d["y"] for _, d in G.nodes(data=True)]
            bbox = (min(xs) - PAD_DEG, min(ys) - PAD_DEG, max(xs) + PAD_DEG, max(ys) + PAD_DEG)
            print(f"[{city.id}] elevation...", flush=True)
            src = CopernicusDEM(bbox=bbox, cache_dir=cache, correct_terrain=True)
            annotate(G, src)
            print(f"[{city.id}] pois...", flush=True)
            pois = fetch_pois(city, cache)
            outputs, m = build_city_outputs(city, G, pois, src)
            m["data_version"] = write_outputs(out, city.id, outputs)
            metrics[city.id] = m
            print(f"[{city.id}] done in {time.time() - t0:.0f}s "
                  f"(edges={G.number_of_edges()}, mean_score={m['mean_score']})", flush=True)
        except Exception as e:  # keep going with other cities
            failed.append(city.id)
            print(f"[{city.id}] FAILED: {type(e).__name__}: {e}", file=sys.stderr, flush=True)

    if metrics:
        index_path = out / "cities.json"
        old = None
        if index_path.exists():
            try:
                old = json.loads(index_path.read_text(encoding="utf-8"))
            except ValueError:
                old = None
        merged = merge_index(old, build_cities_index(cities, metrics), [c.id for c in cities])
        out.mkdir(parents=True, exist_ok=True)
        index_path.write_text(
            json.dumps(merged, ensure_ascii=False, allow_nan=False, separators=(",", ":")),
            encoding="utf-8")
        print(f"cities.json updated ({len(merged['cities'])} cities)")
    return 1 if failed else 0


def _cmd_check_size(args) -> int:
    out = Path(args.out)
    limit = args.limit_mb * 1024 * 1024
    over = False
    folders = sorted(p for p in out.iterdir() if p.is_dir()) if out.is_dir() else []
    for d in folders:
        total = sum(len(gzip.compress(f.read_bytes(), compresslevel=9))
                    for f in d.iterdir() if f.is_file())
        flag = "OVER" if total > limit else "ok"
        over |= total > limit
        print(f"{d.name}: {total / 1024 / 1024:.2f} MB gzip [{flag}]")
    return 1 if over else 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="happywheel")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="analyse cities and write web data")
    r.add_argument("--city", action="append", help="city id (repeatable); default all")
    r.add_argument("--out", default=str(DEFAULT_OUT))
    r.add_argument("--cache", default=str(DEFAULT_CACHE))
    r.add_argument("--config", default=str(DEFAULT_CONFIG))
    c = sub.add_parser("check-size", help="gzip size per city folder")
    c.add_argument("--out", default=str(DEFAULT_OUT))
    c.add_argument("--limit-mb", type=float, default=2.0)
    args = ap.parse_args(argv)
    return _cmd_run(args) if args.cmd == "run" else _cmd_check_size(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
