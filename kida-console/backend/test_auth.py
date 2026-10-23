import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from config import Settings
from fastapi.testclient import TestClient
from main import create_app
from storage import HASHER, IDLE_SECONDS, Store, digest

PASSWORD = "initial-password-123"
ORIGIN = "https://console.example.test"


class AuthTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = str(Path(temp.name) / "auth.sqlite3")
        self.app = create_app(Settings(self.path, PASSWORD, True, (ORIGIN,)))
        self.client = self.client_for(self.app)

    def client_for(self, app):
        client = TestClient(app, base_url=ORIGIN)
        client.__enter__()
        self.addCleanup(client.__exit__, None, None, None)
        return client

    def headers(self, client=None):
        client = client or self.client
        return {
            "Origin": ORIGIN,
            "X-CSRF-Token": client.get("/api/auth/csrf").json()["csrf_token"],
        }

    def login(self, client=None, username="admin", password=PASSWORD):
        client = client or self.client
        return client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers=self.headers(client),
        )

    def create(
        self, username="second", admin_username="admin", admin_password=PASSWORD
    ):
        return self.client.post(
            "/api/admins",
            json={
                "username": username,
                "password": PASSWORD,
                "admin_username": admin_username,
                "admin_password": admin_password,
            },
            headers=self.headers(),
        )

    def test_bootstrap_and_restart(self):
        with self.app.state.store.transaction() as db:
            users = db.execute("SELECT * FROM users").fetchall()
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0]["username"], "admin")
            self.assertTrue(users[0]["password_hash"].startswith("$argon2id$"))
            self.assertTrue(HASHER.verify(users[0]["password_hash"], PASSWORD))
        Store(self.path).initialize("a-different-password")
        Store(self.path).initialize(None)
        self.assertEqual(self.login().status_code, 200)
        self.assertEqual(self.login(password="a-different-password").status_code, 401)

    def test_missing_initial_password_fails(self):
        path = self.path + ".new"
        with (
            self.assertRaisesRegex(RuntimeError, "KIDA_ADMIN_PASSWORD"),
            TestClient(create_app(Settings(path, None, True, (ORIGIN,)))),
        ):
            pass
        Store(path).initialize(PASSWORD)
        with Store(path).transaction() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)

    def test_anonymous_access(self):
        for method, path in [
            ("get", "/api/admins"),
            ("post", "/api/admins"),
            ("patch", "/api/admins/me"),
            ("put", "/api/admins/me/password"),
            ("delete", "/api/admins/1"),
            ("get", "/api/auth/session"),
        ]:
            with self.subTest(path=path):
                self.assertEqual(getattr(self.client, method)(path).status_code, 401)
        self.assertEqual(self.client.get("/api/health").json(), {"status": "OK"})

    def test_csrf_cookie_rotation_and_logout(self):
        credentials = {"username": "admin", "password": PASSWORD}
        self.assertEqual(
            self.client.post("/api/auth/login", json=credentials).status_code, 403
        )
        headers = self.headers()
        for overrides in ({"Origin": "https://evil.test"}, {"X-CSRF-Token": "wrong"}):
            self.assertEqual(
                self.client.post(
                    "/api/auth/login",
                    json=credentials,
                    headers={**headers, **overrides},
                ).status_code,
                403,
            )
        old = self.client.cookies["kida_session"]
        response = self.client.post(
            "/api/auth/login", json=credentials, headers=headers
        )
        self.assertEqual(response.status_code, 200)
        for attr in ("httponly", "secure", "samesite=lax", "path=/"):
            self.assertIn(attr, response.headers["set-cookie"].lower())
        token = self.client.cookies["kida_session"]
        self.assertNotEqual(old, token)
        self.assertEqual(response.headers["cache-control"], "no-store")
        with self.app.state.store.transaction() as db:
            self.assertIsNone(
                db.execute(
                    "SELECT * FROM sessions WHERE token_hash=?", (digest(old),)
                ).fetchone()
            )
            self.assertIsNone(
                db.execute(
                    "SELECT * FROM sessions WHERE token_hash=?", (token,)
                ).fetchone()
            )
        self.assertEqual(
            self.client.post("/api/auth/logout", headers=self.headers()).status_code,
            204,
        )
        self.assertNotIn("kida_session", self.client.cookies)
        self.client.cookies.set("kida_session", token)
        self.assertEqual(self.client.get("/api/admins").status_code, 401)

    def test_idle_expiry_activity_and_restart(self):
        self.login()
        other = self.client_for(create_app(Settings(self.path, None, True, (ORIGIN,))))
        other.cookies.set("kida_session", self.client.cookies["kida_session"])
        self.assertEqual(other.get("/api/auth/session").status_code, 200)
        with self.app.state.store.transaction() as db:
            db.execute(
                "UPDATE sessions SET last_seen=last_seen-?", (IDLE_SECONDS - 10,)
            )
        self.assertEqual(other.get("/api/admins").status_code, 200)
        with self.app.state.store.transaction() as db:
            db.execute("UPDATE sessions SET last_seen=last_seen-?", (IDLE_SECONDS + 1,))
        self.assertEqual(other.get("/api/admins").status_code, 401)

    def test_creation_requires_own_credentials_and_unique_username(self):
        self.login()
        self.assertEqual(self.create(admin_password="wrong").status_code, 401)
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create("SECOND").status_code, 409)
        self.assertEqual(self.create("bad space").status_code, 422)
        self.assertEqual(self.create("third", admin_username="second").status_code, 401)
        self.assertEqual(
            self.client.post(
                "/api/admins",
                json={"username": "third", "password": PASSWORD},
                headers=self.headers(),
            ).status_code,
            422,
        )
        self.assertEqual(
            set(self.client.get("/api/admins").json()[0]), {"id", "username"}
        )

    def test_only_self_can_change_credentials(self):
        self.login()
        target = self.create().json()["id"]
        headers = self.headers()
        self.assertEqual(
            self.client.patch(
                f"/api/admins/{target}", json={"username": "hijacked"}, headers=headers
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.put(
                f"/api/admins/{target}/password",
                json={"password": PASSWORD},
                headers=headers,
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.patch(
                "/api/admins/me", json={"username": "second"}, headers=headers
            ).status_code,
            409,
        )
        self.assertEqual(
            self.client.patch(
                "/api/admins/me", json={"username": "renamed"}, headers=headers
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get("/api/auth/session").json()["user"]["username"], "renamed"
        )
        self.assertEqual(self.login(username="renamed").status_code, 200)

    def test_password_change_revokes_all_sessions(self):
        self.login()
        other = self.client_for(self.app)
        self.login(other)
        headers = self.headers()
        self.assertEqual(
            self.client.put(
                "/api/admins/me/password",
                json={"current_password": "wrong", "password": "replacement-password"},
                headers=headers,
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.put(
                "/api/admins/me/password",
                json={"current_password": PASSWORD, "password": "replacement-password"},
                headers=headers,
            ).status_code,
            204,
        )
        self.assertNotIn("kida_session", self.client.cookies)
        self.assertEqual(other.get("/api/admins").status_code, 401)
        self.assertEqual(self.login().status_code, 401)
        self.assertEqual(self.login(password="replacement-password").status_code, 200)

    def test_delete_others_self_and_last(self):
        self.login()
        target = self.create().json()["id"]
        other = self.client_for(self.app)
        self.login(other, "second")
        self.assertEqual(
            self.client.delete(
                f"/api/admins/{target}", headers=self.headers()
            ).status_code,
            204,
        )
        self.assertEqual(other.get("/api/admins").status_code, 401)
        self.assertEqual(
            self.client.delete("/api/admins/1", headers=self.headers()).status_code, 409
        )
        self.create("third")
        self.assertEqual(
            self.client.delete("/api/admins/1", headers=self.headers()).status_code, 204
        )
        self.assertNotIn("kida_session", self.client.cookies)
        Store(self.path).initialize("should-not-create-admin")
        with self.app.state.store.transaction() as db:
            self.assertEqual(
                [r[0] for r in db.execute("SELECT username FROM users")], ["third"]
            )

    def test_concurrent_self_deletion(self):
        self.login()
        target = self.create().json()["id"]
        other = self.client_for(self.app)
        self.login(other, "second")
        first_headers, second_headers = self.headers(), self.headers(other)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(
                self.client.delete, "/api/admins/1", headers=first_headers
            )
            second = pool.submit(
                other.delete, f"/api/admins/{target}", headers=second_headers
            )
            self.assertEqual(
                sorted([first.result().status_code, second.result().status_code]),
                [204, 409],
            )
        with self.app.state.store.transaction() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)

    def test_rate_limit_persists_and_expires(self):
        for _ in range(5):
            self.assertEqual(self.login(password="wrong").status_code, 401)
        response = self.login()
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response.headers["retry-after"]), 0)
        other = self.client_for(create_app(Settings(self.path, None, True, (ORIGIN,))))
        self.assertEqual(self.login(other).status_code, 429)
        with self.app.state.store.transaction() as db:
            db.execute("UPDATE attempts SET created=created-901")
        self.assertEqual(self.login().status_code, 200)

    def test_ip_and_reauthentication_limits(self):
        self.login()
        for _ in range(5):
            self.assertEqual(self.create(admin_password="wrong").status_code, 401)
        self.assertEqual(self.create().status_code, 429)
        with self.app.state.store.transaction() as db:
            db.execute("DELETE FROM attempts")
        for n in range(30):
            self.app.state.store.reserve_attempt(f"user-{n}", "testclient")
        self.assertEqual(self.login(username="another").status_code, 429)

    def test_mutation_csrf_unknown_api_and_prelogin_expiry(self):
        self.login()
        self.assertEqual(self.client.post("/api/admins", json={}).status_code, 403)
        self.assertEqual(self.client.delete("/api/admins/1").status_code, 403)
        for path in ("/api", "/api/does-not-exist"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 404)
            self.assertIn("application/json", response.headers["content-type"])
        self.client.cookies.clear()
        headers = self.headers()
        with self.app.state.store.transaction() as db:
            db.execute(
                "UPDATE sessions SET last_seen=last_seen-601 WHERE user_id IS NULL"
            )
        self.assertEqual(
            self.client.post(
                "/api/auth/login",
                json={"username": "admin", "password": PASSWORD},
                headers=headers,
            ).status_code,
            403,
        )

    def test_development_cookie_and_cors(self):
        dev = self.client_for(create_app(Settings(self.path, None, False, (ORIGIN,))))
        self.assertNotIn(
            "secure", dev.get("/api/auth/csrf").headers["set-cookie"].lower()
        )
        headers = {
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type,X-CSRF-Token",
        }
        response = self.client.options("/api/admins", headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-credentials"], "true")
        self.assertEqual(response.headers["access-control-allow-origin"], ORIGIN)
        self.assertEqual(
            self.client.options(
                "/api/admins", headers={**headers, "Origin": "https://evil.test"}
            ).status_code,
            400,
        )

    def test_validation_never_echoes_passwords_and_revoked_reauth_is_identified(self):
        self.login()
        headers = self.headers()
        response = self.client.post(
            "/api/admins",
            json={
                "username": "another",
                "password": "tiny-secret",
                "admin_username": "admin",
                "admin_password": PASSWORD,
            },
            headers=headers,
        )
        self.assertEqual(response.status_code, 422)
        self.assertNotIn("tiny-secret", response.text)
        self.assertNotIn(PASSWORD, response.text)
        with self.app.state.store.transaction() as db:
            db.execute("DELETE FROM sessions")
        response = self.client.post("/api/admins", json={}, headers=headers)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["x-kida-session-expired"], "true")
