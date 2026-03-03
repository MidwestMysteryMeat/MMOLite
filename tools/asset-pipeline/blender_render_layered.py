"""
blender_render_layered.py — Render a character + equipment as separate transparent layers.

The critical rule: every layer uses IDENTICAL camera position, lighting, frame number,
and armature pose. This guarantees they composite perfectly at runtime with no seams.

Usage:
    blender --background --python blender_render_layered.py -- \
        --char    path/to/human_male.fbx \
        --output  output/frames/human_male \
        --config  config.json \
        --slots   equipment_slots.json \
        --anim    walk \
        --equip   chest:path/to/plate_chest.fbx  weapon_r:path/to/iron_sword.fbx

    # Render base character only (no equipment):
        --char path/to/human_male.fbx --output output/frames/human_male

    # Render a single equipment piece against existing character rig:
        --char path/to/human_male.fbx --equip chest:path/to/cloth_robe.fbx \
        --layer-only  (skips re-rendering body_base)
"""

import bpy
import sys
import os
import json
import math
import logging

argv = sys.argv
if "--" in argv:
    argv = argv[argv.index("--") + 1:]
else:
    argv = []

import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--char",     required=True,  help="Path to character .fbx (with armature)")
parser.add_argument("--output",   required=True,  help="Output directory")
parser.add_argument("--config",   default="config.json")
parser.add_argument("--slots",    default="equipment_slots.json")
parser.add_argument("--anim",     default="idle",  help="Animation keyword to render")
parser.add_argument("--equip",    nargs="*", default=[], help="slot:path pairs e.g. chest:robe.fbx weapon_r:sword.fbx")
parser.add_argument("--layer-only", action="store_true", help="Skip body_base render")
parser.add_argument("--skeleton-preset", default="epic", help="Bone name preset: epic|mixamo|bip01")
args = parser.parse_args(argv)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("blender_layered")

with open(args.config) as f:
    CONFIG = json.load(f)
with open(args.slots) as f:
    SLOTS_CFG = json.load(f)

ASSET_CFG   = CONFIG["asset_types"]["character"]
PIPE_CFG    = CONFIG["pipeline"]
LIGHT_CFG   = CONFIG["lighting"]
RESOLUTION  = ASSET_CFG["resolution"]
DIRECTIONS  = ASSET_CFG["directions"]
DIR_NAMES   = ASSET_CFG["direction_names"]

# Parse equip args: ["chest:robe.fbx", "weapon_r:sword.fbx"] → {"chest": "robe.fbx", ...}
EQUIP_MAP = {}
for pair in args.equip:
    if ":" in pair:
        slot, path = pair.split(":", 1)
        EQUIP_MAP[slot.strip()] = path.strip()

SKEL_PRESET = SLOTS_CFG["skeleton_presets"].get(args.skeleton_preset, {})


# ────────────────────────────────────────────────────────────────────────────
# Scene setup (identical to blender_render.py — must stay in sync)
# ────────────────────────────────────────────────────────────────────────────

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for d in [bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions]:
        for block in list(d):
            d.remove(block)


def setup_render():
    scene  = bpy.context.scene
    engine = PIPE_CFG.get("renderer", "BLENDER_EEVEE_NEXT")
    try:
        scene.render.engine = engine
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples  = PIPE_CFG.get("eevee_samples", 16)
    scene.render.film_transparent    = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode  = "RGBA"
    scene.render.resolution_x        = RESOLUTION
    scene.render.resolution_y        = RESOLUTION
    scene.render.resolution_percentage = 100


def make_camera():
    for obj in list(bpy.data.objects):
        if obj.type == "CAMERA":
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.data.type = "ORTHO"
    cam.rotation_euler = (math.radians(54.736), 0.0, math.radians(45.0))  # isometric
    bpy.context.scene.camera = cam
    return cam


def setup_lighting():
    for obj in list(bpy.data.objects):
        if obj.type == "LIGHT":
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.light_add(type="SUN", location=(6, -4, 10))
    k = bpy.context.active_object
    k.data.energy = LIGHT_CFG.get("key_energy", 3.0)
    k.rotation_euler = (math.radians(35), math.radians(10), math.radians(45))
    bpy.ops.object.light_add(type="SUN", location=(-5, 6, 7))
    f = bpy.context.active_object
    f.data.energy = LIGHT_CFG.get("fill_energy", 1.2)
    f.rotation_euler = (math.radians(50), 0.0, math.radians(-135))
    bpy.ops.object.light_add(type="SUN", location=(0, 6, 4))
    r = bpy.context.active_object
    r.data.energy = LIGHT_CFG.get("rim_energy", 0.6)
    r.rotation_euler = (math.radians(65), 0.0, math.radians(180))
    bpy.context.scene.world.node_tree.nodes["Background"].inputs[1].default_value = \
        LIGHT_CFG.get("ambient_strength", 0.3)


def import_fbx(filepath, link_armature=None):
    """Import FBX, return (mesh_objects, armature_object)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(
        filepath=filepath,
        use_anim=True,
        ignore_leaf_bones=True,
        force_connect_children=False,
        automatic_bone_orientation=True,
    )
    after    = set(bpy.data.objects)
    new_objs = list(after - before)
    meshes   = [o for o in new_objs if o.type == "MESH"]
    arms     = [o for o in new_objs if o.type == "ARMATURE"]
    arm      = arms[0] if arms else None
    return meshes, arm


def get_armature():
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def find_bone(armature, aliases: list):
    """Find the first bone whose name matches any alias (case-insensitive)."""
    if not armature:
        return None
    bone_names = {b.name.lower(): b.name for b in armature.data.bones}
    for alias in aliases:
        if alias.lower() in bone_names:
            return bone_names[alias.lower()]
    return None


def center_objects(objects):
    import mathutils
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        return
    lo = mathutils.Vector((float("inf"),) * 3)
    hi = mathutils.Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    center = (lo + hi) / 2.0
    offset = mathutils.Vector((-center.x, -center.y, -lo.z))
    for obj in objects:
        if obj.parent is None:
            obj.location += offset


def fit_camera(cam, padding=None):
    import mathutils
    if padding is None:
        padding = PIPE_CFG.get("padding_factor", 1.15)
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
    if not meshes:
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        return
    lo = mathutils.Vector((float("inf"),) * 3)
    hi = mathutils.Vector((float("-inf"),) * 3)
    for obj in meshes:
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    center  = (lo + hi) / 2.0
    size    = max(hi[i] - lo[i] for i in range(3))
    cam.data.ortho_scale = size * padding
    direction = cam.matrix_world.to_3x3() @ mathutils.Vector((0, 0, -1))
    cam.location = center - direction * size * 3


def set_all_mesh_visibility(meshes, hide: bool):
    for obj in meshes:
        obj.hide_render   = hide
        obj.hide_viewport = hide


# ────────────────────────────────────────────────────────────────────────────
# Equipment attachment
# ────────────────────────────────────────────────────────────────────────────

def attach_equipment(equip_meshes, equip_arm, char_arm, slot: str) -> bool:
    """
    Attach equip_meshes to char_arm using the method specified for this slot.
    Returns True on success.

    Two modes:
      'bone'     — rigid parent to a single bone (weapons, helmet, shield)
      'armature' — full armature deform modifier (chest, legs, boots)
    """
    if not char_arm:
        log.warning(f"No character armature found — cannot attach {slot}")
        return False

    slot_def  = SLOTS_CFG["slots"].get(slot, {})
    mode      = slot_def.get("attach_type", "armature")

    # Resolve bone name from preset + aliases
    raw_bone  = SKEL_PRESET.get(slot_def.get("bone_name", ""), slot_def.get("bone_name", "head"))
    aliases   = slot_def.get("bone_aliases", [raw_bone, raw_bone.lower()])
    bone_name = find_bone(char_arm, aliases)

    if mode == "bone":
        # ── Rigid parent to one bone ──────────────────────────────────────
        if not bone_name:
            log.warning(f"Bone not found for slot '{slot}' in armature '{char_arm.name}'. Tried: {aliases}")
            return False

        for mesh in equip_meshes:
            mesh.parent      = char_arm
            mesh.parent_type = "BONE"
            mesh.parent_bone = bone_name
            # Clear any existing armature modifier from the equipment FBX
            for mod in list(mesh.modifiers):
                if mod.type == "ARMATURE":
                    mesh.modifiers.remove(mod)
        log.info(f"  Attached {len(equip_meshes)} mesh(es) to bone '{bone_name}' (rigid)")
        return True

    else:
        # ── Armature deform ───────────────────────────────────────────────
        # If the equipment came with its own armature that matches, merge vertex groups.
        # Otherwise, add an armature modifier pointing at char_arm.
        for mesh in equip_meshes:
            # Remove any armature modifier that referenced the equipment's own armature
            for mod in list(mesh.modifiers):
                if mod.type == "ARMATURE" and mod.object != char_arm:
                    mesh.modifiers.remove(mod)

            # Add/update armature modifier to use character's armature
            arm_mod = None
            for mod in mesh.modifiers:
                if mod.type == "ARMATURE":
                    arm_mod = mod
                    break
            if not arm_mod:
                arm_mod = mesh.modifiers.new(name="Armature", type="ARMATURE")
            arm_mod.object = char_arm

            # Parent to armature (not to a specific bone)
            mesh.parent      = char_arm
            mesh.parent_type = "OBJECT"

        # Clean up the equipment's own armature (now redundant)
        if equip_arm and equip_arm != char_arm:
            bpy.data.objects.remove(equip_arm, do_unlink=True)

        log.info(f"  Attached {len(equip_meshes)} mesh(es) via armature deform")
        return True


# ────────────────────────────────────────────────────────────────────────────
# Rendering
# ────────────────────────────────────────────────────────────────────────────

def get_animation_range(anim_keyword: str):
    """Find action matching keyword, return (action, start_frame, end_frame, fps)."""
    kw = anim_keyword.lower()
    for action in bpy.data.actions:
        if kw in action.name.lower():
            return action, int(action.frame_range[0]), int(action.frame_range[1])
    # No animation found — render frame 1 only
    return None, 1, 1


def apply_action(armature, action):
    if armature and action:
        armature.animation_data_create()
        armature.animation_data.action = action


def render_layer(
    visible_meshes: list,
    all_managed_meshes: list,
    char_arm,
    action,
    asset_name: str,
    layer_name: str,
    dir_name: str,
    out_dir: str,
    frame_start: int,
    frame_end: int,
    anim_fps: int,
) -> list:
    """
    Hide everything except visible_meshes, render all animation frames for
    one direction.  Returns list of rendered PNG paths.
    """
    scene = bpy.context.scene
    scene.render.fps = anim_fps

    # Hide all managed meshes, then show only the target layer
    set_all_mesh_visibility(all_managed_meshes, True)   # hide
    set_all_mesh_visibility(visible_meshes, False)      # show

    apply_action(char_arm, action)

    paths = []
    for frame_num in range(frame_start, frame_end + 1):
        scene.frame_set(frame_num)
        filename = f"{asset_name}_{layer_name}_{dir_name}_{frame_num:04d}.png"
        out_path = os.path.join(out_dir, filename)
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
        paths.append(out_path)
        log.info(f"    [{layer_name}][{dir_name}] frame {frame_num}/{frame_end}")

    # Restore visibility
    set_all_mesh_visibility(visible_meshes, True)
    return paths


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────

def main():
    char_name = os.path.splitext(os.path.basename(args.char))[0]
    out_dir   = args.output
    os.makedirs(out_dir, exist_ok=True)

    log.info(f"=== Layered render: {char_name} ===")
    log.info(f"  Anim: {args.anim}   Directions: {len(DIRECTIONS)}   Equipment: {list(EQUIP_MAP.keys())}")

    clear_scene()
    setup_render()
    cam = make_camera()
    setup_lighting()

    # ── Import character ──────────────────────────────────────────────────
    log.info(f"Importing character: {args.char}")
    char_meshes, char_arm = import_fbx(args.char)
    if not char_meshes:
        log.error("No meshes in character FBX")
        sys.exit(1)

    all_root = [o for o in bpy.data.objects if o.parent is None and o.type in ("MESH", "ARMATURE")]
    center_objects(all_root)

    # Use character body meshes to establish camera
    set_all_mesh_visibility(char_meshes, False)  # show body to compute camera
    fit_camera(cam)
    set_all_mesh_visibility(char_meshes, True)   # hide again

    # ── Import equipment meshes ───────────────────────────────────────────
    slot_meshes = {}   # slot → [mesh_objects]
    for slot, fbx_path in EQUIP_MAP.items():
        log.info(f"Importing equipment [{slot}]: {fbx_path}")
        eq_meshes, eq_arm = import_fbx(fbx_path)
        if not eq_meshes:
            log.warning(f"  No meshes imported for {slot}")
            continue
        ok = attach_equipment(eq_meshes, eq_arm, char_arm, slot)
        if ok:
            slot_meshes[slot] = eq_meshes
        else:
            log.warning(f"  Attachment failed for {slot} — layer will be skipped")

    # All managed meshes = body + all equipment
    all_managed = list(char_meshes)
    for mlist in slot_meshes.values():
        all_managed.extend(mlist)

    # ── Find animation ────────────────────────────────────────────────────
    action, frame_start, frame_end = get_animation_range(args.anim)
    anim_fps = ASSET_CFG.get(f"{args.anim}_fps", ASSET_CFG.get("walk_fps", 8))
    if action is None:
        log.warning(f"No action found for '{args.anim}' — rendering frame 1 only")
        frame_start = frame_end = 1

    manifest_frames = {}   # { frame_key: path }
    manifest_layers = list(slot_meshes.keys())
    if not args.layer_only:
        manifest_layers = ["body_base"] + manifest_layers

    # ── Per-direction render ──────────────────────────────────────────────
    for i, angle_deg in enumerate(DIRECTIONS):
        dir_name = DIR_NAMES[i] if i < len(DIR_NAMES) else f"dir{angle_deg}"
        log.info(f"Direction: {dir_name} ({angle_deg}°)")

        # Rotate the entire scene root (armature + all children rotate with it)
        for obj in all_root:
            if obj.type == "ARMATURE":
                obj.rotation_euler[2] = math.radians(angle_deg)

        # Render body_base layer
        if not args.layer_only:
            paths = render_layer(
                visible_meshes     = char_meshes,
                all_managed_meshes = all_managed,
                char_arm           = char_arm,
                action             = action,
                asset_name         = char_name,
                layer_name         = "body_base",
                dir_name           = dir_name,
                out_dir            = out_dir,
                frame_start        = frame_start,
                frame_end          = frame_end,
                anim_fps           = anim_fps,
            )
            for p in paths:
                key = os.path.splitext(os.path.basename(p))[0]
                manifest_frames[key] = {"path": p, "layer": "body_base", "direction": dir_name}

        # Render each equipment layer
        for slot, eq_meshes in slot_meshes.items():
            paths = render_layer(
                visible_meshes     = eq_meshes,
                all_managed_meshes = all_managed,
                char_arm           = char_arm,
                action             = action,
                asset_name         = char_name,
                layer_name         = slot,
                dir_name           = dir_name,
                out_dir            = out_dir,
                frame_start        = frame_start,
                frame_end          = frame_end,
                anim_fps           = anim_fps,
            )
            for p in paths:
                key = os.path.splitext(os.path.basename(p))[0]
                manifest_frames[key] = {"path": p, "layer": slot, "direction": dir_name}

    # ── Write manifest ────────────────────────────────────────────────────
    manifest = {
        "asset":      char_name,
        "type":       "character_layered",
        "layers":     manifest_layers,
        "draw_order": [s for s in SLOTS_CFG["draw_order"] if s in manifest_layers or s == "body_base"],
        "anim":       args.anim,
        "fps":        anim_fps,
        "frame_range": [frame_start, frame_end],
        "directions": DIR_NAMES[:len(DIRECTIONS)],
        "frames":     manifest_frames,
    }
    manifest_path = os.path.join(out_dir, f"{char_name}_layered.json")
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf, indent=2)

    log.info(f"Done: {len(manifest_frames)} frames across {len(manifest_layers)} layers → {manifest_path}")


main()
