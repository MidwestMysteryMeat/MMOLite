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
    Batch-extract StaticMesh + SkeletalMesh from a UE5 Content directory.

    umodel must be pointed at a specific content pack subdirectory — it does NOT
    recursively descend from the root Content/ folder on its own. We enumerate
    every first-level subdirectory and run umodel once per pack.

    umodel syntax:
        umodel -export -gltf -png -out=<dir> -path=<pack_subdir> */SM_* */SK_*
    """
    if not os.path.exists(umodel_exe):
        log.error(f"umodel.exe not found at: {umodel_exe}")
        log.error("Download from: https://www.gildor.org/en/projects/umodel")
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    # Enumerate first-level subdirectories (each is a Marketplace pack or engine folder)
    subdirs = sorted([
        d.path for d in os.scandir(input_path)
        if d.is_dir() and not d.name.startswith("__")
    ])
    log.info(f"Found {len(subdirs)} content packs under {input_path}")

    total_exported = 0
    for i, subdir in enumerate(subdirs):
        pack_name = os.path.basename(subdir)
        # Check if this pack has any SM_ or SK_ uassets before invoking umodel
        has_meshes = False
        for root, _, files in os.walk(subdir):
            if any(f.startswith(("SM_", "SK_")) and f.endswith(".uasset") for f in files):
                has_meshes = True
                break
        if not has_meshes:
            continue

        base = [
            umodel_exe,
            "-export",
            f"-out={output_dir}",
            f"-path={subdir}",
            "-gltf",
            "-png",
            "-nooverwrite",
        ]
        log.info(f"[{i+1}/{len(subdirs)}] {pack_name}")
        # Run one umodel call per pattern — passing multiple patterns in one call
        # causes umodel to exit on the first missing pattern, suppressing the summary line.
        for pat in ("*/SM_*", "*/SK_*"):
            cmd = base + [pat]
            try:
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
                if result.returncode not in (0, 1):
                    log.warning(f"  umodel exit {result.returncode} ({pat})")
                for line in (result.stdout or "").splitlines():
                    if line.startswith("Exported "):
                        log.info(f"  {pat}: {line}")
                        try:
                            total_exported += int(line.split()[1].split("/")[0])
                        except (IndexError, ValueError):
                            pass
                        break
            except subprocess.TimeoutExpired:
                log.warning(f"  TIMEOUT — {pack_name} {pat}")
            except FileNotFoundError:
                log.error(f"Cannot execute umodel at: {umodel_exe}")
                sys.exit(1)

    log.info(f"Extraction complete — {total_exported} objects exported across all packs")

    # Build manifest
    manifest = {"fbx_files": [], "texture_dirs": []}
    for root, _, files in os.walk(output_dir):
        for f in files:
            full = os.path.join(root, f)
            if f.lower().endswith((".gltf", ".glb", ".fbx")):
                manifest["fbx_files"].append(full)
            elif f.lower().endswith(".png"):
                if root not in manifest["texture_dirs"]:
                    manifest["texture_dirs"].append(root)

    manifest_path = os.path.join(output_dir, "export_manifest.json")
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf, indent=2)
    log.info(f"Manifest: {manifest_path}  ({len(manifest['fbx_files'])} mesh files)")

    _colocate_textures(output_dir)
    return manifest_path


def _colocate_textures(output_dir: str):
    """
    For each FBX in output_dir, find textures with the same relative path
    under Texture2D/ and copy them into the same directory as the FBX.
    """
    import shutil

    texture_root = os.path.join(output_dir, "Texture2D")
    if not os.path.isdir(texture_root):
        log.info("No Texture2D folder found — skipping texture co-location.")
        return

    # Build a lookup: relative_dir → [texture_paths]
    tex_by_reldir = {}
    for root, _, files in os.walk(texture_root):
        pngs = [os.path.join(root, f) for f in files if f.lower().endswith(".png")]
        if pngs:
            rel = os.path.relpath(root, texture_root)
            tex_by_reldir[rel] = pngs

    copied = 0
    for root, _, files in os.walk(output_dir):
        fbxs = [f for f in files if f.lower().endswith((".gltf", ".glb", ".fbx"))]
        if not fbxs:
            continue
        # Determine which mesh subfolder this is (StaticMesh, SkeletalMesh, etc.)
        rel_from_output = os.path.relpath(root, output_dir)
        parts = rel_from_output.replace("\\", "/").split("/")
        if len(parts) >= 2:
            # Strip the first component (e.g. "StaticMesh") to get the shared path
            shared_rel = os.path.join(*parts[1:]) if len(parts) > 1 else "."
        else:
            shared_rel = "."

        textures = tex_by_reldir.get(shared_rel, [])
        for tex_path in textures:
            dest = os.path.join(root, os.path.basename(tex_path))
            if not os.path.exists(dest):
                shutil.copy2(tex_path, dest)
                copied += 1

    log.info(f"Co-located {copied} texture files alongside FBX files.")


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
