"""
blender_render.py — Batch-render FBX assets to PNG sprite frames.

Usage (headless Blender):
    blender --background --python blender_render.py -- \
        --input  path/to/model.fbx \
        --output output/frames/my_model \
        --type   character \
        --config config.json

    # For animation frames:
        --anim   walk

Blender 3.6+ or 4.x required.
"""

import bpy
import sys
import os
import json
import math
import logging

# ── Parse args that come after "--" ────────────────────────────────────────
argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--input",   required=True,  help="Path to .fbx file")
parser.add_argument("--output",  required=True,  help="Output directory for PNG frames")
parser.add_argument("--type",    default="prop",  help="Asset type key from config.json")
parser.add_argument("--anim",    default=None,    help="Animation name to render (e.g. walk)")
parser.add_argument("--config",  default="config.json")
args = parser.parse_args(argv)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("blender_render")

with open(args.config) as f:
    CONFIG = json.load(f)

ASSET_CFG  = CONFIG["asset_types"].get(args.type, CONFIG["asset_types"]["prop"])
PIPE_CFG   = CONFIG["pipeline"]
LIGHT_CFG  = CONFIG["lighting"]

RESOLUTION  = ASSET_CFG["resolution"]
DIRECTIONS  = ASSET_CFG["directions"]          # list of Y-rotation angles in degrees
DIR_NAMES   = ASSET_CFG["direction_names"]
CAMERA_TYPE = ASSET_CFG.get("camera_type", PIPE_CFG.get("camera_type", "isometric"))


# ────────────────────────────────────────────────────────────────────────────
# Scene setup helpers
# ────────────────────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in bpy.data.meshes:     bpy.data.meshes.remove(block)
    for block in bpy.data.materials:  bpy.data.materials.remove(block)
    for block in bpy.data.armatures:  bpy.data.armatures.remove(block)
    for block in bpy.data.actions:    bpy.data.actions.remove(block)


def setup_render():
    scene  = bpy.context.scene
    engine = PIPE_CFG.get("renderer", "BLENDER_EEVEE_NEXT")

    try:
        scene.render.engine = engine
    except Exception:
        # Fallback: Blender 4.1 and earlier use BLENDER_EEVEE
        scene.render.engine = "BLENDER_EEVEE"

    if scene.render.engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        scene.eevee.taa_render_samples = PIPE_CFG.get("eevee_samples", 16)
    elif scene.render.engine == "CYCLES":
        scene.cycles.samples = PIPE_CFG.get("cycles_samples", 64)

    scene.render.film_transparent            = True
    scene.render.image_settings.file_format  = "PNG"
    scene.render.image_settings.color_mode   = "RGBA"
    scene.render.image_settings.color_depth  = "8"
    scene.render.resolution_x                = RESOLUTION
    scene.render.resolution_y                = RESOLUTION
    scene.render.resolution_percentage       = 100


def make_camera() -> bpy.types.Object:
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj, do_unlink=True)

    bpy.ops.object.camera_add()
    cam            = bpy.context.active_object
    cam.data.type  = "ORTHO"

    if CAMERA_TYPE == "isometric":
        # Standard game isometric: 54.736° elevation, 45° azimuth
        cam.rotation_euler = (math.radians(54.736), 0.0, math.radians(45.0))
    elif CAMERA_TYPE == "top_down":
        cam.rotation_euler = (0.0, 0.0, 0.0)
    elif CAMERA_TYPE == "side":
        cam.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    else:
        cam.rotation_euler = (math.radians(54.736), 0.0, math.radians(45.0))

    bpy.context.scene.camera = cam
    return cam


def setup_lighting():
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)

    # Key light (primary, top-left for isometric)
    bpy.ops.object.light_add(type="SUN", location=(6, -4, 10))
    key              = bpy.context.active_object
    key.data.energy  = LIGHT_CFG.get("key_energy", 3.0)
    key.rotation_euler = (math.radians(35), math.radians(10), math.radians(45))

    # Fill light (soft, opposite side)
    bpy.ops.object.light_add(type="SUN", location=(-5, 6, 7))
    fill             = bpy.context.active_object
    fill.data.energy = LIGHT_CFG.get("fill_energy", 1.2)
    fill.rotation_euler = (math.radians(50), 0.0, math.radians(-135))

    # Rim / back light (adds depth silhouette)
    bpy.ops.object.light_add(type="SUN", location=(0, 6, 4))
    rim              = bpy.context.active_object
    rim.data.energy  = LIGHT_CFG.get("rim_energy", 0.6)
    rim.rotation_euler = (math.radians(65), 0.0, math.radians(180))

    # Ambient (world shader strength)
    bpy.context.scene.world.node_tree.nodes["Background"].inputs[1].default_value = \
        LIGHT_CFG.get("ambient_strength", 0.3)


def get_mesh_objects() -> list:
    return [o for o in bpy.data.objects if o.type == "MESH"]


def get_scene_root_objects() -> list:
    """Return top-level objects (no parent) that are mesh or armature."""
    return [o for o in bpy.data.objects if o.parent is None and o.type in ("MESH", "ARMATURE")]


def compute_bounding_box(objects: list):
    """World-space AABB across all mesh objects."""
    import mathutils
    lo = mathutils.Vector((float("inf"),)  * 3)
    hi = mathutils.Vector((float("-inf"),) * 3)
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                if world[i] < lo[i]: lo[i] = world[i]
                if world[i] > hi[i]: hi[i] = world[i]
    return lo, hi


def fit_camera_to_scene(cam: bpy.types.Object, padding: float = None):
    import mathutils
    if padding is None:
        padding = PIPE_CFG.get("padding_factor", 1.15)

    meshes = get_mesh_objects()
    if not meshes:
        return

    lo, hi = compute_bounding_box(meshes)
    center = (lo + hi) / 2.0

    # Ensure matrix_world is current (rotation was set in make_camera before
    # objects were imported; Blender lazily recomputes the scene graph).
    bpy.context.view_layer.update()

    # Project all 8 bounding-box corners into camera space to measure the
    # true on-screen extents.  A plain max(x,y,z) underestimates how much
    # isometric projection expands a tall narrow object horizontally, and
    # how much a wide flat object expands vertically.
    cam_rot_inv = cam.matrix_world.to_3x3().inverted()
    corners = [
        mathutils.Vector((x, y, z))
        for x in (lo.x, hi.x)
        for y in (lo.y, hi.y)
        for z in (lo.z, hi.z)
    ]
    proj     = [cam_rot_inv @ (c - center) for c in corners]
    screen_w = max(p.x for p in proj) - min(p.x for p in proj)
    screen_h = max(p.y for p in proj) - min(p.y for p in proj)
    ortho_size = max(screen_w, screen_h)

    cam.data.ortho_scale = ortho_size * padding

    # Position camera facing the scene center at sufficient distance
    direction = cam.matrix_world.to_3x3() @ mathutils.Vector((0, 0, -1))
    size      = max(hi[i] - lo[i] for i in range(3))
    cam.location = center - direction * (size * 3)


def center_objects_at_origin(objects: list):
    """Drop the scene center to origin so rotations look correct."""
    import mathutils
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        return
    lo, hi = compute_bounding_box(meshes)
    center = (lo + hi) / 2.0
    offset = mathutils.Vector((-center.x, -center.y, -lo.z))  # floor at z=0
    for obj in objects:
        obj.location += offset


# ────────────────────────────────────────────────────────────────────────────
# Animation helpers
# ────────────────────────────────────────────────────────────────────────────

def get_action_by_keyword(keyword: str):
    """Find an action whose name contains keyword (case-insensitive)."""
    kw = keyword.lower()
    for action in bpy.data.actions:
        if kw in action.name.lower():
            return action
    return None


def get_armature():
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def render_animation(arm, action, asset_name: str, dir_name: str, out_dir: str, fps: int) -> list:
    """Render every frame of an action, return list of rendered PNG paths."""
    if arm is None or action is None:
        return []

    arm.animation_data_create()
    arm.animation_data.action = action

    scene = bpy.context.scene
    scene.render.fps = fps
    start = int(action.frame_range[0])
    end   = int(action.frame_range[1])
    paths = []

    for frame_num in range(start, end + 1):
        scene.frame_set(frame_num)
        out_path = os.path.join(out_dir, f"{asset_name}_{dir_name}_{frame_num:04d}.png")
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        paths.append(out_path)
        log.info(f"  frame {frame_num}/{end}: {out_path}")

    return paths


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────

# ────────────────────────────────────────────────────────────────────────────
# Texture helpers (umodel gltf doesn't embed texture URIs)
# ────────────────────────────────────────────────────────────────────────────

# Suffix → PBR slot mapping (lowercase match)
_TEX_SUFFIXES = {
    "cc":   ["_cc", "_d.", "_diffuse", "_basecolor", "_albedo", "_color"],
    "nm":   ["_nm", "_n.", "_normal"],
    "arm":  ["_aorame", "_arm", "_orme", "_orm", "_occlusionroughnessmetallic"],
    "em":   ["_em.", "_emissive"],
}


def _find_textures(asset_path: str) -> dict:
    """
    Search for PNG textures relative to the asset file.
    umodel layout varies: Textures/ may be a sibling, a parent, or several levels up.

    Strategy:
    1. Walk upward up to 4 levels looking for a Textures/ sibling.
    2. Within each Textures/ tree, prefer PNGs whose stem is similar to the mesh name.
    3. Fall back to any PNG matching the slot suffix pattern in that tree.

    Returns { slot: abs_path } e.g. { 'cc': '...T_Foo_cc.png', 'nm': '...T_Foo_nm.png' }
    """
    asset_stem = os.path.splitext(os.path.basename(asset_path))[0].lower()
    # Strip common prefixes (SM_, SK_, T_, etc.) to get the bare name for matching
    for prefix in ("sm_", "sk_", "s_", "t_"):
        if asset_stem.startswith(prefix):
            asset_stem = asset_stem[len(prefix):]
            break

    # Build candidate texture roots: walk upward from asset dir, up to 4 levels
    candidate_roots = []
    d = os.path.dirname(asset_path)
    for _ in range(5):
        t = os.path.join(d, "Textures")
        if os.path.isdir(t):
            candidate_roots.append(t)
        # Also check the directory itself for PNGs (some packs colocate textures)
        candidate_roots.append(d)
        d = os.path.dirname(d)
        if not d or d == os.path.dirname(d):
            break

    def _score_png(fname_lower: str) -> int:
        """Higher score = better match for this asset."""
        stem_words = [w for w in asset_stem.replace("_", " ").split() if len(w) > 2]
        return sum(1 for w in stem_words if w in fname_lower)

    result = {}
    for root in candidate_roots:
        if not os.path.isdir(root):
            continue
        # Collect all PNGs under this root
        all_pngs = []
        for dirpath, _, files in os.walk(root):
            for f in files:
                if f.lower().endswith(".png"):
                    all_pngs.append((os.path.join(dirpath, f), f.lower()))
        if not all_pngs:
            continue
        # Sort: prefer PNGs whose name overlaps with the mesh name
        all_pngs.sort(key=lambda x: -_score_png(x[1]))
        for abs_path, fname_lower in all_pngs:
            for slot, patterns in _TEX_SUFFIXES.items():
                if slot not in result:
                    for pat in patterns:
                        if pat in fname_lower:
                            result[slot] = abs_path
                            break
        if result:
            break
    return result


def _assign_textures(textures: dict):
    """
    Wire found PNG textures into every material in the scene using Principled BSDF.
    Blender 3.3+ uses ShaderNodeSeparateColor (not SeparateRGB).
    """
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links

        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            bsdf = nodes.new("ShaderNodeBsdfPrincipled")
            out = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
            if out:
                links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

        def _tex_node(path, label, non_color=False):
            img = bpy.data.images.load(path, check_existing=True)
            if non_color:
                img.colorspace_settings.name = "Non-Color"
            node = nodes.new("ShaderNodeTexImage")
            node.image = img
            node.label = label
            return node

        if "cc" in textures:
            t = _tex_node(textures["cc"], "Base Color")
            links.new(t.outputs["Color"], bsdf.inputs["Base Color"])

        if "nm" in textures:
            t = _tex_node(textures["nm"], "Normal", non_color=True)
            nmap = nodes.new("ShaderNodeNormalMap")
            links.new(t.outputs["Color"], nmap.inputs["Color"])
            links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

        if "arm" in textures:
            t = _tex_node(textures["arm"], "ARM", non_color=True)
            # R=AO, G=Roughness, B=Metallic (UE5 convention)
            sep = nodes.new("ShaderNodeSeparateColor")
            links.new(t.outputs["Color"], sep.inputs["Color"])
            links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
            links.new(sep.outputs["Blue"],  bsdf.inputs["Metallic"])

        if "em" in textures:
            t = _tex_node(textures["em"], "Emissive")
            links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0


def main():
    asset_name = os.path.splitext(os.path.basename(args.input))[0]
    out_dir    = args.output
    os.makedirs(out_dir, exist_ok=True)

    log.info(f"=== Rendering: {asset_name}  type={args.type}  anim={args.anim} ===")

    clear_scene()
    setup_render()
    cam = make_camera()
    setup_lighting()

    # Import asset (gltf or fbx)
    log.info(f"Importing: {args.input}")
    ext = os.path.splitext(args.input)[1].lower()
    if ext in (".gltf", ".glb"):
        bpy.ops.import_scene.gltf(filepath=args.input)
    else:
        bpy.ops.import_scene.fbx(
            filepath=args.input,
            use_anim=True,
            ignore_leaf_bones=True,
            force_connect_children=False,
            automatic_bone_orientation=True,
        )

    root_objects = get_scene_root_objects()
    if not root_objects:
        log.error("No objects imported. File may be empty or unreadable.")
        sys.exit(1)

    # umodel gltf exports don't embed texture URIs — find and assign manually
    textures = _find_textures(args.input)
    if textures:
        log.info(f"Textures found: {list(textures.keys())}")
        _assign_textures(textures)
    else:
        log.warning("No textures found — rendering with flat materials.")

    center_objects_at_origin(root_objects)
    fit_camera_to_scene(cam)

    manifest_frames = {}   # { frame_key: png_path }

    for i, angle_deg in enumerate(DIRECTIONS):
        dir_name = DIR_NAMES[i] if i < len(DIR_NAMES) else f"dir{angle_deg}"
        log.info(f"Direction: {dir_name} ({angle_deg}°)")

        # Rotate all root objects around Z
        for obj in root_objects:
            obj.rotation_euler[2] = math.radians(angle_deg)

        if args.anim and ASSET_CFG.get("export_animations"):
            # Animated render
            anim_fps = ASSET_CFG.get(f"{args.anim}_fps", 8)
            action   = get_action_by_keyword(args.anim)
            arm      = get_armature()

            if action is None:
                log.warning(f"No action found matching '{args.anim}'. Falling back to static.")
                out_path = os.path.join(out_dir, f"{asset_name}_{dir_name}_idle_0001.png")
                bpy.context.scene.render.filepath = out_path
                bpy.ops.render.render(write_still=True)
                manifest_frames[f"{asset_name}_{dir_name}_idle_0001"] = out_path
            else:
                paths = render_animation(arm, action, asset_name, dir_name, out_dir, anim_fps)
                for p in paths:
                    key = os.path.splitext(os.path.basename(p))[0]
                    manifest_frames[key] = p
        else:
            # Static render (single frame)
            out_path = os.path.join(out_dir, f"{asset_name}_{dir_name}.png")
            bpy.context.scene.render.filepath = out_path
            bpy.ops.render.render(write_still=True)
            manifest_frames[f"{asset_name}_{dir_name}"] = out_path
            log.info(f"  → {out_path}")

    # Write per-asset frame manifest
    manifest_path = os.path.join(out_dir, f"{asset_name}_frames.json")
    with open(manifest_path, "w") as mf:
        json.dump({
            "asset":   asset_name,
            "type":    args.type,
            "frames":  manifest_frames,
            "padding": PIPE_CFG.get("padding_factor", 1.15),
        }, mf, indent=2)

    log.info(f"Done: {len(manifest_frames)} frames written to {out_dir}")


main()
