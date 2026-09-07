"""Generate the shared, millimetre-sized bead meshes using Blender only.

Run with: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_bead_kit.py
Coordinates are metres; Blender's unit display is millimetres. No network or add-ons
outside Blender's bundled glTF exporter are needed.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import struct

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "public/models/bead-kit.glb"
BLEND_PATH = ROOT / "assets/models/bead-kit.blend"
REPORT_PATH = ROOT / "public/models/bead-kit.spec.json"
RADIAL_SEGMENTS = 48
BEVEL_SEGMENTS = 3
BEVEL = 0.00012
RAW_RADIUS = 0.00477 / 2
SPECIFICATIONS = (
    {"name": "MidiBead", "height": 0.00507, "hole": 0.0025, "fused": False},
    {"name": "FusedMidiBead", "height": 0.0037, "hole": 0.0018, "fused": True},
)


def cross_section(height: float, inner_radius: float) -> list[tuple[float, float, float]]:
    """Return a closed annulus profile, including static neutral shape shading."""
    result = [(inner_radius + BEVEL, 0.0, 0.86), (RAW_RADIUS - BEVEL, 0.0, 0.86)]

    def arc(center_r: float, center_z: float, start: float, end: float,
            shade_start: float, shade_end: float, omit_last: bool = False) -> None:
        stop = BEVEL_SEGMENTS if omit_last else BEVEL_SEGMENTS + 1
        for step in range(1, stop):
            fraction = step / BEVEL_SEGMENTS
            angle = math.radians(start + (end - start) * fraction)
            result.append((center_r + BEVEL * math.cos(angle),
                           center_z + BEVEL * math.sin(angle),
                           shade_start + (shade_end - shade_start) * fraction))

    arc(RAW_RADIUS - BEVEL, BEVEL, -90, 0, 0.86, 0.88)
    result.extend(((RAW_RADIUS, height * 0.4, 0.88),
                   (RAW_RADIUS, height * 0.7, 0.88),
                   (RAW_RADIUS, height - BEVEL, 0.88)))
    arc(RAW_RADIUS - BEVEL, height - BEVEL, 0, 90, 0.88, 1.0)
    result.append((inner_radius + BEVEL, height, 1.0))
    arc(inner_radius + BEVEL, height - BEVEL, 90, 180, 1.0, 0.72)
    result.append((inner_radius, BEVEL, 0.48))
    arc(inner_radius + BEVEL, BEVEL, 180, 270, 0.48, 0.86, omit_last=True)
    return result


def rounded_square_radius(angle: float) -> float:
    """Intersect a radial ray with a 5 mm square with 0.65 mm rounded corners."""
    half_size = 0.0025
    corner = 0.00065
    cosine = max(abs(math.cos(angle)), abs(math.sin(angle)))
    sine = min(abs(math.cos(angle)), abs(math.sin(angle)))
    flat = half_size - corner
    if sine / max(cosine, 1e-12) <= flat / half_size:
        return half_size / cosine
    return flat * (cosine + sine) + math.sqrt(max(
        0.0, corner * corner - flat * flat * (cosine - sine) ** 2))


def create_bead(spec: dict, material: bpy.types.Material) -> tuple[bpy.types.Object, list]:
    """Build a closed manifold annular mesh; both variants share the same topology."""
    height = spec["height"]
    inner_radius = spec["hole"] / 2
    profile = cross_section(height, inner_radius)
    vertices = []
    shades = []
    for radius, z, shade in profile:
        for segment in range(RADIAL_SEGMENTS):
            angle = segment * math.tau / RADIAL_SEGMENTS
            adjusted_radius = radius
            if spec["fused"] and radius > (RAW_RADIUS + inner_radius) / 2:
                transition = max(0.0, min(1.0, (z / height - 0.4) / 0.3))
                transition = transition * transition * (3 - 2 * transition)
                adjusted_radius += transition * (rounded_square_radius(angle) - RAW_RADIUS)
            vertices.append((adjusted_radius * math.cos(angle), adjusted_radius * math.sin(angle), z))
            shades.append(shade)

    faces = []
    for row in range(len(profile)):
        next_row = (row + 1) % len(profile)
        for segment in range(RADIAL_SEGMENTS):
            next_segment = (segment + 1) % RADIAL_SEGMENTS
            faces.append((row * RADIAL_SEGMENTS + segment,
                          row * RADIAL_SEGMENTS + next_segment,
                          next_row * RADIAL_SEGMENTS + next_segment,
                          next_row * RADIAL_SEGMENTS + segment))

    mesh = bpy.data.meshes.new(spec["name"] + "Geometry")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    if mesh.validate(verbose=True):
        raise RuntimeError(f"{spec['name']} required unexpected mesh repairs")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    color = mesh.color_attributes.new(name="COLOR_0", type="FLOAT_COLOR", domain="POINT")
    for index, shade in enumerate(shades):
        color.data[index].color = (shade, shade, shade, 1.0)
    mesh.color_attributes.active_color = color

    # A static seam and normalized profile UV allow the existing brush shader to
    # treat either mesh identically. Shape colour contains no directional light.
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        row = polygon.index // RADIAL_SEGMENTS
        segment = polygon.index % RADIAL_SEGMENTS
        uv_coordinates = ((segment / RADIAL_SEGMENTS, row / len(profile)),
                          ((segment + 1) / RADIAL_SEGMENTS, row / len(profile)),
                          ((segment + 1) / RADIAL_SEGMENTS, (row + 1) / len(profile)),
                          (segment / RADIAL_SEGMENTS, (row + 1) / len(profile)))
        for loop_index, uv in zip(polygon.loop_indices, uv_coordinates):
            uv_layer.data[loop_index].uv = uv

    obj = bpy.data.objects.new(spec["name"], mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    obj["units"] = "metres; nominal pitch 0.005 m"
    obj["shapeShade"] = "Neutral form cue: top 1, outer wall 0.88, inner wall 0.48-0.72"
    return obj, profile


def validate_bead(obj: bpy.types.Object, profile: list, spec: dict) -> dict:
    """Check actual positions, topology, winding and a clear through-hole."""
    mesh = obj.data
    mesh.calc_loop_triangles()
    coordinates = [vertex.co.copy() for vertex in mesh.vertices]
    minimum = [min(coordinate[axis] for coordinate in coordinates) for axis in range(3)]
    maximum = [max(coordinate[axis] for coordinate in coordinates) for axis in range(3)]
    dimensions = [maximum[axis] - minimum[axis] for axis in range(3)]
    expected_diameter = 0.005 if spec["fused"] else 0.00477
    expected = (expected_diameter, expected_diameter, spec["height"])
    assert all(abs(actual - target) < 1e-8 for actual, target in zip(dimensions, expected))
    assert abs(minimum[2]) < 1e-10
    assert all(abs(minimum[axis] + maximum[axis]) < 1e-9 for axis in (0, 1))
    assert len(mesh.loop_triangles) <= 1800

    bm = bmesh.new()
    bm.from_mesh(mesh)
    boundary_edges = sum(edge.is_boundary for edge in bm.edges)
    non_manifold_edges = sum(not edge.is_manifold for edge in bm.edges)
    volume = bm.calc_volume(signed=True)
    bm.free()
    assert boundary_edges == 0 and non_manifold_edges == 0 and volume > 0

    winding_errors = 0
    for polygon in mesh.polygons:
        row = polygon.index // RADIAL_SEGMENTS
        current = profile[row]
        following = profile[(row + 1) % len(profile)]
        delta_height = following[1] - current[1]
        radial = Vector((polygon.center.x, polygon.center.y, 0)).normalized()
        if delta_height > 1e-10:
            correct = polygon.normal.dot(radial) > 0
        elif delta_height < -1e-10:
            correct = polygon.normal.dot(radial) < 0
        else:
            correct = polygon.normal.z * (following[0] - current[0]) < 0
        winding_errors += not correct
    assert winding_errors == 0

    bvh = BVHTree.FromPolygons(coordinates, [tuple(face.vertices) for face in mesh.polygons])
    clear_rays = 0
    test_radius = spec["hole"] / 2 * 0.98
    for ray in range(RADIAL_SEGMENTS + 1):
        angle = ray * math.tau / RADIAL_SEGMENTS
        radius = 0.0 if ray == RADIAL_SEGMENTS else test_radius
        origin = Vector((math.cos(angle) * radius, math.sin(angle) * radius, -0.001))
        result = bvh.ray_cast(origin, Vector((0, 0, 1)), spec["height"] + 0.002)
        assert result[0] is None
        clear_rays += 1

    # Report the actual faceted bore clearance as well as its nominal vertex
    # diameter; a finite-sided cylinder is slightly smaller between vertices.
    bore_distances = []
    for ray in range(RADIAL_SEGMENTS):
        angle = (ray + 0.5) * math.tau / RADIAL_SEGMENTS
        hit = bvh.ray_cast(Vector((0, 0, spec["height"] / 2)),
                           Vector((math.cos(angle), math.sin(angle), 0)), RAW_RADIUS)
        assert hit[0] is not None and hit[3] is not None
        bore_distances.append(hit[3])

    return {
        "name": obj.name,
        "dimensionsMmBlenderXYZ": [round(value * 1000, 6) for value in dimensions],
        "dimensionsMmGltfXYZ": [round(dimensions[0] * 1000, 6),
                                round(dimensions[2] * 1000, 6), round(dimensions[1] * 1000, 6)],
        "nominalHoleDiameterMm": spec["hole"] * 1000,
        "minimumClearBoreDiameterMm": round(min(bore_distances) * 2000, 6),
        "bevelMm": BEVEL * 1000,
        "radialSegments": RADIAL_SEGMENTS,
        "profileRows": len(profile),
        "sourceVertices": len(mesh.vertices),
        "triangles": len(mesh.loop_triangles),
        "boundaryEdges": boundary_edges,
        "nonManifoldEdges": non_manifold_edges,
        "normalWindingErrors": winding_errors,
        "clearAxialHoleRays": clear_rays,
        "signedVolumeMm3": round(volume * 1e9, 6),
        "identityTransform": list(obj.location) == [0, 0, 0]
                             and list(obj.rotation_euler) == [0, 0, 0]
                             and list(obj.scale) == [1, 1, 1],
    }


def validate_export(path: Path) -> list[dict]:
    """Check the actual GLB node transforms and exported position/color attributes."""
    data = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<III", data)
    assert magic == 0x46546C67 and version == 2 and total_length == len(data)
    json_length, chunk_type = struct.unpack_from("<II", data, 12)
    assert chunk_type == 0x4E4F534A
    document = json.loads(data[20:20 + json_length])
    exported = []
    nodes = [node for node in document["nodes"] if "mesh" in node]
    assert {node["name"] for node in nodes} == {spec["name"] for spec in SPECIFICATIONS}
    for node in nodes:
        assert node.get("translation", [0, 0, 0]) == [0, 0, 0]
        assert node.get("rotation", [0, 0, 0, 1]) == [0, 0, 0, 1]
        assert node.get("scale", [1, 1, 1]) == [1, 1, 1]
        assert "matrix" not in node
        primitive = document["meshes"][node["mesh"]]["primitives"]
        assert len(primitive) == 1
        attributes = primitive[0]["attributes"]
        assert all(key in attributes for key in ("POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"))
        positions = document["accessors"][attributes["POSITION"]]
        indices = document["accessors"][primitive[0]["indices"]]
        assert abs(positions["min"][1]) < 1e-9
        exported.append({"name": node["name"], "attributes": list(attributes),
                         "positionMinMetres": positions["min"],
                         "positionMaxMetres": positions["max"],
                         "exportedVertices": positions["count"],
                         "triangles": indices["count"] // 3,
                         "identityTransform": True})
    return exported


def main() -> None:
    """Create the editable source, runtime asset and deterministic dimension evidence."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "MILLIMETERS"
    material = bpy.data.materials.new("WarmWhitePlasticPreview")
    if material.node_tree is None:
        material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.92, 0.875, 0.78, 1)
    principled.inputs["Roughness"].default_value = 0.34
    material.diffuse_color = (0.92, 0.875, 0.78, 1)

    reports = []
    for spec in SPECIFICATIONS:
        obj, profile = create_bead(spec, material)
        reports.append(validate_bead(obj, profile, spec))
        obj.select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects["MidiBead"]

    for path in (GLB_PATH, BLEND_PATH, REPORT_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB",
                              use_selection=True, export_yup=True, export_apply=False,
                              export_normals=True, export_texcoords=True,
                              export_vertex_color="ACTIVE", export_materials="EXPORT",
                              export_extras=True, export_cameras=False, export_lights=False)
    exported = validate_export(GLB_PATH)
    report = {
        "schemaVersion": 1,
        "generator": "scripts/blender/generate_bead_kit.py",
        "blenderVersion": bpy.app.version_string,
        "coordinateUnits": "metres; glTF Y-up; bottom Y=0; center X/Z=0",
        "nominalPitchMm": 5.0,
        "rawDiameterHeightSource": "https://perler.com/products/1-000-perler-beads-beige",
        "assumptions": ["Raw bore 2.5 mm and bevel 0.12 mm are art estimates, not manufacturer tolerances.",
                        "Pitch 5 mm is a nominal modelling target, not a measured pegboard.",
                        "Fused height 3.7 mm, bore 1.8 mm and 5 mm rounded-square upper envelope are art estimates.",
                        "COLOR_0 is neutral form shading, not baked lighting or physically solved ambient occlusion."],
        "shapeShadeLinear": {"top": 1.0, "outerWall": 0.88, "innerWall": [0.48, 0.72]},
        "models": reports,
        "glb": {"sha256": hashlib.sha256(GLB_PATH.read_bytes()).hexdigest(),
                "bytes": GLB_PATH.stat().st_size, "meshes": exported},
        "passed": True,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, "glb": str(GLB_PATH), "models": reports}, ensure_ascii=False))


if __name__ == "__main__":
    main()
