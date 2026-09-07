"""Build the editable Mini kit, validated GLB and offline modelling previews.

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/generate_mini_bead_kit.py
The asset uses metres with millimetre display units. The studio renders are
diagnostic previews, not the application's reference painterly shader.
Re-running replaces the generated Mini .blend; keep manual edits separately.
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
GLB_PATH = ROOT / "public/models/mini-bead-kit.glb"
BLEND_PATH = ROOT / "assets/models/mini-bead-kit.blend"
REPORT_PATH = ROOT / "public/models/mini-bead-kit.spec.json"
PREVIEW_PATH = ROOT / "artifacts/mini-models"
RADIAL_SEGMENTS = 36
BEVEL_SEGMENTS = 2
BEVEL = 0.00007
RAW_RADIUS = 0.00261 / 2
NOMINAL_PITCH = 0.0027
FUSED_HALF_SIZE = 0.0027 / 2
FUSED_CORNER = 0.00022
FUSED_SOCKET_RADIUS = 0.0004
FUSED_SOCKET_TOP = 0.00182
PEG_HEIGHT = 0.0018
PEG_BASE_RADIUS = 0.00035
PEG_TIP_RADIUS = PEG_BASE_RADIUS * 0.8
SPECIFICATIONS = (
    {"name": "MiniBead", "height": 0.0028, "hole": 0.001, "fused": False},
    {"name": "FusedMiniBead", "height": 0.002, "hole": 0.00035, "fused": True},
)


def angles_for(spec: dict) -> list[float]:
    """Keep 36 sides, sampling the fused square's short corner arcs more closely."""
    if not spec["fused"]:
        return [segment * math.tau / RADIAL_SEGMENTS for segment in range(RADIAL_SEGMENTS)]
    quarter = (0, 15, 30, 40, 44, 46, 50, 60, 75)
    return [math.radians(quadrant * 90 + angle) for quadrant in range(4) for angle in quarter]


def cross_section(spec: dict) -> list[tuple[float, float, float]]:
    """A thin mouth bevel around broad flat end faces, with no domed tube top."""
    height = spec["height"]
    inner_radius = spec["hole"] / 2
    bottom_radius = FUSED_SOCKET_RADIUS if spec["fused"] else inner_radius
    result = [(bottom_radius + BEVEL, 0.0, 0.90), (RAW_RADIUS - BEVEL, 0.0, 0.90)]

    def arc(center_r: float, center_z: float, start: float, end: float,
            shade_start: float, shade_end: float, omit_last: bool = False) -> None:
        stop = BEVEL_SEGMENTS if omit_last else BEVEL_SEGMENTS + 1
        for step in range(1, stop):
            fraction = step / BEVEL_SEGMENTS
            angle = math.radians(start + (end - start) * fraction)
            result.append((center_r + BEVEL * math.cos(angle),
                           center_z + BEVEL * math.sin(angle),
                           shade_start + (shade_end - shade_start) * fraction))

    arc(RAW_RADIUS - BEVEL, BEVEL, -90, 0, 0.90, 0.92)
    result.append((RAW_RADIUS, height - BEVEL, 0.92))
    arc(RAW_RADIUS - BEVEL, height - BEVEL, 0, 90, 0.92, 1.0)
    result.append((inner_radius + BEVEL, height, 1.0))
    arc(inner_radius + BEVEL, height - BEVEL, 90, 180, 1.0, 0.82)
    if spec["fused"]:
        # Keep the 0.8 mm socket above the 1.8 mm pin tip before narrowing.
        # This ring replaces an unnecessary outer-wall ring within the same budget.
        result.append((FUSED_SOCKET_RADIUS, FUSED_SOCKET_TOP, 0.78))
    result.append((bottom_radius, BEVEL, 0.65))
    arc(bottom_radius + BEVEL, BEVEL, 180, 270, 0.65, 0.90, omit_last=True)
    return result


def rounded_square_radius(angle: float) -> float:
    """Radial intersection of the 2.7 mm rounded square, with 0.22 mm corners."""
    cosine = max(abs(math.cos(angle)), abs(math.sin(angle)))
    sine = min(abs(math.cos(angle)), abs(math.sin(angle)))
    flat = FUSED_HALF_SIZE - FUSED_CORNER
    if sine / max(cosine, 1e-12) <= flat / FUSED_HALF_SIZE:
        return FUSED_HALF_SIZE / cosine
    return flat * (cosine + sine) + math.sqrt(max(
        0.0, FUSED_CORNER * FUSED_CORNER - flat * flat * (cosine - sine) ** 2))


def create_bead(spec: dict, material: bpy.types.Material) -> tuple[bpy.types.Object, list]:
    profile = cross_section(spec)
    vertices = []
    shades = []
    angles = angles_for(spec)
    inner_radius = spec["hole"] / 2
    for radius, z, shade in profile:
        for angle in angles:
            adjusted_radius = radius
            if spec["fused"] and radius > (RAW_RADIUS + inner_radius) / 2:
                transition = max(0.0, min(1.0, (z / spec["height"] - 0.35) / 0.37))
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
    obj["units"] = "metres; nominal estimated pitch 0.0027 m"
    obj["shapeShade"] = "Neutral form cue: top 1, outer 0.92, inner 0.65-0.82; no directional light"
    obj["source"] = "https://perler.com/products/2-000-mini-perler-beads-black"
    return obj, profile


def validate_bead(obj: bpy.types.Object, profile: list, spec: dict) -> dict:
    mesh = obj.data
    mesh.calc_loop_triangles()
    coordinates = [vertex.co.copy() for vertex in mesh.vertices]
    minimum = [min(coordinate[axis] for coordinate in coordinates) for axis in range(3)]
    maximum = [max(coordinate[axis] for coordinate in coordinates) for axis in range(3)]
    dimensions = [maximum[axis] - minimum[axis] for axis in range(3)]
    diameter = NOMINAL_PITCH if spec["fused"] else RAW_RADIUS * 2
    assert all(abs(actual - target) < 1e-8 for actual, target in
               zip(dimensions, (diameter, diameter, spec["height"])))
    assert abs(minimum[2]) < 1e-10
    assert all(abs(minimum[axis] + maximum[axis]) < 1e-9 for axis in (0, 1))
    assert len(mesh.loop_triangles) <= 1000

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
    for ray in range(RADIAL_SEGMENTS + 1):
        angle = ray * math.tau / RADIAL_SEGMENTS
        radius = 0 if ray == RADIAL_SEGMENTS else spec["hole"] * 0.5 * 0.98
        origin = Vector((math.cos(angle) * radius, math.sin(angle) * radius, -0.001))
        assert bvh.ray_cast(origin, Vector((0, 0, 1)), spec["height"] + 0.002)[0] is None
        clear_rays += 1

    bore_distances = []
    angles = angles_for(spec)
    for sample_height in (BEVEL, spec["height"] / 2, spec["height"] - BEVEL):
        for segment, angle in enumerate(angles):
            next_angle = angles[(segment + 1) % len(angles)]
            if next_angle <= angle:
                next_angle += math.tau
            angle = (angle + next_angle) * 0.5
            hit = bvh.ray_cast(Vector((0, 0, sample_height)),
                               Vector((math.cos(angle), math.sin(angle), 0)), RAW_RADIUS)
            assert hit[0] is not None and hit[3] is not None
            bore_distances.append(hit[3])

    # Test the actual polygonal bore, including between radial vertices, against
    # the existing 0.7 mm tapered peg over its complete 1.8 mm height.
    peg_clearances = []
    angular_samples = 144
    vertical_samples = 181
    for row in range(vertical_samples):
        sample_height = max(1e-8, PEG_HEIGHT * row / (vertical_samples - 1))
        peg_radius = PEG_BASE_RADIUS + (PEG_TIP_RADIUS - PEG_BASE_RADIUS) * sample_height / PEG_HEIGHT
        for segment in range(angular_samples):
            angle = segment * math.tau / angular_samples
            hit = bvh.ray_cast(Vector((0, 0, sample_height)),
                               Vector((math.cos(angle), math.sin(angle), 0)), RAW_RADIUS)
            assert hit[0] is not None and hit[3] is not None
            clearance = hit[3] - peg_radius
            assert clearance > 0.00004
            peg_clearances.append(clearance)
    for segment in range(angular_samples):
        angle = segment * math.tau / angular_samples
        # A full-width cylinder is a stricter test than the peg's tapered tip.
        origin = Vector((math.cos(angle) * PEG_BASE_RADIUS, math.sin(angle) * PEG_BASE_RADIUS, -0.00001))
        assert bvh.ray_cast(origin, Vector((0, 0, 1)), PEG_HEIGHT + 0.00001)[0] is None
    top_vertices = [vertex.co.z for vertex in mesh.vertices if abs(vertex.co.z - spec["height"]) < 1e-9]
    assert len(top_vertices) == RADIAL_SEGMENTS * 2
    return {
        "name": obj.name,
        "dimensionsMmBlenderXYZ": [round(value * 1000, 6) for value in dimensions],
        "dimensionsMmGltfXYZ": [round(dimensions[0] * 1000, 6), round(dimensions[2] * 1000, 6),
                                round(dimensions[1] * 1000, 6)],
        "nominalHoleDiameterMm": spec["hole"] * 1000,
        "minimumClearBoreDiameterMm": round(min(bore_distances) * 2000, 6),
        "mouthBevelMm": round(BEVEL * 1000, 6),
        "roundedSquareCornerMm": FUSED_CORNER * 1000 if spec["fused"] else None,
        "radialSegments": RADIAL_SEGMENTS,
        "bevelSegments": BEVEL_SEGMENTS,
        "profileRows": len(profile),
        "sourceVertices": len(mesh.vertices),
        "triangles": len(mesh.loop_triangles),
        "boundaryEdges": boundary_edges,
        "nonManifoldEdges": non_manifold_edges,
        "normalWindingErrors": winding_errors,
        "clearAxialHoleRays": clear_rays,
        "pegFit": {
            "pegBaseDiameterMm": PEG_BASE_RADIUS * 2000,
            "pegTipDiameterMm": PEG_TIP_RADIUS * 2000,
            "pegHeightMm": PEG_HEIGHT * 1000,
            "actualMeshSectionSamples": len(peg_clearances),
            "minimumRadialClearanceMm": round(min(peg_clearances) * 1000, 6),
            "fullWidthAxialClearanceRays": angular_samples,
            "passed": True,
        },
        "flatTopAnnulusVertices": len(top_vertices),
        "flatTopHeightVariationMm": (max(top_vertices) - min(top_vertices)) * 1000,
        "signedVolumeMm3": round(volume * 1e9, 6),
        "identityTransform": list(obj.location) == [0, 0, 0]
                             and list(obj.rotation_euler) == [0, 0, 0]
                             and list(obj.scale) == [1, 1, 1],
    }


def validate_export(path: Path) -> list[dict]:
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
        primitives = document["meshes"][node["mesh"]]["primitives"]
        assert len(primitives) == 1
        attributes = primitives[0]["attributes"]
        assert all(key in attributes for key in ("POSITION", "NORMAL", "TEXCOORD_0", "COLOR_0"))
        positions = document["accessors"][attributes["POSITION"]]
        indices = document["accessors"][primitives[0]["indices"]]
        assert abs(positions["min"][1]) < 1e-9
        assert indices["count"] // 3 <= 1000
        exported.append({"name": node["name"], "attributes": list(attributes),
                         "positionMinMetres": positions["min"],
                         "positionMaxMetres": positions["max"],
                         "exportedVertices": positions["count"],
                         "triangles": indices["count"] // 3,
                         "identityTransform": True})
    return exported


def plastic_material(name: str, color: tuple, form_shade: bool = False) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    if material.node_tree is None:
        material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1)
    principled.inputs["Roughness"].default_value = 0.36
    material.diffuse_color = (*color, 1)
    if form_shade:
        attribute = material.node_tree.nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = "COLOR_0"
        multiply = material.node_tree.nodes.new("ShaderNodeMixRGB")
        multiply.blend_type = "MULTIPLY"
        multiply.inputs[0].default_value = 1
        multiply.inputs[1].default_value = (*color, 1)
        material.node_tree.links.new(attribute.outputs["Color"], multiply.inputs[2])
        material.node_tree.links.new(multiply.outputs[0], principled.inputs["Base Color"])
    return material


def write_socket_section(obj: bpy.types.Object, report: dict) -> None:
    """Draw a measured cardinal section of the saved geometry and the existing peg."""
    scale = 175
    center = 420
    baseline = 455

    def point(x: float, z: float) -> str:
        return f"{center + x * 1000 * scale:.3f},{baseline - z * 1000 * scale:.3f}"

    right = [obj.data.vertices[row * RADIAL_SEGMENTS].co for row in range(report["profileRows"])]
    right_points = " ".join(point(vertex.x, vertex.z) for vertex in right)
    left_points = " ".join(point(-vertex.x, vertex.z) for vertex in right)
    peg_points = " ".join(point(x, z) for x, z in
                          ((-PEG_BASE_RADIUS, 0), (PEG_BASE_RADIUS, 0),
                           (PEG_TIP_RADIUS, PEG_HEIGHT), (-PEG_TIP_RADIUS, PEG_HEIGHT)))
    clearance = report["pegFit"]["minimumRadialClearanceMm"]
    text = f'''<svg xmlns="http://www.w3.org/2000/svg" width="840" height="620" viewBox="0 0 840 620">
<rect width="840" height="620" fill="#faf7f0"/>
<g font-family="sans-serif" fill="#393642">
<text x="45" y="45" font-size="25">Fused Mini: actual mesh section + peg</text>
<text x="45" y="78" font-size="16">2.7 mm wide / 2.0 mm high / 0.35 mm upper throat</text>
<path d="M 135 455 H 705" stroke="#a99d91" stroke-width="2"/>
<polygon points="{right_points}" fill="#e8a8a1" stroke="#aa5660" stroke-width="2"/>
<polygon points="{left_points}" fill="#e8a8a1" stroke="#aa5660" stroke-width="2"/>
<polygon points="{peg_points}" fill="#8ac3ca" stroke="#327382" stroke-width="2"/>
<text x="45" y="505" font-size="18">Socket: diameter 0.80 mm through height 1.82 mm</text>
<text x="45" y="537" font-size="18">Peg: diameter 0.70 to 0.56 mm / height 1.80 mm</text>
<text x="45" y="569" font-size="18">Actual faceted bore: minimum radial clearance {clearance:.6f} mm</text>
<text x="45" y="598" font-size="14">Visual modelling estimates. Not a thermal or manufacturing simulation.</text>
</g></svg>'''
    (PREVIEW_PATH / "03-peg-socket-section.svg").write_text(text + "\n", encoding="utf-8")


def studio_preview(models: list[bpy.types.Object], path: Path, packed: bool) -> None:
    """Use a separate scene and linked diagnostic copies; never save them as assets."""
    scene = bpy.data.scenes.new("MiniPackedStudio" if packed else "MiniSingleStudio")
    bpy.context.window.scene = scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(path)
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new(scene.name + "World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.8, 0.86, 1, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    scene.world = world
    palette = [plastic_material("StudioMint", (0.16, 0.43, 0.35), True),
               plastic_material("StudioRose", (0.72, 0.27, 0.22), True),
               plastic_material("StudioCream", (0.88, 0.68, 0.39), True)]
    ground = plastic_material("StudioIvory", (0.68, 0.64, 0.57))
    ink = plastic_material("StudioInk", (0.085, 0.1, 0.12))
    spread = 16 if packed else 2.2
    for model_index, source in enumerate(models):
        rows = 9 if packed else 1
        for row in range(rows):
            for column in range(rows):
                obj = bpy.data.objects.new(f"Preview_{source.name}_{row}_{column}", source.data)
                scene.collection.objects.link(obj)
                obj.scale = (1000, 1000, 1000)
                obj.location = ((model_index * 2 - 1) * spread + (column - (rows - 1) / 2) * 2.7,
                                (row - (rows - 1) / 2) * 2.7, 0)
                obj.material_slots[0].link = "OBJECT"
                obj.material_slots[0].material = palette[(row // 3) % 3 if packed else model_index]
        text_data = bpy.data.curves.new(f"Caption{model_index}", "FONT")
        text_data.body = ("RAW / 2.61 x 2.8 mm" if model_index == 0 else "FLAT FUSED / 2.7 x 2.0 mm")
        text_data.align_x = "CENTER"
        text_data.size = 0.8 if packed else 0.23
        text_obj = bpy.data.objects.new(text_data.name, text_data)
        scene.collection.objects.link(text_obj)
        text_obj.location = ((model_index * 2 - 1) * spread, -14.5 if packed else -2.1, 0.015)
        text_data.materials.append(ink)

    bpy.ops.mesh.primitive_plane_add(size=1000 if packed else 100, location=(0, 0, -0.03))
    bpy.context.object.name = "StudioFloor"
    bpy.context.object.data.materials.append(ground)
    for name, location, energy, size in (
            ("Key", (-25, -20, 40), 45000, 25),
            ("Fill", (25, 10, 25), 18000, 20)):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (-light.location).to_track_quat("-Z", "Y").to_euler()
    camera_data = bpy.data.cameras.new("StudioCamera")
    camera = bpy.data.objects.new("StudioCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (18, -38, 43) if packed else (4.6, -9.5, 8.8)
    target = Vector((0, -0.8, 0.4)) if packed else Vector((0, -0.25, 0.8))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 67 if packed else 9.5
    scene.camera = camera
    bpy.ops.render.render(write_still=True)


def main() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    asset_scene = bpy.context.scene
    asset_scene.name = "MiniBeadKit"
    asset_scene.unit_settings.system = "METRIC"
    asset_scene.unit_settings.scale_length = 1.0
    asset_scene.unit_settings.length_unit = "MILLIMETERS"
    material = plastic_material("MiniWarmWhitePlasticPreview", (0.92, 0.875, 0.78))
    models = []
    reports = []
    for spec in SPECIFICATIONS:
        obj, profile = create_bead(spec, material)
        models.append(obj)
        reports.append(validate_bead(obj, profile, spec))
        obj.select_set(True)
    bpy.context.view_layer.objects.active = models[0]
    for path in (GLB_PATH, BLEND_PATH, REPORT_PATH, PREVIEW_PATH / "preview.png"):
        path.parent.mkdir(parents=True, exist_ok=True)
    # Both identity meshes must be exported before hiding the coincident variant.
    bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB",
                              use_selection=True, export_yup=True, export_apply=False,
                              export_normals=True, export_texcoords=True,
                              export_vertex_color="ACTIVE", export_materials="EXPORT",
                              export_extras=True, export_cameras=False, export_lights=False)
    exported = validate_export(GLB_PATH)
    models[1].select_set(False)
    models[1].hide_set(True)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                area.spaces.active.region_3d.view_location = Vector((0, 0, 0.0014))
                area.spaces.active.region_3d.view_distance = 0.008
                area.spaces.active.region_3d.view_rotation = Vector((3, -5, 5)).to_track_quat("Z", "Y")
                area.spaces.active.clip_start = 0.00001
                area.spaces.active.shading.color_type = "MATERIAL"
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH), check_existing=False)
    report = {
        "schemaVersion": 1,
        "generator": "scripts/blender/generate_mini_bead_kit.py",
        "blenderVersion": bpy.app.version_string,
        "coordinateUnits": "metres; glTF Y-up; bottom Y=0; center X/Z=0; identity node transforms",
        "nominalPitchMm": 2.7,
        "referenceBoard": {"sizeMm": 145, "columns": 52, "rows": 52,
                           "source": "https://www.artkalfusebeads.com/products/artkal-clear-large-square-pegboard-for-mini-2-6mm-beads-bcp01"},
        "rawDiameterHeightSource": "https://perler.com/products/2-000-mini-perler-beads-black",
        "verifiedManufacturerDimensionsMm": {"brand": "Perler Mini", "outerDiameter": 2.61, "height": 2.8},
        "fusedBoreProfileMm": {"lowerSocketDiameter": 0.8, "lowerSocketTopHeight": 1.82,
                               "upperThroatDiameter": 0.35, "upperThroatHeight": 1.93,
                               "mouthDiameter": 0.49, "totalHeight": 2.0},
        "assumptions": [
            "Raw bore 1.0 mm and mouth bevel 0.07 mm are art estimates, not published manufacturer dimensions.",
            "Pitch 2.7 mm is an art estimate. Artkal publishes a 145 mm board and 52x52 pegs, not a numeric pitch.",
            "Perler bead dimensions and Artkal board layout are separate brand references, not a universal manufacturing specification.",
            "Fused height 2.0 mm, upper throat 0.35 mm, upper square 2.7 mm and corner radius 0.22 mm are visual estimates.",
            "The fused lower socket is 0.8 mm wide through height 1.82 mm, above the 0.7 mm x 1.8 mm tapered pin; only its upper region contracts to the 0.35 mm throat.",
            "The flat fused model approximates an ironed surface; it is not a thermal, material-flow or volume-conservation simulation.",
            "COLOR_0 is neutral form shading, not baked directional light or physically solved ambient occlusion.",
            "The Blender viewport hides FusedMiniBead to avoid overlap. The GLB intentionally contains both identity meshes.",
        ],
        "shapeShadeLinear": {"top": 1.0, "outerWall": 0.92, "innerWall": [0.65, 0.82]},
        "models": reports,
        "glb": {"sha256": hashlib.sha256(GLB_PATH.read_bytes()).hexdigest(),
                "bytes": GLB_PATH.stat().st_size, "meshes": exported},
        "previews": ["artifacts/mini-models/01-single-beads.png", "artifacts/mini-models/02-packed-comparison.png",
                     "artifacts/mini-models/03-peg-socket-section.svg"],
        "passed": True,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_socket_section(models[1], reports[1])
    print(json.dumps({"passed": True, "glb": str(GLB_PATH), "models": reports}, ensure_ascii=False), flush=True)
    studio_preview(models, PREVIEW_PATH / "01-single-beads.png", False)
    studio_preview(models, PREVIEW_PATH / "02-packed-comparison.png", True)
    bpy.context.window.scene = asset_scene


if __name__ == "__main__":
    main()
