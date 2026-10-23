import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    database: str
    admin_password: str | None
    secure_cookie: bool
    origins: tuple[str, ...]

    @classmethod
    def from_env(cls):
        secure = os.getenv("KIDA_COOKIE_SECURE", "true").lower()
        if secure not in ("true", "false"):
            raise RuntimeError("KIDA_COOKIE_SECURE must be true or false")
        origins = tuple(
            origin.strip().rstrip("/")
            for origin in os.getenv(
                "KIDA_ALLOWED_ORIGINS", "http://localhost:4200,http://127.0.0.1:4200"
            ).split(",")
            if origin.strip()
        )
        if not origins or "*" in origins:
            raise RuntimeError("KIDA_ALLOWED_ORIGINS requires explicit origins")
        return cls(
            os.getenv(
                "KIDA_DATABASE_PATH", str(Path(__file__).parent / "data/auth.sqlite3")
            ),
            os.getenv("KIDA_ADMIN_PASSWORD"),
            secure == "true",
            origins,
        )
