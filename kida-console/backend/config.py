import math
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    database: str
    admin_password: str | None
    secure_cookie: bool
    origins: tuple[str, ...]
    core_url: str = "http://127.0.0.1:8989"
    core_timeout_seconds: float = 10

    def __post_init__(self):
        try:
            url = urlsplit(self.core_url)
            valid_url = (
                url.scheme in ("http", "https")
                and url.hostname
                and url.port != 0
                and not url.username
                and not url.password
                and not url.query
                and not url.fragment
                and not any(c.isspace() for c in self.core_url)
            )
        except ValueError:
            valid_url = False
        if not valid_url:
            raise RuntimeError(
                "KIDA_CORE_URL requires an absolute HTTP(S) URL without credentials, query or fragment"
            )
        if (
            not math.isfinite(self.core_timeout_seconds)
            or self.core_timeout_seconds <= 0
        ):
            raise RuntimeError("KIDA_CORE_TIMEOUT_SECONDS must be finite and positive")

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
        try:
            timeout = float(os.getenv("KIDA_CORE_TIMEOUT_SECONDS", "10"))
        except ValueError:
            raise RuntimeError(
                "KIDA_CORE_TIMEOUT_SECONDS must be finite and positive"
            ) from None
        return cls(
            os.getenv(
                "KIDA_DATABASE_PATH", str(Path(__file__).parent / "data/auth.sqlite3")
            ),
            os.getenv("KIDA_ADMIN_PASSWORD"),
            secure == "true",
            origins,
            os.getenv("KIDA_CORE_URL", "http://127.0.0.1:8989"),
            timeout,
        )
