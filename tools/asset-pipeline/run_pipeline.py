"""
run_pipeline.py — Orchestrates the full 3D → 2D sprite pipeline.

Stages:
  1. Classify FBX files by asset type
  2. Render each FBX through Blender (one subprocess per file)
  3. Pack rendered frames into sprite sheets
  4. Copy sheets to LÖVE client assets directory

Usage:
    # Full run from a classified FBX directory:
    python run_pipeline.py \
        --fbx-root  D:/exported_fbx \
        --blender   "C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" \
        --config    config.json \
        --workers   4

    # Resume — skips already-rendered assets (checks for _frames.json marker):
    python run_pipeline.py --fbx-root D:/exported_fbx --blender ... --resume

    # Only pack (frames already rendered):
    python run_pipeline.py --pack-only --config config.json

    # Render a single asset for testing:
    python run_pipeline.py --single D:/exported_fbx/characters/goblin.fbx --type character --anim walk
"""

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("pipeline.log", mode="a"),
    ],
)
log = logging.getLogger("pipeline")


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def load_config(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def load_progress(path: str) -> dict:
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {"rendered": [], "packed": [], "failed": []}


def save_progress(path: str, progress: dict):
    with open(path, "w") as f:
        json.dump(progress, f, indent=2)


def classify_fbx(fbx_root: str, config: dict) -> dict:
    """Walk fbx_root, assign each .gltf/.glb/.fbx to an asset type bucket."""
    buckets = {t: [] for t in config["asset_types"]}
    buckets["unknown"] = []

    for root, _, files in os.walk(fbx_root):
        for fn in files:
            if not fn.lower().endswith((".gltf", ".glb", ".fbx")):
                continue
            full     = os.path.join(root, fn)
            name_low = fn.lower()
            path_low = root.lower()

            matched = False
            for asset_type, ac in config["asset_types"].items():
                for kw in ac.get("match_keywords", []):
                    if kw in name_low or kw in path_low:
                        buckets[asset_type].append((full, asset_type))
                        matched = True
                        break
                if matched:
                    break

            if not matched:
                # Fallback: infer from sub-directory name
                parts = root.replace("\\", "/").split("/")
                for p in parts:
                    if p.lower() in config["asset_types"]:
                        buckets[p.lower()].append((full, p.lower()))
                        matched = True
                        break
            if not matched:
                buckets["unknown"].append((full, "prop"))  # default unknown → prop

    total = sum(len(v) for v in buckets.values())
    log.info(f"Classified {total} FBX files:")
    for t, lst in buckets.items():
        if lst:
            log.info(f"  {t:12s}: {len(lst)}")
    return buckets


def render_asset(
    fbx_path:    str,
    asset_type:  str,
    anim:        str | None,
    frames_dir:  str,
    blender_exe: str,
    config_path: str,
    script_path: str,
) -> tuple[bool, str]:
    """Run Blender headless to render one FBX. Returns (success, output_dir)."""
    asset_name = Path(fbx_path).stem
    out_dir    = os.path.join(frames_dir, asset_name)
    marker     = os.path.join(out_dir, f"{asset_name}_frames.json")

    # Already done?
    if os.path.exists(marker):
        return True, out_dir

    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        blender_exe,
        "--background",
        "--python", script_path,
        "--",
        "--input",  fbx_path,
        "--output", out_dir,
        "--type",   asset_type,
        "--config", config_path,
    ]
    if anim:
        cmd += ["--anim", anim]

    log.info(f"Rendering: {asset_name}  ({asset_type})")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min per asset — increase for heavy scenes
        )
        if result.returncode != 0:
            log.error(f"Blender FAILED ({result.returncode}): {asset_name}")
            if result.stderr:
                log.error(result.stderr[-2000:])   # last 2k chars
            return False, out_dir
        return True, out_dir
    except subprocess.TimeoutExpired:
        log.error(f"Blender TIMEOUT: {asset_name}")
        return False, out_dir
    except Exception as e:
        log.error(f"Blender ERROR: {asset_name} — {e}")
        return False, out_dir


def pack_asset(asset_name: str, frames_dir: str, sheets_dir: str, love_dir: str, config: dict):
    """Pack frames for one asset into a sprite sheet."""
    import sprite_packer  # runs in-process

    frame_dir   = os.path.join(frames_dir, asset_name)
    sheet_out   = os.path.join(sheets_dir, asset_name)
    love_out    = os.path.join(love_dir, asset_name)

    # Determine asset type from frames marker
    marker = os.path.join(frame_dir, f"{asset_name}_frames.json")
    asset_type = "prop"
    padding    = 1.15
    if os.path.exists(marker):
        with open(marker) as f:
            data = json.load(f)
        asset_type = data.get("type", "prop")
        padding    = data.get("padding", 1.15)

    ac       = config["asset_types"].get(asset_type, {})
    max_size = ac.get("sheet_max_size", 2048)

    manifest = sprite_packer.pack_frames(
        frame_dir  = frame_dir,
        output_dir = sheet_out,
        sheet_name = asset_name,
        max_sheet  = max_size,
        trim       = True,
        padding    = padding,
    )
    if manifest:
        sprite_packer.copy_sheets_to_love(
            manifest_path = os.path.join(sheet_out, f"{asset_name}.json"),
            love_dir      = love_out,
        )
    return bool(manifest)


# ────────────────────────────────────────────────────────────────────────────
# Build global manifest (index of all sprite sheets for LÖVE)
# ────────────────────────────────────────────────────────────────────────────

def build_global_manifest(love_dir: str, frames_dir: str = None):
    index = {}
    for entry in os.scandir(love_dir):
        if not entry.is_dir():
            continue
        json_path = os.path.join(entry.path, f"{entry.name}.json")
        if not os.path.exists(json_path):
            continue
        with open(json_path) as f:
            data = json.load(f)
        asset_type = data.get("type", "unknown")
        # Prefer the type recorded in the frames marker (more reliable)
        if frames_dir:
            marker = os.path.join(frames_dir, entry.name, f"{entry.name}_frames.json")
            if os.path.exists(marker):
                with open(marker) as f:
                    mdata = json.load(f)
                asset_type = mdata.get("type", asset_type)
        index[entry.name] = {
            "type":       asset_type,
            "sheets":     data.get("sheets", []),
            "frames":     list(data.get("frames", {}).keys()),
            "animations": list(data.get("animations", {}).keys()),
        }
    out_path = os.path.join(love_dir, "sprite_index.json")
    with open(out_path, "w") as f:
        json.dump(index, f, indent=2)
    log.info(f"Global sprite index: {out_path}  ({len(index)} assets)")


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="3D → 2D sprite pipeline runner")
    parser.add_argument("--fbx-root",  help="Root directory of exported gltf/fbx files")
    parser.add_argument("--blender",   help="Path to blender.exe", default="blender")
    parser.add_argument("--config",    default="config.json")
    parser.add_argument("--workers",   type=int, default=2, help="Parallel Blender processes")
    parser.add_argument("--anim",      default=None, help="Animation to render (e.g. walk)")
    parser.add_argument("--resume",    action="store_true", help="Skip already-rendered assets")
    parser.add_argument("--pack-only", action="store_true", help="Skip rendering, only pack")
    parser.add_argument("--single",    help="Render a single FBX file (for testing)")
    parser.add_argument("--type",      default="prop", help="Asset type for --single")
    args = parser.parse_args()

    script_dir  = os.path.dirname(os.path.abspath(__file__))
    config      = load_config(args.config)
    frames_dir  = os.path.join(script_dir, config["output"]["frames_dir"])
    sheets_dir  = os.path.join(script_dir, config["output"]["sheets_dir"])
    love_dir    = os.path.join(script_dir, config["output"]["love_assets_dir"])
    progress_f  = os.path.join(script_dir, "pipeline_progress.json")
    script_path = os.path.join(script_dir, "blender_render.py")
    config_path = os.path.abspath(args.config)

    progress = load_progress(progress_f)

    # ── Single-file test mode ──────────────────────────────────────────────
    if args.single:
        success, out_dir = render_asset(
            fbx_path    = args.single,
            asset_type  = args.type,
            anim        = args.anim,
            frames_dir  = frames_dir,
            blender_exe = args.blender,
            config_path = config_path,
            script_path = script_path,
        )
        if success:
            asset_name = Path(args.single).stem
            pack_asset(asset_name, frames_dir, sheets_dir, love_dir, config)
            build_global_manifest(love_dir, frames_dir)
        sys.exit(0 if success else 1)

    # ── Render stage ──────────────────────────────────────────────────────
    if not args.pack_only:
        if not args.fbx_root:
            parser.error("--fbx-root required unless --pack-only or --single")

        buckets  = classify_fbx(args.fbx_root, config)
        all_jobs = []   # [(fbx_path, asset_type)]
        for asset_type, entries in buckets.items():
            for (fbx_path, atype) in entries:
                name = Path(fbx_path).stem
                if args.resume and name in progress["rendered"]:
                    log.info(f"Skip (already rendered): {name}")
                    continue
                all_jobs.append((fbx_path, atype))

        log.info(f"Rendering {len(all_jobs)} assets with {args.workers} workers")
        t0 = time.time()

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(
                    render_asset,
                    fbx_path, atype, args.anim,
                    frames_dir, args.blender, config_path, script_path,
                ): (fbx_path, atype)
                for (fbx_path, atype) in all_jobs
            }
            for fut in as_completed(futures):
                fbx_path, atype = futures[fut]
                name = Path(fbx_path).stem
                ok, _ = fut.result()
                if ok:
                    progress["rendered"].append(name)
                else:
                    progress["failed"].append(name)
                save_progress(progress_f, progress)

        elapsed = time.time() - t0
        log.info(f"Render stage: {len(progress['rendered'])} done, {len(progress['failed'])} failed  ({elapsed:.0f}s)")

    # ── Pack stage ─────────────────────────────────────────────────────────
    log.info("Packing sprite sheets…")
    sys.path.insert(0, os.path.dirname(__file__))

    packed_count = 0
    for entry in os.scandir(frames_dir):
        if not entry.is_dir():
            continue
        name = entry.name
        if name in progress["packed"]:
            continue
        ok = pack_asset(name, frames_dir, sheets_dir, love_dir, config)
        if ok:
            progress["packed"].append(name)
            packed_count += 1
        save_progress(progress_f, progress)

    log.info(f"Packed {packed_count} assets")

    # ── Global index ───────────────────────────────────────────────────────
    build_global_manifest(love_dir, frames_dir)
    log.info("Pipeline complete.")

    if progress["failed"]:
        log.warning(f"{len(progress['failed'])} assets failed to render: {progress['failed'][:10]}{'…' if len(progress['failed']) > 10 else ''}")


if __name__ == "__main__":
    main()
