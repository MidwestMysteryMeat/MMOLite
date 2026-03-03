"""
ue5_export.py — Batch-export UE5 assets to FBX.

Two modes:
  1. Inside UE5 editor (Python scripting plugin enabled):
       Edit > Execute Python Script > ue5_export.py
  2. CLI via umodel (UEViewer) — no UE5 required, works on raw .pak/.uasset.
       python ue5_export.py --mode umodel --input D:/MyProject/Content --output D:/fbx_out

Requirements:
  Mode 1: Unreal Engine 5 with Python Editor Script Plugin enabled
  Mode 2: umodel.exe  (https://www.gildor.org/en/projects/umodel) + Python 3.10+
"""

import argparse
import os
import sys
import json
import subprocess
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("ue5_export")

# ---------------------------------------------------------------------------
# Mode 1: UE5 Python API  (run this block from inside the UE5 editor)
# ---------------------------------------------------------------------------
def export_via_ue5_api(content_root: str, output_dir: str, asset_types: list):
    """
    Run inside UE5 editor:
        import ue5_export; ue5_export.export_via_ue5_api('/Game/', 'D:/fbx_out', ['StaticMesh','SkeletalMesh'])

    Requires: Edit > Plugins > Python Editor Script Plugin = enabled
    """
    try:
        import unreal
    except ImportError:
        log.error("unreal module not found — run this inside the UE5 editor.")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    registry   = unreal.AssetRegistryHelpers.get_asset_registry()
    filter_obj = unreal.ARFilter(
        class_names=asset_types,   # e.g. ['StaticMesh', 'SkeletalMesh']
        recursive_paths=True,
        package_paths=[content_root],
    )
    assets = registry.get_assets(filter_obj)
    log.info(f"Found {len(assets)} assets under {content_root}")

    task_list = []
    skipped   = 0
    for asset_data in assets:
        asset = unreal.EditorAssetLibrary.load_asset(str(asset_data.package_name))
        if not asset:
            skipped += 1
            continue

        rel_path  = str(asset_data.package_name).lstrip("/Game/").replace("/", os.sep)
        fbx_path  = os.path.join(output_dir, rel_path + ".fbx")
        os.makedirs(os.path.dirname(fbx_path), exist_ok=True)

        if os.path.exists(fbx_path):
            log.info(f"  SKIP (exists): {fbx_path}")
            skipped += 1
            continue

        task = unreal.AssetExportTask()
        task.object          = asset
        task.filename        = fbx_path
        task.selected        = False
        task.replace_identical = True
        task.prompt          = False
        task.automated       = True
        task_list.append(task)

    log.info(f"Exporting {len(task_list)} assets  ({skipped} skipped/missing)")
    if task_list:
        unreal.ExporterFBX.run_asset_export_tasks(task_list)
    log.info("UE5 FBX export complete.")


# ---------------------------------------------------------------------------
# Mode 2: umodel (UEViewer) — no UE5 editor needed, reads raw .pak / .uasset
# ---------------------------------------------------------------------------
def export_via_umodel(input_path: str, output_dir: str, umodel_exe: str, game_version: str = "ue5"):
    """
    Batch-extract meshes + textures using umodel.
    umodel.exe download: https://www.gildor.org/en/projects/umodel

    Args:
        input_path:   Path to Content/ directory or .pak files.
        output_dir:   Where to write extracted FBX + textures.
        umodel_exe:   Path to umodel.exe
        game_version: UE version hint, e.g. 'ue5', 'ue4.27'
    """
    if not os.path.exists(umodel_exe):
        log.error(f"umodel.exe not found at: {umodel_exe}")
        log.error("Download from: https://www.gildor.org/en/projects/umodel")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # umodel export command:
    #   -export          → export mode (not view)
    #   -all             → all supported asset classes
    #   -out=<dir>       → output directory
    #   -fbx             → FBX format for meshes
    #   -png             → PNG for textures
    #   -<game>          → engine version hint
    cmd = [
        umodel_exe,
        "-export",
        "-all",
        f"-out={output_dir}",
        "-fbx",       # mesh format
        "-png",       # texture format
        f"-{game_version}",
        input_path,
    ]

    log.info(f"Running umodel: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=False, text=True)
        if result.returncode != 0:
            log.warning(f"umodel exited with code {result.returncode}")
    except FileNotFoundError:
        log.error(f"Cannot execute umodel at: {umodel_exe}")
        sys.exit(1)

    # Walk output and build a manifest of all exported FBX files
    manifest = {"fbx_files": [], "texture_dirs": []}
    for root, dirs, files in os.walk(output_dir):
        for f in files:
            full = os.path.join(root, f)
            if f.lower().endswith(".fbx"):
                manifest["fbx_files"].append(full)
            elif f.lower().endswith(".png"):
                tdir = root
                if tdir not in manifest["texture_dirs"]:
                    manifest["texture_dirs"].append(tdir)

    manifest_path = os.path.join(output_dir, "export_manifest.json")
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf, indent=2)
    log.info(f"Manifest written: {manifest_path} ({len(manifest['fbx_files'])} FBX files)")
    return manifest_path


# ---------------------------------------------------------------------------
# Scan + classify FBX files into asset type buckets (for pipeline_runner.py)
# ---------------------------------------------------------------------------
def classify_fbx_files(fbx_root: str, config: dict) -> dict:
    """
    Walk fbx_root, match each file to an asset type based on config keywords.
    Returns { asset_type: [filepath, ...] }.
    """
    buckets = {t: [] for t in config["asset_types"].keys()}
    buckets["unknown"] = []

    for root, _, files in os.walk(fbx_root):
        for f in files:
            if not f.lower().endswith(".fbx"):
                continue
            path     = os.path.join(root, f)
            name_low = f.lower()

            matched = False
            for asset_type, cfg in config["asset_types"].items():
                for kw in cfg.get("match_keywords", []):
                    if kw in name_low or kw in root.lower():
                        buckets[asset_type].append(path)
                        matched = True
                        break
                if matched:
                    break
            if not matched:
                buckets["unknown"].append(path)

    for t, files in buckets.items():
        log.info(f"  {t:12s}: {len(files)} FBX files")
    return buckets


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export UE5 assets to FBX")
    parser.add_argument("--mode",    choices=["ue5api", "umodel", "classify"], required=True)
    parser.add_argument("--input",   help="Content root or .pak path")
    parser.add_argument("--output",  help="Output directory for FBX files")
    parser.add_argument("--umodel",  default="tools/umodel/umodel.exe", help="Path to umodel.exe")
    parser.add_argument("--game",    default="ue5", help="UE version for umodel (ue5, ue4.27...)")
    parser.add_argument("--config",  default="config.json")
    args = parser.parse_args()

    with open(args.config) as f:
        cfg = json.load(f)

    if args.mode == "ue5api":
        export_via_ue5_api(
            content_root="/Game/",
            output_dir=args.output or "output/fbx",
            asset_types=["StaticMesh", "SkeletalMesh"],
        )
    elif args.mode == "umodel":
        export_via_umodel(
            input_path=args.input,
            output_dir=args.output or "output/fbx",
            umodel_exe=args.umodel,
            game_version=args.game,
        )
    elif args.mode == "classify":
        buckets = classify_fbx_files(args.input, cfg)
        out = args.output or "output/classified.json"
        with open(out, "w") as f:
            json.dump(buckets, f, indent=2)
        log.info(f"Classification written to {out}")
