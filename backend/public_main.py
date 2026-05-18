from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.main import ROOT, app


DIST_DIR = ROOT / "frontend" / "dist"

if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/")
def serve_index() -> FileResponse:
    index_file = DIST_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(404, "frontend build not found; run npm run build")
    return FileResponse(index_file)


@app.get("/{full_path:path}")
def serve_spa(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(404, "API route not found")
    target = DIST_DIR / full_path
    if target.exists() and target.is_file():
        return FileResponse(target)
    index_file = DIST_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(404, "frontend build not found; run npm run build")
    return FileResponse(index_file)
