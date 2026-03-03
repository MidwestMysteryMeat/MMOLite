"""
auto_classify.py — Analyze FBX files using Blender to produce a detailed
classification cache WITHOUT rendering anything.

Runs a quick Blender scene import, reads mesh bounds + bone structure,
writes a JSON classification that run_pipeline.py reads instead of doing
keyword guessing.

Usage:
    blender --background --python auto_classify.py -- \
        --scan-dir  D:/pipeline/fbx \
        --output    D:/pipeline/fbx_manifest.json

Then pass --manifest to run_pipeline.py:
    python run_pipeline.py --manifest D:/pipeline/fbx_manifest.json ...

Speed: ~1-3 seconds per FBX (no rendering). A thousand assets = ~30 minutes.
Safe to interrupt and resume — already-classified assets are skipped.
"""

import bpy
import sys
import os
import json
import math

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--scan-dir", required=True,  help="Root dir to walk for FBX files")
parser.add_argument("--output",   required=True,  help="Output JSON manifest path")
parser.add_argument("--resume",   action="store_true", help="Skip already-classified files")
args = parser.parse_args(argv)

print(f"[classify] Scanning: {args.scan_dir}")

# ── Helpers ──────────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for d in [bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials]:
        for b in list(d):
            d.remove(b)


def import_fbx(path):
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.fbx(
            filepath=path,
            use_anim=True,
            ignore_leaf_bones=True,
            automatic_bone_orientation=True,
        )
    except Exception as e:
        print(f"  [ERROR] FBX import failed: {e}")
        return [], []
    after   = set(bpy.data.objects)
    new_obj = list(after - before)
    return [o for o in new_obj if o.type == "MESH"], [o for o in new_obj if o.type == "ARMATURE"]


def get_bounds(meshes):
    import mathutils
    if not meshes:
        return None
    lo = mathutils.Vector((float("inf"),) * 3)
    hi = mathutils.Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    size = hi - lo
    return {
        "x": round(float(size.x), 3),
        "y": round(float(size.y), 3),
        "z": round(float(size.z), 3),
        "volume": round(float(size.x * size.y * size.z), 3),
        "footprint": round(float(size.x * size.y), 3),
    }


def get_animation_names(actions):
    return [a.name for a in actions]


def classify(fbx_path, meshes, arms, bounds, anim_names):
    """
    Rule-based classification from FBX structure analysis.
    Priority: structural analysis > name keywords.
    """
    name_low = os.path.basename(fbx_path).lower()
    path_low = fbx_path.replace("\\", "/").lower()

    bone_count = sum(len(a.data.bones) for a in arms) if arms else 0
    has_arm    = bone_count > 0
    mesh_count = len(meshes)
    volume     = bounds["volume"] if bounds else 0
    footprint  = bounds["footprint"] if bounds else 0
    height     = bounds["z"] if bounds else 0

    # ── Structural rules (most reliable) ─────────────────────────────────
    if has_arm and bone_count >= 15 and mesh_count >= 1:
        # Fully-rigged character / creature
        return "character", 0.95

    if has_arm and 3 <= bone_count < 15:
        # Simple rigged prop — could be weapon, simple creature
        if any(k in name_low for k in ("weapon", "sword", "axe", "bow", "staff", "shield")):
            return "weapon", 0.9
        return "prop", 0.75

    if not has_arm:
        if volume > 500 or footprint > 200:
            # Large static mesh → building / terrain structure
            if height / max(bounds["x"], bounds["y"], 0.01) > 1.5:
                return "building", 0.85   # tall = tower/structure
            return "building", 0.80
        if volume > 50:
            return "prop", 0.80
        # Small static mesh → item / weapon icon / detail
        if any(k in name_low for k in ("weapon", "sword", "axe", "bow", "staff", "mace", "dagger", "spear")):
            return "weapon", 0.9
        return "item", 0.7

    return "prop", 0.5


def discover_animations(arms):
    """Find all unique animation keywords across all actions."""
    keywords = set()
    kw_map   = {}
    common   = ["idle", "walk", "run", "attack", "cast", "death", "hurt", "jump",
                 "strafe", "dodge", "emote", "victory", "fly", "swim", "crouch"]
    for action in bpy.data.actions:
        name_low = action.name.lower()
        for kw in common:
            if kw in name_low:
                keywords.add(kw)
                kw_map[kw] = kw_map.get(kw, action.name)
    return list(keywords), kw_map


# ── Main scan loop ────────────────────────────────────────────────────────────

existing = {}
if args.resume and os.path.exists(args.output):
    with open(args.output) as f:
        existing = json.load(f)

manifest = dict(existing)   # { fbx_path → classification_dict }

fbx_files = []
for root, _, files in os.walk(args.scan_dir):
    for fn in files:
        if fn.lower().endswith(".fbx"):
            fbx_files.append(os.path.join(root, fn))

print(f"[classify] Found {len(fbx_files)} FBX files")
for idx, fbx_path in enumerate(fbx_files):
    norm = fbx_path.replace("\\", "/")

    if args.resume and norm in manifest:
        print(f"  [{idx+1}/{len(fbx_files)}] SKIP: {os.path.basename(fbx_path)}")
        continue

    print(f"  [{idx+1}/{len(fbx_files)}] {os.path.basename(fbx_path)}")
    clear_scene()

    meshes, arms = import_fbx(fbx_path)
    bounds       = get_bounds(meshes)
    anim_names   = get_animation_names(bpy.data.actions)
    asset_type, confidence = classify(fbx_path, meshes, arms, bounds, anim_names)
    detected_anims, anim_map = discover_animations(arms)

    manifest[norm] = {
        "path":         norm,
        "asset_type":   asset_type,
        "confidence":   confidence,
        "mesh_count":   len(meshes),
        "bone_count":   sum(len(a.data.bones) for a in arms),
        "has_armature": len(arms) > 0,
        "bounds":       bounds,
        "animations":   detected_anims,
        "anim_map":     anim_map,
        "all_actions":  anim_names,
    }

    # Save incrementally so interruption doesn't lose progress
    with open(args.output, "w") as f:
        json.dump(manifest, f, indent=2)

print(f"[classify] Done. Manifest: {args.output} ({len(manifest)} assets)")

# Print summary
from collections import Counter
types = Counter(v["asset_type"] for v in manifest.values())
for t, n in sorted(types.items()):
    print(f"  {t:12s}: {n}")
