from fastapi import FastAPI

app = FastAPI(title="KIDA Console API")

@app.get("/health")
async def health():
    return {"status": "OK"}
