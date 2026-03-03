"""
watch_queue.py — Watch a folder for new FBX files and auto-process them.

Drops new FBX files into a watched directory → automatically classified,
rendered, packed, and copied to client/assets/sprites/.

Usage:
    pip install watchdog
    python watch_queue.py \
        --watch-dir  D:/pipeline/incoming \
        --blender    "C:/Program Files/Blender Foundation/Blender 4.1/blender.exe" \
        --workers    2 \
        --config     config.json

Drop any .fbx into D:/pipeline/incoming/ → it appears in the game automatically.
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from queue import Queue, Empty

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    print("watchdog not installed.  Run:  pip install watchdog")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("watch_queue.log", mode="a"),
    ],
)
log = logging.getLogger("watch_queue")

# ─────────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--watch-dir", required=True, help="Drop FBX files here")
    p.add_argument("--blender",   required=True, help="Path to blender.exe")
    p.add_argument("--config",    default="config.json")
    p.add_argument("--slots",     default="equipment_slots.json")
    p.add_argument("--workers",   type=int, default=2)
    p.add_argument("--all-anims", action="store_true",
                   help="Render every animation found in each FBX (not just idle)")
    return p.parse_args()


# ── FBX file queue + worker pool ──────────────────────────────────────────────

work_queue = Queue()


class FBXHandler(FileSystemEventHandler):
    """Watchdog event handler — enqueues new / moved-in FBX files."""
    def _enqueue(self, path):
        if path.lower().endswith(".fbx") and os.path.isfile(path):
            log.info(f"Detected: {os.path.basename(path)}")
            work_queue.put(path)

    def on_created(self, event):
        if not event.is_directory:
            # Wait briefly — file may still be copying
            time.sleep(1.5)
            self._enqueue(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._enqueue(event.dest_path)


def classify_one(fbx_path: str, blender_exe: str, config_path: str) -> dict:
    """Run auto_classify.py on a single file to get its type + animations."""
    tmpout = fbx_path + ".classify.json"
    classify_script = os.path.join(os.path.dirname(__file__), "auto_classify.py")
    cmd = [
        blender_exe, "--background",
        "--python", classify_script,
        "--",
        "--scan-dir", os.path.dirname(fbx_path),
        "--output",  tmpout,
    ]
    try:
        subprocess.run(cmd, capture_output=True, timeout=120)
        if os.path.exists(tmpout):
            with open(tmpout) as f:
                data = json.load(f)
            os.remove(tmpout)
            norm = fbx_path.replace("\\", "/")
            return data.get(norm, {})
    except Exception as e:
        log.warning(f"classify failed for {os.path.basename(fbx_path)}: {e}")
    return {}


def render_one(fbx_path: str, asset_type: str, anim: str,
               blender_exe: str, config_path: str) -> bool:
    """Run blender_render.py for one FBX."""
    asset_name  = Path(fbx_path).stem
    frames_dir  = json.load(open(config_path))["output"]["frames_dir"]
    out_dir     = os.path.join(frames_dir, asset_name)
    marker      = os.path.join(out_dir, f"{asset_name}_frames.json")
    if os.path.exists(marker):
        log.info(f"Already rendered: {asset_name}")
        return True

    render_script = os.path.join(os.path.dirname(__file__), "blender_render.py")
    cmd = [
        blender_exe, "--background",
        "--python", render_script,
        "--",
        "--input",  fbx_path,
        "--output", out_dir,
        "--type",   asset_type,
        "--config", config_path,
        "--anim",   anim,
    ]
    log.info(f"Rendering [{asset_type}][{anim}]: {asset_name}")
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=600)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        log.error(f"Timeout: {asset_name}")
        return False


def pack_one(asset_name: str, config: dict):
    """Pack frames for one asset — runs in-process."""
    sys.path.insert(0, os.path.dirname(__file__))
    import sprite_packer
    frames_dir = config["output"]["frames_dir"]
    sheets_dir = config["output"]["sheets_dir"]
    love_dir   = config["output"]["love_assets_dir"]
    frame_dir  = os.path.join(frames_dir, asset_name)
    sheet_out  = os.path.join(sheets_dir, asset_name)
    love_out   = os.path.join(love_dir, asset_name)
    manifest   = sprite_packer.pack_frames(
        frame_dir=frame_dir, output_dir=sheet_out,
        sheet_name=asset_name, max_sheet=2048, trim=True,
    )
    if manifest:
        mpath = os.path.join(sheet_out, f"{asset_name}.json")
        sprite_packer.copy_sheets_to_love(mpath, love_out)
        log.info(f"  → {love_out}")


def worker(blender_exe: str, config_path: str, all_anims: bool):
    """Worker thread: dequeue FBX → classify → render all anims → pack."""
    config = json.load(open(config_path))
    while True:
        try:
            fbx_path = work_queue.get(timeout=5)
        except Empty:
            continue

        asset_name = Path(fbx_path).stem
        log.info(f"Processing: {asset_name}")

        # 1. Classify
        info       = classify_one(fbx_path, blender_exe, config_path)
        asset_type = info.get("asset_type", "prop")
        anims      = info.get("animations", ["idle"]) if all_anims else \
                     [info.get("animations", ["idle"])[0]] if info.get("animations") else ["idle"]

        log.info(f"  Type: {asset_type}  Anims: {anims}")

        # 2. Render each animation
        all_ok = True
        for anim in (anims or ["idle"]):
            ok = render_one(fbx_path, asset_type, anim, blender_exe, config_path)
            if not ok:
                log.warning(f"  Render failed: {asset_name} / {anim}")
                all_ok = False

        # 3. Pack
        if all_ok or True:   # pack what we have even on partial failure
            try:
                pack_one(asset_name, config)
            except Exception as e:
                log.error(f"  Pack failed: {e}")

        work_queue.task_done()
        log.info(f"Complete: {asset_name}")


# ── Entry ─────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    os.makedirs(args.watch_dir, exist_ok=True)
    config_path = os.path.abspath(args.config)

    log.info(f"Watching: {args.watch_dir}")
    log.info(f"Workers:  {args.workers}  |  All-anims: {args.all_anims}")

    # Enqueue any FBX files already sitting in the watch dir
    for fn in os.listdir(args.watch_dir):
        if fn.lower().endswith(".fbx"):
            work_queue.put(os.path.join(args.watch_dir, fn))

    # Start worker threads
    for _ in range(args.workers):
        t = threading.Thread(
            target=worker,
            args=(args.blender, config_path, args.all_anims),
            daemon=True,
        )
        t.start()

    # Start watchdog observer
    observer = Observer()
    observer.schedule(FBXHandler(), path=args.watch_dir, recursive=False)
    observer.start()

    log.info("Ready — drop .fbx files into the watch directory.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
