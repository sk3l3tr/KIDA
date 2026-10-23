import secrets
import sqlite3

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from storage import DUMMY_HASH, HASHER, digest, password_matches

router = APIRouter(prefix="/api")
COOKIE = "kida_session"


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class NewUsername(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9_.-]{3,64}$")


class NewAccount(NewUsername):
    password: str = Field(min_length=12, max_length=128)
    admin_username: str = Field(min_length=1, max_length=64)
    admin_password: str = Field(min_length=1, max_length=128)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=12, max_length=128)


def set_cookie(request, response, token):
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=request.app.state.settings.secure_cookie,
        samesite="lax",
        path="/",
    )


def clear_cookie(request, response):
    response.delete_cookie(
        COOKIE,
        path="/",
        httponly=True,
        secure=request.app.state.settings.secure_cookie,
        samesite="lax",
    )


def authenticated(db, request):
    row = request.app.state.store.session(db, request.cookies.get(COOKIE, ""))
    if not row or row["user_id"] is None:
        raise HTTPException(
            401,
            "Inicia sesión para continuar.",
            headers={"X-Kida-Session-Expired": "true"},
        )
    return row


def identity(row):
    return {"id": row["user_id"], "username": row["username"]}


def verify_credentials(request, username, password, expected_id=None):
    store = request.app.state.store
    attempt = store.reserve_attempt(
        username, request.client.host if request.client else "unknown"
    )
    with store.transaction() as db:
        user = db.execute(
            "SELECT * FROM users WHERE username=?", (username,)
        ).fetchone()
    valid = password_matches(user["password_hash"] if user else DUMMY_HASH, password)
    if not valid or not user or (expected_id is not None and user["id"] != expected_id):
        raise HTTPException(401, "Credenciales incorrectas.")
    store.clear_attempt(attempt)
    return dict(user)


@router.get("/auth/csrf")
def csrf(request: Request, response: Response):
    store = request.app.state.store
    with store.transaction() as db:
        row = store.session(db, request.cookies.get(COOKIE, ""))
        if row:
            return {"csrf_token": row["csrf"]}
        token, csrf_token = store.new_session(db)
    set_cookie(request, response, token)
    return {"csrf_token": csrf_token}


@router.post("/auth/login")
def login(body: Credentials, request: Request, response: Response):
    user = verify_credentials(request, body.username, body.password)
    store = request.app.state.store
    with store.transaction() as db:
        current = db.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        if not current or current["password_hash"] != user["password_hash"]:
            raise HTTPException(401, "Credenciales incorrectas.")
        previous = store.session(db, request.cookies.get(COOKIE, ""))
        if not previous or not secrets.compare_digest(
            request.headers.get("x-csrf-token", "").encode(), previous["csrf"].encode()
        ):
            raise HTTPException(403, "Token CSRF inválido. Recarga la página.")
        db.execute("DELETE FROM sessions WHERE token_hash=?", (previous["token_hash"],))
        token, csrf_token = store.new_session(db, user["id"])
    set_cookie(request, response, token)
    return {
        "user": {"id": user["id"], "username": current["username"]},
        "csrf_token": csrf_token,
    }


@router.get("/auth/session")
def session(request: Request):
    with request.app.state.store.transaction() as db:
        row = authenticated(db, request)
        return {"user": identity(row), "csrf_token": row["csrf"]}


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response):
    with request.app.state.store.transaction() as db:
        authenticated(db, request)
        db.execute(
            "DELETE FROM sessions WHERE token_hash=?",
            (digest(request.cookies.get(COOKIE, "")),),
        )
    clear_cookie(request, response)


@router.get("/admins")
def accounts(request: Request):
    with request.app.state.store.transaction() as db:
        authenticated(db, request)
        return [
            dict(row)
            for row in db.execute("SELECT id,username FROM users ORDER BY username")
        ]


@router.post("/admins", status_code=201)
def create_account(body: NewAccount, request: Request):
    store = request.app.state.store
    with store.transaction() as db:
        actor = dict(authenticated(db, request))
    verified = verify_credentials(
        request, body.admin_username, body.admin_password, actor["user_id"]
    )
    encoded = HASHER.hash(body.password)
    with store.transaction() as db:
        authenticated(db, request)
        current = db.execute(
            "SELECT password_hash FROM users WHERE id=?", (verified["id"],)
        ).fetchone()
        if not current or current["password_hash"] != verified["password_hash"]:
            raise HTTPException(
                401,
                "Inicia sesión para continuar.",
                headers={"X-Kida-Session-Expired": "true"},
            )
        try:
            cursor = db.execute(
                "INSERT INTO users(username,password_hash) VALUES (?,?)",
                (body.username, encoded),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "El username ya está en uso.") from None
        return {"id": cursor.lastrowid, "username": body.username}


@router.patch("/admins/me")
def rename(body: NewUsername, request: Request):
    with request.app.state.store.transaction() as db:
        actor = authenticated(db, request)
        try:
            db.execute(
                "UPDATE users SET username=? WHERE id=?",
                (body.username, actor["user_id"]),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "El username ya está en uso.") from None
        return {"id": actor["user_id"], "username": body.username}


@router.put("/admins/me/password", status_code=204)
def change_password(body: PasswordChange, request: Request, response: Response):
    store = request.app.state.store
    with store.transaction() as db:
        actor = dict(authenticated(db, request))
    verified = verify_credentials(
        request, actor["username"], body.current_password, actor["user_id"]
    )
    encoded = HASHER.hash(body.password)
    with store.transaction() as db:
        authenticated(db, request)
        result = db.execute(
            "UPDATE users SET password_hash=? WHERE id=? AND password_hash=?",
            (encoded, actor["user_id"], verified["password_hash"]),
        )
        if result.rowcount != 1:
            raise HTTPException(
                401,
                "Inicia sesión para continuar.",
                headers={"X-Kida-Session-Expired": "true"},
            )
        db.execute("DELETE FROM sessions WHERE user_id=?", (actor["user_id"],))
    clear_cookie(request, response)


@router.delete("/admins/{user_id}", status_code=204)
def delete_account(user_id: int, request: Request, response: Response):
    with request.app.state.store.transaction() as db:
        actor = authenticated(db, request)
        if not db.execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone():
            raise HTTPException(404, "La cuenta no existe.")
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] <= 1:
            raise HTTPException(409, "No se puede eliminar el último administrador.")
        db.execute("DELETE FROM users WHERE id=?", (user_id,))
        if user_id == actor["user_id"]:
            clear_cookie(request, response)


def check_request(request):
    store = request.app.state.store
    public = request.url.path in ("/api/health", "/api/auth/csrf", "/api/auth/login")
    with store.transaction() as db:
        row = store.session(db, request.cookies.get(COOKIE, ""))
        if not public and (not row or row["user_id"] is None):
            raise HTTPException(
                401,
                "Inicia sesión para continuar.",
                headers={"X-Kida-Session-Expired": "true"},
            )
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin not in request.app.state.settings.origins:
                raise HTTPException(403, "Origen no permitido.")
            supplied = request.headers.get("x-csrf-token", "")
            if not row or not secrets.compare_digest(
                supplied.encode(), row["csrf"].encode()
            ):
                raise HTTPException(403, "Token CSRF inválido. Recarga la página.")
        if not public and row:
            store.session(db, request.cookies.get(COOKIE, ""), touch=True)
