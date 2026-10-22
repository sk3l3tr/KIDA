from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="KIDA Console API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).resolve().parent / "static"

@app.get("/api/health")
async def health():
    return {"status": "OK"}

app.frontend(
    "/",
    directory=STATIC_DIR,
    fallback="index.html",
)

# uv run uvicorn main:app --host 0.0.0.0 --port 8000
