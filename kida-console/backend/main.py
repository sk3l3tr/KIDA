from pathlib import Path
from fastapi import FastAPI

app = FastAPI(title="KIDA Console API")

STATIC_DIR = Path(__file__).resolve().parent / "static"

@app.get("/api/health")
async def health():
    return {"status": "OK"}

app.frontend(
    "/",
    directory=STATIC_DIR,
    fallback="index.html",
)
