Export your working MoGe-3 ComfyUI workflow using Save (API Format).
Save it here as moge3_api.json.

Then:
1. Find the Load Image node ID in the API workflow JSON.
2. Set COMFY_LOAD_IMAGE_NODE in .env (or environment) to that ID.
3. Ensure the MoGe depth PNG is connected to a Save Image node.
4. If multiple images are saved, this app prefers an output filename containing 'depth'.
