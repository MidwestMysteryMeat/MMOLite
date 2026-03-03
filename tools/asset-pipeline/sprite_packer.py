"""
sprite_packer.py — Pack individual PNG frames into sprite sheets + JSON manifest.

Output JSON format is compatible with LÖVE 2D sprite-sheet.lua loader.

Usage:
    python sprite_packer.py \
        --frames  output/frames/my_model \
        --output  output/sheets \
        --name    my_model \
        --type    character \
        --config  config.json

    # Or pack an entire category:
    python sprite_packer.py --pack-all --config config.json
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Pillow not installed.  Run:  pip install Pillow")
    sys.exit(1)

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("sprite_packer")


# ────────────────────────────────────────────────────────────────────────────
# Bin-packing (shelf algorithm — fast enough for sprite sheets)
# ────────────────────────────────────────────────────────────────────────────

class ShelfPacker:
    def __init__(self, max_w: int, max_h: int):
        self.max_w   = max_w
        self.max_h   = max_h
        self.shelves = []   # [(shelf_y, shelf_h, cursor_x)]
        self.placements = []  # [(key, x, y, w, h)]

    def pack(self, key: str, w: int, h: int) -> tuple | None:
        """Try to place a rect of (w, h). Returns (x, y) or None if no room."""
        # Try existing shelves first
        for i, (sy, sh, cx) in enumerate(self.shelves):
            if h <= sh and cx + w <= self.max_w:
                x, y = cx, sy
                self.shelves[i] = (sy, sh, cx + w)
                self.placements.append((key, x, y, w, h))
                return x, y
        # Open a new shelf
        used_h = sum(sh for _, sh, _ in self.shelves)
        if used_h + h > self.max_h:
            return None  # Sheet full
        sy = used_h
        self.shelves.append((sy, h, w))
        self.placements.append((key, w + 0 - w, sy, w, h))   # x=0
        self.placements[-1] = (key, 0, sy, w, h)
        return 0, sy

    def total_height(self) -> int:
        return sum(sh for _, sh, _ in self.shelves)


# ────────────────────────────────────────────────────────────────────────────
# Core packer
# ────────────────────────────────────────────────────────────────────────────

def trim_alpha(img: Image.Image) -> tuple:
    """Return (trimmed_img, (offset_x, offset_y, original_w, original_h))."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    bbox = img.getbbox()
    if bbox is None:
        return img, (0, 0, img.width, img.height)
    trimmed = img.crop(bbox)
    return trimmed, (bbox[0], bbox[1], img.width, img.height)


def infer_animation_groups(frame_keys: list) -> dict:
    """
    Group frame keys by animation name.
    Pattern: <asset>_<direction>_<frame_number>
    e.g. goblin_walk_south_0001 → group 'goblin_walk_south'

    Returns { group_name: [frame_key_in_order, ...] }
    """
    groups = {}
    pattern = re.compile(r"^(.+?)_(\d{4})$")
    for key in frame_keys:
        m = pattern.match(key)
        if m:
            group = m.group(1)
        else:
            group = key  # static sprite — its own group
        groups.setdefault(group, []).append(key)

    # Sort frames within each group numerically
    for g in groups:
        groups[g].sort()

    return groups


def pack_frames(
    frame_dir:  str,
    output_dir: str,
    sheet_name: str,
    max_sheet:  int = 2048,
    trim:       bool = True,
) -> dict:
    """
    Load all PNGs from frame_dir, pack into one or more sheets.
    Returns the manifest dict.
    """
    os.makedirs(output_dir, exist_ok=True)

    # Collect all PNG files
    frame_files = sorted(Path(frame_dir).glob("*.png"))
    if not frame_files:
        log.error(f"No PNG files found in {frame_dir}")
        return {}

    log.info(f"Packing {len(frame_files)} frames from {frame_dir}")

    # Load images
    frames = {}   # key → PIL Image (trimmed)
    offsets = {}  # key → (ox, oy, orig_w, orig_h)
    for fp in frame_files:
        key = fp.stem
        img = Image.open(fp).convert("RGBA")
        if trim:
            img, off = trim_alpha(img)
            offsets[key] = off
        else:
            offsets[key] = (0, 0, img.width, img.height)
        frames[key] = img

    # Sort by height descending for better shelf packing
    sorted_keys = sorted(frames.keys(), key=lambda k: -frames[k].height)

    manifest = {
        "meta": {
            "version":    "1.0",
            "generator":  "MMOLite Asset Pipeline",
            "sheet_name": sheet_name,
            "max_size":   max_sheet,
        },
        "sheets": [],
        "frames": {},
        "animations": {},
    }

    sheet_idx = 0
    remaining = list(sorted_keys)

    while remaining:
        packer    = ShelfPacker(max_sheet, max_sheet)
        placed    = []
        unplaced  = []

        for key in remaining:
            img = frames[key]
            result = packer.pack(key, img.width, img.height)
            if result is not None:
                placed.append(key)
            else:
                unplaced.append(key)

        # Build the actual sheet image
        sheet_w = max_sheet
        sheet_h = packer.total_height()
        sheet   = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))

        for (key, x, y, w, h) in packer.placements:
            sheet.paste(frames[key], (x, y))
            ox, oy, orig_w, orig_h = offsets[key]
            manifest["frames"][key] = {
                "sheet":    sheet_idx,
                "frame":    {"x": x, "y": y, "w": w, "h": h},
                "trimmed":  trim,
                "offset":   {"x": ox, "y": oy},
                "source":   {"w": orig_w, "h": orig_h},
            }

        sheet_filename = f"{sheet_name}_{sheet_idx:02d}.png"
        sheet_path     = os.path.join(output_dir, sheet_filename)
        sheet.save(sheet_path, "PNG", optimize=False)
        manifest["sheets"].append(sheet_filename)
        log.info(f"  Sheet {sheet_idx}: {sheet_filename}  ({sheet_w}×{sheet_h})  [{len(placed)} frames]")

        sheet_idx += 1
        remaining  = unplaced

    # Build animation groups
    all_frame_keys = list(manifest["frames"].keys())
    groups = infer_animation_groups(all_frame_keys)
    for group_name, frame_list in groups.items():
        if len(frame_list) > 1:
            manifest["animations"][group_name] = frame_list

    # Write manifest
    manifest_path = os.path.join(output_dir, f"{sheet_name}.json")
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf, indent=2)
    log.info(f"Manifest: {manifest_path}  ({len(manifest['frames'])} frames, {len(manifest['animations'])} animations)")

    return manifest


def copy_sheets_to_love(manifest_path: str, love_dir: str):
    """Copy finished sheets + JSON to the LÖVE 2D assets directory."""
    import shutil
    manifest_dir = os.path.dirname(manifest_path)
    with open(manifest_path) as f:
        manifest = json.load(f)

    os.makedirs(love_dir, exist_ok=True)
    shutil.copy2(manifest_path, love_dir)
    for sheet in manifest["sheets"]:
        src = os.path.join(manifest_dir, sheet)
        if os.path.exists(src):
            shutil.copy2(src, love_dir)
    log.info(f"Copied {len(manifest['sheets'])+1} files to {love_dir}")


# ────────────────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Pack PNG frames into sprite sheets")
    parser.add_argument("--frames",    help="Directory of PNG frames")
    parser.add_argument("--output",    help="Output directory for sprite sheets")
    parser.add_argument("--name",      help="Sheet base name (e.g. goblin)")
    parser.add_argument("--type",      default="prop")
    parser.add_argument("--config",    default="config.json")
    parser.add_argument("--pack-all",  action="store_true", help="Pack all frame dirs in output/frames/")
    parser.add_argument("--copy-love", action="store_true", help="Copy results to LÖVE assets dir")
    parser.add_argument("--no-trim",   action="store_true", help="Disable alpha trimming")
    args = parser.parse_args()

    with open(args.config) as f:
        config = json.load(f)

    if args.pack_all:
        frames_root  = config["output"]["frames_dir"]
        sheets_root  = config["output"]["sheets_dir"]
        love_root    = config["output"]["love_assets_dir"]
        for entry in sorted(os.scandir(frames_root), key=lambda e: e.name):
            if not entry.is_dir():
                continue
            sheet_name    = entry.name
            asset_type    = "prop"  # default; pipeline_runner sets a sub-dir per type
            asset_cfg     = config["asset_types"].get(asset_type, {})
            max_size      = asset_cfg.get("sheet_max_size", 2048)
            manifest      = pack_frames(
                frame_dir  = entry.path,
                output_dir = os.path.join(sheets_root, sheet_name),
                sheet_name = sheet_name,
                max_sheet  = max_size,
                trim       = not args.no_trim,
            )
            if args.copy_love and manifest:
                mpath = os.path.join(sheets_root, sheet_name, f"{sheet_name}.json")
                copy_sheets_to_love(mpath, os.path.join(love_root, sheet_name))
    else:
        if not args.frames or not args.name:
            parser.error("--frames and --name are required unless --pack-all")

        asset_cfg  = config["asset_types"].get(args.type, {})
        max_size   = asset_cfg.get("sheet_max_size", 2048)
        out_dir    = args.output or os.path.join(config["output"]["sheets_dir"], args.name)

        manifest = pack_frames(
            frame_dir  = args.frames,
            output_dir = out_dir,
            sheet_name = args.name,
            max_sheet  = max_size,
            trim       = not args.no_trim,
        )

        if args.copy_love and manifest:
            mpath = os.path.join(out_dir, f"{args.name}.json")
            copy_sheets_to_love(mpath, os.path.join(config["output"]["love_assets_dir"], args.name))
