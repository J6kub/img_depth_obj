import numpy as np
from PIL import Image
import trimesh

def depthmap_to_obj(
    input_path,
    output_path,
    width=100,
    depth_scale=30,
    invert=False,
    step=2
):
    # Load depth map
    img = Image.open(input_path).convert("L")
    depth = np.array(img, dtype=np.float32) / 255.0

    # Downsample
    depth = depth[::step, ::step]

    if invert:
        depth = 1.0 - depth

    height, width_px = depth.shape

    # Generate XY coordinates
    x = np.linspace(0, width, width_px)
    y = np.linspace(0, width * height / width_px, height)

    xx, yy = np.meshgrid(x, y)

    # Reduce depth range by half
    zz = depth * (depth_scale / 2)

    # Generate vertices
    vertices = np.column_stack((
        xx.flatten(),
        yy.flatten(),
        zz.flatten()
    ))

    # Generate triangles
    faces = []

    for row in range(height - 1):
        for col in range(width_px - 1):
            i = row * width_px + col

            faces.append([i, i + width_px, i + 1])
            faces.append([i + 1, i + width_px, i + width_px + 1])

    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=np.array(faces),
        process=True
    )

    # Rotate 180 degrees around Y axis
    rotation = trimesh.transformations.rotation_matrix(
        np.pi, [1, 0, 1]
    )
    mesh.apply_transform(rotation)
    
    mid_x = (mesh.bounds[0][0] + mesh.bounds[1][0]) * 0.15

    # Keep vertices/faces on the left side of the midpoint
    plane_origin = [mid_x, 0, 0]
    plane_normal = [1, 0, 0]

    mesh = mesh.slice_plane(
        plane_origin=plane_origin,
        plane_normal=plane_normal,
        cap=False
    )
    
    mesh.export(output_path)

    print(f"Exported {output_path}")
    print(f"Vertices: {len(vertices)}")
    print(f"Faces: {len(faces)}")