import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from depth_to_obj import depthmap_to_obj

BASE = Path(__file__).resolve().parent
UPLOADS = BASE / "uploads"
OUTPUTS = BASE / "outputs"
WORKFLOW_PATH = Path(os.getenv("COMFY_WORKFLOW", BASE / "workflows" / "moge3_api.json"))
COMFY_URL = os.getenv("COMFY_URL", "http://127.0.0.1:8188").rstrip("/")
# Your existing converter should accept: python depth_to_obj.py INPUT.png OUTPUT.obj
CONVERTER = os.getenv("DEPTH_CONVERTER", str(BASE / "depth_to_obj.py"))
CONVERTER_ARGS = os.getenv("DEPTH_CONVERTER_ARGS", "").split()

for folder in (UPLOADS, OUTPUTS):
    folder.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="MoGe-3 Depth to OBJ")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")


@app.get("/")
async def index():
    return FileResponse(BASE / "static" / "index.html")
@app.get("/choco")
async def index():
    return FileResponse(BASE / "static" / "custom-choco.html")



@app.get("/api/health")
async def health():
    return {"ok": True, "comfy_url": COMFY_URL, "workflow_exists": WORKFLOW_PATH.exists()}


def patch_workflow(workflow: dict, image_name: str):
    """Set the uploaded image on the configured LoadImage node."""
    node_id = os.getenv("COMFY_LOAD_IMAGE_NODE", "10")
    try:
        workflow[node_id]["inputs"]["image"] = image_name
    except KeyError:
        raise HTTPException(
            500,
            f"Cannot find LoadImage node {node_id}. Set COMFY_LOAD_IMAGE_NODE "
            "to the node ID in your API-format workflow."
        )


async def submit_and_wait(image_path: Path, job_id: str) -> Path:
    if not WORKFLOW_PATH.exists():
        raise HTTPException(500, f"Workflow not found: {WORKFLOW_PATH}")
    workflow = json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))

    async with httpx.AsyncClient(timeout=httpx.Timeout(30, read=30)) as client:
        with image_path.open("rb") as f:
            upload = await client.post(
                f"{COMFY_URL}/upload/image",
                files={"image": (image_path.name, f, "image/png")},
                data={"type": "input", "overwrite": "true"},
            )
        upload.raise_for_status()
        comfy_image_name = upload.json()["name"]
        patch_workflow(workflow, comfy_image_name)

        submitted = await client.post(
            f"{COMFY_URL}/prompt",
            json={"prompt": workflow, "client_id": job_id},
        )
        submitted.raise_for_status()
        prompt_id = submitted.json()["prompt_id"]

        # Poll history. ComfyUI keeps completed prompt outputs here.
        for _ in range(900):
            await asyncio.sleep(1)
            response = await client.get(f"{COMFY_URL}/history/{prompt_id}")
            response.raise_for_status()
            history = response.json()
            if prompt_id not in history:
                continue

            entry = history[prompt_id]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise HTTPException(502, "ComfyUI reported an inference error.")
            if status.get("completed"):
                outputs = entry.get("outputs", {})
                candidates = []
                for node_output in outputs.values():
                    for item in node_output.get("images", []):
                        # Prefer depth-named output, otherwise first saved image.
                        candidates.append(item)
                if not candidates:
                    raise HTTPException(
                        502,
                        "Workflow completed but returned no image outputs. "
                        "Ensure the depth PNG is connected to SaveImage."
                    )
                candidates.sort(key=lambda x: ("depth" not in x["filename"].lower(),
                                                x["filename"]))
                chosen = candidates[0]
                view = await client.get(
                    f"{COMFY_URL}/view",
                    params={
                        "filename": chosen["filename"],
                        "subfolder": chosen.get("subfolder", ""),
                        "type": chosen.get("type", "output"),
                    },
                )
                view.raise_for_status()
                depth_path = OUTPUTS / f"{job_id}_depth.png"
                depth_path.write_bytes(view.content)
                return depth_path

    raise HTTPException(504, "ComfyUI timed out after 15 minutes.")


async def convert_depth(depth_path: Path, obj_path: Path):
    depthmap_to_obj(depth_path,obj_path)


@app.post("/api/generate")
async def generate(image: UploadFile = File(...)):
    if image.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(415, "Upload a PNG, JPEG or WebP image.")
    job_id = uuid.uuid4().hex
    suffix = {"image/png": ".png", "image/jpeg": ".jpg",
              "image/webp": ".webp"}[image.content_type]
    input_path = UPLOADS / f"{job_id}{suffix}"
    depth_path = OUTPUTS / f"{job_id}_depth.png"
    obj_path = OUTPUTS / f"{job_id}.obj"

    data = await image.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Image must be smaller than 15 MB.")
    input_path.write_bytes(data)

    try:
        depth_path = await submit_and_wait(input_path, job_id)
        await convert_depth(depth_path, obj_path)
    except Exception:
        # Keep generated files for debugging; remove only uploaded source.
        input_path.unlink(missing_ok=True)
        raise
    input_path.unlink(missing_ok=True)

    return {
        "id": job_id,
        "depth_url": f"/api/files/{job_id}/depth",
        "obj_url": f"/api/files/{job_id}/model",
        "download_url": f"/api/files/{job_id}/download",
    }


@app.get("/api/files/{job_id}/depth")
async def get_depth(job_id: str):
    path = OUTPUTS / f"{job_id}_depth.png"
    if not path.is_file():
        raise HTTPException(404, "Depth map not found")
    return FileResponse(path, media_type="image/png")


@app.get("/api/files/{job_id}/model")
async def get_model(job_id: str):
    path = OUTPUTS / f"{job_id}.obj"
    if not path.is_file():
        raise HTTPException(404, "OBJ not found")
    return FileResponse(path, media_type="text/plain")


@app.get("/api/files/{job_id}/download")
async def download_model(job_id: str):
    path = OUTPUTS / f"{job_id}.obj"
    if not path.is_file():
        raise HTTPException(404, "OBJ not found")
    return FileResponse(path, media_type="application/octet-stream",
                        filename=f"moge3_{job_id}.obj")
