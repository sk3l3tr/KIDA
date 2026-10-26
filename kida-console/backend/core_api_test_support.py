import json
import tempfile
import unittest
from pathlib import Path
from uuid import UUID

import httpx
from fastapi.testclient import TestClient

from config import Settings
from core.client import CoreClient, get_core_client
from main import create_app

ORIGIN = "https://console.test"


class CoreApiTestCase(unittest.TestCase):
    """Per-test authenticated app and mock CORE; contains no test methods.

    Cleanups run in reverse order: mock HTTP client, app lifespan, temporary DB.
    """

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.settings = Settings(
            str(Path(temp.name) / "auth.db"), "test-password-123", True, (ORIGIN,)
        )
        self.app = create_app(self.settings)
        self.client = TestClient(self.app, base_url=ORIGIN)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)
        self.calls = []
        self.reply = {"overall": "OK", "sensors": []}
        self.error = self.envelope = self.raw = None
        self.http_status = 200
        self.http = httpx.AsyncClient(
            base_url="http://core.test/",
            transport=httpx.MockTransport(self.handle),
            follow_redirects=False,
        )
        self.addCleanup(self.client.portal.call, self.http.aclose)
        self.app.dependency_overrides[get_core_client] = lambda: CoreClient(self.http)
        token = self.client.get("/api/auth/csrf").json()["csrf_token"]
        login = self.client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "test-password-123"},
            headers={"Origin": ORIGIN, "X-CSRF-Token": token},
        )
        self.assertEqual(login.status_code, 200)
        self.headers = {"Origin": ORIGIN, "X-CSRF-Token": login.json()["csrf_token"]}

    def handle(self, request):
        body = json.loads(request.content)
        self.calls.append(body)
        self.assertEqual(str(request.url), "http://core.test/command")
        self.assertEqual(request.method, "POST")
        self.assertEqual(str(UUID(body["id"])), body["id"])
        if self.error:
            raise self.error("simulated", request=request)
        if self.raw is not None:
            return httpx.Response(
                self.http_status,
                content=self.raw.replace(b"REQUEST_ID", body["id"].encode()),
            )
        envelope = {"id": body["id"], "status": "OK", "data": self.reply}
        if self.envelope:
            envelope.update(self.envelope)
        return httpx.Response(
            self.http_status, json=envelope, headers={"location": "http://other.test/"}
        )
