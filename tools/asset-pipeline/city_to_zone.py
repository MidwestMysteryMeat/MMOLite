#!/usr/bin/env python3
"""
city_to_zone.py — Convert the map-editor's city JSON export to a state.js
zone config object that can be pasted into (or required by) the server.

Usage:
    python city_to_zone.py \
        --input   tools/map-editor/exports/highwatch.json \
        --zone-id zone_highwatch \
        --type    town \
        --biome   grassland \
        --output  highwatch_zone.js

Output formats:
    js   (default) — ES module literal you can paste into state.js zones array
    json           — plain JSON, useful for dynamic zone loading

The produced placedObjects, npcs, and connections arrays match the schema that
server.js / state.js / overworld.js expect. NPC entries include every field
required by the NPC dialogue / shop / sleep-schedule systems.
"""

import argparse
import json
import sys
from pathlib import Path


# ── Zone type → default biome if not specified ─────────────────────────────────

TYPE_BIOME_DEFAULT = {
    "town":             "grassland",
    "city":             "grassland",
    "village":          "grassland",
    "camp":             "forest",
    "dungeon_entrance": "rift",
    "outpost":          "stone",
}

# ── NPC type inference from keywords in label/id ──────────────────────────────

NPC_TYPE_KEYWORDS = [
    ("vendor",      ["vendor", "merchant", "trader", "shop", "market"]),
    ("quest_giver", ["quest", "mission", "bounty"]),
    ("guard",       ["guard", "soldier", "watchman", "sentinel"]),
    ("banker",      ["bank", "banker", "vault"]),
    ("blacksmith",  ["blacksmith", "smith", "forge", "anvil"]),
    ("innkeeper",   ["inn", "innkeeper", "tavern", "barmaid", "barkeep"]),
    ("healer",      ["healer", "priest", "cleric", "medic", "apoth"]),
    ("farmer",      ["farmer", "peasant", "herder"]),
    ("civilian",    []),   # catch-all
]


def infer_npc_type(npc_id: str, label: str) -> str:
    text = (npc_id + " " + label).lower()
    for npc_type, keywords in NPC_TYPE_KEYWORDS:
        if any(k in text for k in keywords):
            return npc_type
    return "civilian"


def infer_shop_type(npc_type: str, label: str) -> str | None:
    label_lower = label.lower()
    if npc_type == "blacksmith" or "blacksmith" in label_lower:
        return "blacksmith"
    if npc_type == "vendor":
        if "magic" in label_lower or "arcane" in label_lower:
            return "magic_shop"
        if "general" in label_lower or "supply" in label_lower:
            return "general_store"
        return "general_store"
    if npc_type == "innkeeper":
        return "inn"
    return None


# ── City JSON → state.js zone schema ──────────────────────────────────────────

def convert_object(obj: dict) -> dict:
    """Map-editor placed object → state.js placedObject entry."""
    collision = obj.get("collision") or {}
    placed = {
        "id":         obj["id"],
        "type":       "building" if obj.get("enterable") else "prop",
        "assetId":    obj.get("assetId") or obj["id"],
        "x":          obj.get("x", 0),
        "y":          obj.get("y", 0),
        "w":          collision.get("w", 2),
        "h":          collision.get("h", 2),
        "direction":  obj.get("direction", 0),
        "scale":      obj.get("scale", 1.0),
        "label":      obj.get("label", ""),
    }
    if obj.get("enterable"):
        placed["enterable"]   = True
        placed["targetZoneId"] = obj.get("targetZone", "")
    return placed


def convert_npc(npc: dict, idx: int) -> dict:
    """Map-editor NPC → state.js npc entry."""
    npc_id    = npc.get("id") or f"npc_{idx:02d}"
    label     = npc.get("label") or npc_id
    npc_type  = npc.get("type") or infer_npc_type(npc_id, label)
    shop_type = npc.get("shopType") or infer_shop_type(npc_type, label)

    entry = {
        "id":         npc_id,
        "name":       label,
        "type":       npc_type,
        "x":          npc.get("x", 0),
        "y":          npc.get("y", 0),
        "dialogue":   npc.get("dialogue") or npc_id,
        "sleepStart": npc.get("sleepStart", 22),
        "sleepEnd":   npc.get("sleepEnd",   6),
    }
    if shop_type:
        entry["shopType"] = shop_type
    if npc.get("factionId"):
        entry["factionId"] = npc["factionId"]
    if npc.get("questId"):
        entry["questId"] = npc["questId"]
    return entry


def convert_connections(data: dict) -> list:
    """Extract zone-exit connections from the city JSON."""
    connections = []
    seen = set()

    # Explicit connections array (from map editor connection tool)
    for conn in data.get("connections") or []:
        target = conn.get("targetZoneId") or conn.get("targetZone", "")
        direction = conn.get("direction", "")
        key = (direction, target)
        if key not in seen:
            seen.add(key)
            entry = {"direction": direction, "targetZoneId": target}
            if "x" in conn:
                entry["x"] = conn["x"]
                entry["y"] = conn["y"]
            if conn.get("label"):
                entry["label"] = conn["label"]
            connections.append(entry)

    # Placed objects marked as zone connections (non-enterable with targetZone)
    for obj in data.get("objects") or []:
        if obj.get("targetZone") and not obj.get("enterable"):
            direction = obj.get("connectionDirection", "")
            target    = obj["targetZone"]
            key = (direction, target)
            if key not in seen:
                seen.add(key)
                connections.append({
                    "direction":   direction,
                    "targetZoneId": target,
                    "x":           obj.get("x", 0),
                    "y":           obj.get("y", 0),
                })

    return connections


def city_to_zone(data: dict, zone_id: str, zone_type: str, biome: str) -> dict:
    meta = data.get("meta") or {}
    return {
        "id":            zone_id,
        "name":          meta.get("name") or zone_id,
        "type":          zone_type,
        "biome":         biome,
        "width":         meta.get("width",  32),
        "height":        meta.get("height", 32),
        "connections":   convert_connections(data),
        "placedObjects": [convert_object(o) for o in (data.get("objects") or [])],
        "npcs":          [convert_npc(n, i) for i, n in enumerate(data.get("npcs") or [])],
    }


# ── JS serializer ─────────────────────────────────────────────────────────────

def _js_val(v, indent: int = 4) -> str:
    """Render a Python value as a JS literal (no trailing commas, clean format)."""
    pad = " " * indent
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        if not v:
            return "[]"
        items = [_js_val(i, indent + 4) for i in v]
        inline = "[" + ", ".join(items) + "]"
        if len(inline) <= 80:
            return inline
        inner = (",\n" + pad).join(items)
        return f"[\n{pad}{inner},\n{' ' * (indent - 4)}]"
    if isinstance(v, dict):
        if not v:
            return "{}"
        lines = []
        for k, dv in v.items():
            lines.append(f"{pad}{k}: {_js_val(dv, indent + 4)}")
        inner = ",\n".join(lines)
        return f"{{\n{inner},\n{' ' * (indent - 4)}}}"
    return repr(v)


def zone_to_js(zone: dict, zone_id: str) -> str:
    const_name = "ZONE_" + zone_id.upper().replace("-", "_")
    body = _js_val(zone, indent=4)
    return (
        f"// Auto-generated by city_to_zone.py\n"
        f"// Paste this object into the zones array in state.js,\n"
        f"// or require() it and push it in server.js startup.\n"
        f"\nconst {const_name} = {body};\n"
        f"\nmodule.exports = {const_name};\n"
    )


# ── CLI ────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(
        description="Convert map-editor city JSON to state.js zone config."
    )
    p.add_argument("--input",   required=True, help="City JSON from map editor export")
    p.add_argument("--zone-id", required=True, help="Zone id (e.g. zone_highwatch)")
    p.add_argument("--type",    default="town",
                   choices=["town", "city", "village", "camp", "dungeon_entrance", "outpost"],
                   help="Zone type")
    p.add_argument("--biome",   default=None,
                   help="Zone biome (grassland/forest/desert/snow/rift/stone). "
                        "Defaults by zone type if omitted.")
    p.add_argument("--output",  default="-", help="Output file path (- = stdout)")
    p.add_argument("--format",  default="js", choices=["js", "json"],
                   help="Output format (default: js)")
    return p.parse_args()


def main():
    args = parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[city_to_zone] ERROR: input not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    biome = args.biome or TYPE_BIOME_DEFAULT.get(args.type, "grassland")
    zone  = city_to_zone(data, args.zone_id, args.type, biome)

    if args.format == "json":
        out = json.dumps(zone, indent=2)
    else:
        out = zone_to_js(zone, args.zone_id)

    if args.output == "-":
        print(out)
    else:
        out_path = Path(args.output)
        out_path.write_text(out, encoding="utf-8")
        objects = len(zone["placedObjects"])
        npcs    = len(zone["npcs"])
        conns   = len(zone["connections"])
        print(
            f"[city_to_zone] {args.zone_id}: "
            f"{objects} objects, {npcs} NPCs, {conns} connections → {args.output}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
