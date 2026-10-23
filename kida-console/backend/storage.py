import hashlib
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import HTTPException

HASHER = PasswordHasher()
DUMMY_HASH = HASHER.hash(secrets.token_urlsafe(32))
IDLE_SECONDS = 8 * 60 * 60


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def password_matches(encoded: str, password: str) -> bool:
    try:
        return HASHER.verify(encoded, password)
    except VerificationError:
        return False


class Store:
    def __init__(self, path):
        self.path = path

    @contextmanager
    def transaction(self):
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()

    def initialize(self, initial_password):
        Path(self.path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self.transaction() as db:
            Path(self.path).chmod(0o600)
            db.execute(
                "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, last_seen REAL NOT NULL)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, account TEXT NOT NULL, address TEXT NOT NULL, created REAL NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS attempts_created ON attempts(created)"
            )
            if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
                if not initial_password:
                    raise RuntimeError(
                        "KIDA_ADMIN_PASSWORD is required to initialize administrators"
                    )
                if not 12 <= len(initial_password) <= 128:
                    raise RuntimeError(
                        "KIDA_ADMIN_PASSWORD must contain 12–128 characters"
                    )
                db.execute(
                    "INSERT INTO users(username,password_hash) VALUES (?,?)",
                    ("admin", HASHER.hash(initial_password)),
                )

    def new_session(self, db, user_id=None):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO sessions VALUES (?,?,?,?)",
            (digest(token), user_id, csrf, time.time()),
        )
        return token, csrf

    def session(self, db, token, touch=False):
        now = time.time()
        db.execute(
            "DELETE FROM sessions WHERE last_seen <= ? AND user_id IS NOT NULL",
            (now - IDLE_SECONDS,),
        )
        db.execute(
            "DELETE FROM sessions WHERE last_seen <= ? AND user_id IS NULL",
            (now - 600,),
        )
        row = db.execute(
            "SELECT s.*, u.username FROM sessions s LEFT JOIN users u ON u.id=s.user_id WHERE token_hash=?",
            (digest(token),),
        ).fetchone()
        if row and touch:
            db.execute(
                "UPDATE sessions SET last_seen=? WHERE token_hash=?",
                (now, row["token_hash"]),
            )
        return row

    def reserve_attempt(self, account, address):
        now = time.time()
        with self.transaction() as db:
            db.execute("DELETE FROM attempts WHERE created <= ?", (now - 900,))
            for column, value, limit in [
                ("account", digest(account.lower()), 5),
                ("address", digest(address), 30),
            ]:
                row = db.execute(
                    f"SELECT COUNT(*), MIN(created) FROM attempts WHERE {column}=?",
                    (value,),
                ).fetchone()
                if row[0] >= limit:
                    raise HTTPException(
                        429,
                        "Demasiados intentos. Inténtalo más tarde.",
                        headers={
                            "Retry-After": str(max(1, int(row[1] + 900 - now) + 1))
                        },
                    )
            return db.execute(
                "INSERT INTO attempts(account,address,created) VALUES (?,?,?)",
                (digest(account.lower()), digest(address), now),
            ).lastrowid

    def clear_attempt(self, attempt):
        with self.transaction() as db:
            db.execute("DELETE FROM attempts WHERE id=?", (attempt,))
