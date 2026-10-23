import copy
import json
import tempfile
import unittest
from pathlib import Path
from uuid import UUID

import httpx
from config import Settings
from core.client import CoreClient, get_core_client
from fastapi.testclient import TestClient
from main import create_app

ORIGIN = "https://console.test"
FIXTURES = Path(__file__).resolve().parents[2] / "tests/fixtures"
CONFIG = json.loads((FIXTURES / "backup.json").read_text())
JOB = {"id": "job-id", **CONFIG}
HEALTH = json.loads((FIXTURES / "backup-health.json").read_text())
RUN = {"run_id": HEALTH["created"]["run_id"]}
DEFINITION = {"definition_path": " ./health/../app.toml "}
MINIMAL = {
    "name": " demo ",
    "sources": [" ./data "],
    "targets": [{"path": "../target"}],
}
QUEUED = {"state": "QUEUED", "execution_id": "execution-id"}
OPERATIONS = [
    ("GET", "/config", "config.list", None, {"backups": [JOB]}),
    ("POST", "/config/create", "config.create", CONFIG, JOB),
    ("POST", "/config/delete", "config.delete", {"name": " daily "}, JOB),
    ("POST", "/run", "run", {"id": "job-id"}, QUEUED),
    ("GET", "/health", "health.list", None, HEALTH["listed"]),
    ("GET", "/health/get", "health.get", RUN, HEALTH["closed"]),
    (
        "POST",
        "/health/create",
        "health.create",
        {**DEFINITION, "mode": "MANUAL"},
        HEALTH["created"],
    ),
    ("POST", "/health/start", "health.start", RUN, {**RUN, **QUEUED}),
    ("POST", "/health/run", "health.run", DEFINITION, {**RUN, **QUEUED}),
    ("POST", "/health/stop", "health.stop", RUN, HEALTH["closed"]),
    ("POST", "/health/delete", "health.delete", RUN, HEALTH["closed"]),
    ("GET", "/health/reports", "health.report.list", None, [RUN["run_id"]]),
    ("GET", "/health/reports/get", "health.report.get", RUN, HEALTH["report"]),
    ("POST", "/health/reports/delete", "health.report.delete", RUN, HEALTH["deleted"]),
]


class BackupTests(unittest.TestCase):
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

    def request_operation(self, operation, headers=None):
        method, path, _, body, _ = operation
        kwargs = {"params": body} if method == "GET" else {"json": body}
        return self.client.request(
            method,
            "/api/backup" + path,
            headers=self.headers if headers is None else headers,
            **kwargs,
        )

    def post(self, path, body):
        return self.client.post("/api/backup" + path, json=body, headers=self.headers)

    def test_all_operations_and_exact_parameters(self):
        for operation in OPERATIONS:
            with self.subTest(path=operation[1]):
                self.reply = operation[4]
                before = len(self.calls)
                response = self.request_operation(operation)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), self.reply)
                self.assertEqual(len(self.calls), before + 1)
                self.assertEqual(self.calls[-1]["command"], "backup." + operation[2])
                self.assertEqual(self.calls[-1]["params"], operation[3] or {})
                self.assertEqual(set(self.calls[-1]), {"id", "command", "params"})
        self.assertEqual(len({c["id"] for c in self.calls}), 14)

    def test_omission_nullability_and_json_preservation(self):
        self.reply = JOB
        bodies = [
            MINIMAL,
            CONFIG,
            {**MINIMAL, "lifecycle": {}, "retention": {}},
            {**MINIMAL, "schedule": None, "retention": None},
            {**MINIMAL, "targets": [{"path": "", "filesystem_uuid": None}]},
            {**MINIMAL, "retention": {"max_age": None, "keep_last": None}},
            {**MINIMAL, "retention": {"keep_last": 2**32 - 1}},
        ]
        for value in (
            None,
            True,
            3,
            1.5,
            "é😀\n\t\x00",
            [],
            {},
            {"controls\n": [None, False]},
        ):
            bodies.append(
                {
                    **MINIMAL,
                    "schedule": value,
                    "lifecycle": {
                        "pre_backup": [
                            {"command": " unknown.command ", "params": value},
                            {"command": "no-params"},
                        ]
                    },
                }
            )
        for body in bodies:
            response = self.post("/config/create", body)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.calls[-1]["params"], body)
        for path in ("/run", "/config/delete"):
            self.reply = QUEUED if path == "/run" else JOB
            for key in ("id", "name"):
                for value in ("", " invalid UUID ", "\nname\t"):
                    body = {key: value}
                    self.assertEqual(self.post(path, body).status_code, 200)
                    self.assertEqual(self.calls[-1]["params"], body)
        self.reply = HEALTH["created"]
        for mode in ("AUTOMATIC", "MANUAL"):
            self.assertEqual(
                self.post("/health/create", {**DEFINITION, "mode": mode}).status_code,
                200,
            )

    def test_invalid_inputs_never_contact_core(self):
        cases = []
        for path in ("/run", "/config/delete"):
            cases.extend(
                (path, body)
                for body in (
                    {},
                    None,
                    [],
                    {"id": None},
                    {"id": "i", "name": None},
                    {"id": "i", "name": "n"},
                    {"id": 1},
                    {"name": True},
                    {"id": "i", "extra": 1},
                )
            )
        for key in MINIMAL:
            cases.append(
                ("/config/create", {k: v for k, v in MINIMAL.items() if k != key})
            )
        invalid = [None, [], {**MINIMAL, "extra": 1}]
        for key in ("name", "sources", "targets", "compression", "lifecycle"):
            invalid.append({**MINIMAL, key: None})
        invalid += [
            {**MINIMAL, "compression": "zip"},
            {**MINIMAL, "sources": [1]},
            {**MINIMAL, "lifecycle": {"pre_backup": None}},
            {**MINIMAL, "lifecycle": {"pre_backup": [{"command": "c", "extra": 1}]}},
            {**MINIMAL, "retention": {"protected_restore_points": None}},
        ]
        for value in (1, "true", None):
            invalid.append({**MINIMAL, "targets": [{"path": "p", "required": value}]})
        for value in (-1, 2**32, True, 1.0, "1"):
            invalid.append({**MINIMAL, "retention": {"keep_last": value}})
        cases.extend(("/config/create", body) for body in invalid)
        for operation in OPERATIONS:
            if operation[0] == "POST" and operation[1].startswith("/health"):
                body = operation[3]
                for key in body:
                    for value in (None, True, 3):
                        cases.append((operation[1], {**body, key: value}))
                    cases.append(
                        (operation[1], {k: v for k, v in body.items() if k != key})
                    )
                cases.append((operation[1], {**body, "extra": 1}))
        cases.append(("/health/create", {**DEFINITION, "mode": "manual"}))
        for path, body in cases:
            with self.subTest(path=path, body=body):
                response = self.post(path, body)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertTrue(
                    all("input" not in e for e in response.json()["detail"])
                )
        for path in ("/health/get", "/health/reports/get"):
            self.assertEqual(self.client.get("/api/backup" + path).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_invalid_json_never_contacts_core(self):
        cases = [
            ("/config/create", {**MINIMAL, "schedule": value})
            for value in (
                {"nested": ["\ud800"]},
                {"\udfff": None},
                float("nan"),
                float("inf"),
                -float("inf"),
            )
        ]
        cases += [
            ("/run", {"id": "\ud800"}),
            ("/health/run", {"definition_path": "\ud800"}),
            ("/config/create", {**MINIMAL, "\ud800": "extra"}),
            (
                "/config/create",
                {
                    **MINIMAL,
                    "lifecycle": {
                        "pre_backup": [{"command": "x", "params": {"\ud800": 1}}]
                    },
                },
            ),
        ]
        for path, body in cases:
            response = self.client.post(
                "/api/backup" + path,
                content=json.dumps(body),
                headers={**self.headers, "Content-Type": "application/json"},
            )
            self.assertEqual(response.status_code, 422, response.text)
        response = self.client.post(
            "/api/backup/config/create",
            content=json.dumps({**MINIMAL, "schedule": "NUMBER"}).replace(
                '"NUMBER"', "1e999"
            ),
            headers={**self.headers, "Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])

    def test_empty_arrays_and_future_response_fields(self):
        for path, reply in (
            ("/config", {"backups": []}),
            ("/health", []),
            ("/health/reports", []),
        ):
            self.reply = reply
            self.assertEqual(self.client.get("/api/backup" + path).json(), reply)
        job = copy.deepcopy(JOB)
        job.update(compression="future", future={"null": None})
        job["targets"][0]["future"] = []
        record = copy.deepcopy(HEALTH["listed"][0])
        record.update(
            mode="FUTURE",
            state="FUTURE",
            record_version=2,
            report_status="FUTURE",
            future=None,
            project={"owner": "o", "project": "p", "future": []},
            services=[{"name": "app", "image": "image", "replicas": 2**32 - 1}],
            resources=[{"kind": "future", "identity": "i"}],
            restore_provenance={
                "path": "p",
                "identity": {"device": 2**64 - 1, "inode": 1, "future": None},
            },
        )
        record["artifact"]["size"] = 2**64 - 1
        record["diagnosis"].update(result="FUTURE", future=[])
        record["diagnosis"]["evidence"][0].update(service=None, logs=None, future={})
        record["cleanup"].update(state="FUTURE", future=None)
        for operation, reply in (
            (OPERATIONS[1], job),
            (OPERATIONS[4], [record]),
            (
                OPERATIONS[7],
                {**RUN, "state": "FUTURE", "execution_id": "e", "future": None},
            ),
        ):
            self.reply = reply
            response = self.request_operation(operation)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), reply)
        self.reply = {
            **HEALTH["report"],
            "markdown": "<script>alert(1)</script>\n# Report",
        }
        response = self.request_operation(OPERATIONS[12])
        self.assertEqual(response.json(), self.reply)
        self.assertEqual(response.headers["content-type"], "application/json")

    def test_security_for_every_operation(self):
        for operation in OPERATIONS:
            if operation[0] == "POST":
                for headers in (
                    {},
                    {"Origin": ORIGIN},
                    {"X-CSRF-Token": self.headers["X-CSRF-Token"]},
                    {**self.headers, "Origin": "https://evil.test"},
                    {**self.headers, "X-CSRF-Token": "bad"},
                ):
                    self.assertEqual(
                        self.request_operation(operation, headers).status_code, 403
                    )
        self.client.cookies.clear()
        for operation in OPERATIONS:
            self.assertEqual(self.request_operation(operation).status_code, 401)
        self.assertEqual(self.calls, [])

    def test_errors_uncertainty_and_no_retries_or_redirects(self):
        for operation in OPERATIONS:
            for error, status, code in (
                (httpx.ReadTimeout, 504, "core_timeout"),
                (httpx.ConnectTimeout, 504, "core_timeout"),
                (httpx.ConnectError, 503, "core_unavailable"),
                (httpx.WriteError, 502, "core_transport_error"),
                (httpx.RemoteProtocolError, 502, "core_transport_error"),
            ):
                self.error = error
                before = len(self.calls)
                response = self.request_operation(operation)
                self.assertEqual(response.status_code, status)
                detail = response.json()["detail"]
                self.assertEqual(detail["code"], code)
                self.assertEqual(
                    "confirmar" in detail["message"],
                    operation[0] == "POST" and status != 503,
                )
                self.assertEqual(len(self.calls), before + 1)
            self.error = None
            for status in (302, 307, 500):
                self.http_status = status
                before = len(self.calls)
                response = self.request_operation(operation)
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["detail"]["code"], "core_http_error")
                self.assertEqual(len(self.calls), before + 1)
            self.http_status = 200
            self.envelope = {
                "status": "ERROR",
                "data": None,
                "error": "not found or invalid state",
            }
            response = self.request_operation(operation)
            self.assertEqual(response.status_code, 502)
            self.assertEqual(
                response.json()["detail"],
                {"code": "core_error", "message": "not found or invalid state"},
            )
            self.envelope = None

    def test_incompatible_responses_and_envelopes(self):
        for operation in OPERATIONS:
            self.reply = None
            response = self.request_operation(operation)
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["detail"]["code"], "core_invalid_response")
            self.assertEqual(
                "confirmar" in response.json()["detail"]["message"],
                operation[0] == "POST",
            )
            self.reply = operation[4]
            for envelope in (
                {"id": "wrong"},
                {"status": "QUEUED"},
                {"status": "ERROR"},
                {"error": "unexpected"},
            ):
                self.envelope = envelope
                self.assertEqual(self.request_operation(operation).status_code, 502)
            self.envelope = None
        for data in (
            {},
            {**JOB, "sources": [1]},
            {**JOB, "targets": [{"path": "p", "required": 1}]},
        ):
            self.reply = data
            self.assertEqual(self.post("/config/create", MINIMAL).status_code, 502)
        for data in (
            {**HEALTH["closed"], "diagnosis": {}},
            {
                **HEALTH["closed"],
                "artifact": {**HEALTH["closed"]["artifact"], "size": -1},
            },
            {**HEALTH["created"], "started_at": 1},
        ):
            self.reply = data
            self.assertEqual(self.request_operation(OPERATIONS[5]).status_code, 502)
        for raw in (
            b"invalid",
            b"[]",
            b"null",
            b"{}",
            b'{"id":"REQUEST_ID","status":"OK","data":{"backups":[],"future":NaN}}',
        ):
            self.raw = raw
            self.assertEqual(self.client.get("/api/backup/config").status_code, 502)

    def test_protected_docs_and_schema(self):
        paths = (
            "/api/openapi.json",
            "/api/docs",
            "/api/docs-assets/swagger-ui-bundle.js",
            "/api/docs-assets/swagger-ui.css",
            "/api/docs-assets/favicon-32x32.png",
        )
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 200)
        schema = self.client.get(paths[0]).json()
        for operation in OPERATIONS:
            route = schema["paths"]["/api/backup" + operation[1]][operation[0].lower()]
            self.assertIn("200", route["responses"])
        self.client.cookies.clear()
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.calls, [])
