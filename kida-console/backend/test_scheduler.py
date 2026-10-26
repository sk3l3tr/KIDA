import json
from pathlib import Path

import httpx

from core_api_test_support import ORIGIN, CoreApiTestCase

FIXTURES = json.loads(
    (Path(__file__).resolve().parents[2] / "tests/fixtures/scheduler.json").read_text()
)
INPUT = FIXTURES["cases"][1]["input"]
RESULT = FIXTURES["cases"][1]["added"]["data"]


class SchedulerTests(CoreApiTestCase):
    def post(self, action, body):
        return self.client.post(
            "/api/scheduler/" + action, json=body, headers=self.headers
        )

    def assert_call(self, command, params):
        self.assertEqual(self.calls[-1]["command"], command)
        self.assertEqual(self.calls[-1]["params"], params)
        self.assertEqual(set(self.calls[-1]), {"id", "command", "params"})

    def test_fixture_contracts(self):
        for case in FIXTURES["cases"]:
            with self.subTest(case=case["name"]):
                self.reply = case["added"]["data"]
                response = self.post("add", case["input"])
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), self.reply)
                self.assert_call("scheduler.add", case["input"])
                self.reply = case["listed"]["data"]
                response = self.client.get("/api/scheduler")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), self.reply)
                self.assert_call("scheduler.list", {})
                self.reply = case["deleted"]["data"]
                body = {"id": self.reply["id"]}
                response = self.post("delete", body)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), self.reply)
                self.assert_call("scheduler.delete", body)
        self.assertEqual(len({call["id"] for call in self.calls}), len(self.calls))

    def test_list_filters_and_empty_array(self):
        self.reply = []
        for origin in (None, "USER", "INTERNAL", "ALL"):
            params = {} if origin is None else {"origin": origin}
            response = self.client.get("/api/scheduler", params=params)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), [])
            self.assert_call("scheduler.list", params)
        self.calls.clear()
        for origin in ("", "user", "ALL ", "UNKNOWN", "null"):
            self.assertEqual(
                self.client.get(
                    "/api/scheduler", params={"origin": origin}
                ).status_code,
                422,
            )
        self.assertEqual(self.calls, [])

    def test_json_params_are_preserved(self):
        self.reply = RESULT
        for params in (
            None,
            True,
            False,
            42,
            1.5,
            "text\n\t\x00",
            [],
            {},
            [None, True, {"text": "é😀", "n": 2**64 - 1}],
            {"nested": {"controls\n": [False, -1, 1.25]}},
        ):
            with self.subTest(params=params):
                body = {**INPUT, "params": params}
                self.reply = {**RESULT, "params": params}
                response = self.post("add", body)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), self.reply)
                self.assert_call("scheduler.add", body)

    def test_response_fields_and_open_origin_are_preserved(self):
        for case in FIXTURES["cases"]:
            result = {
                **case["added"]["data"],
                "origin": "FUTURE",
                "future": {"value": None},
                "schedule": {**case["added"]["data"]["schedule"], "future": [None]},
            }
            self.reply = result
            response = self.post("add", case["input"])
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), result)
            self.reply = [{**result, "next_enqueue_at": "unparsed-date"}]
            response = self.client.get("/api/scheduler")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), self.reply)

    def test_invalid_structures_never_contact_core(self):
        invalid = FIXTURES["invalid_inputs"] + [
            {**INPUT, "command": None},
            {**INPUT, "params": None, "origin": "USER"},
            {**INPUT, "schedule": {"type": "interval", "seconds": True}},
            {**INPUT, "schedule": {"type": "interval", "seconds": 60.0}},
            {**INPUT, "schedule": {"type": "interval", "seconds": 2**64}},
            {**INPUT, "schedule": {"type": "once", "at": None}},
            {**INPUT, "schedule": {"type": "once", "at": "date", "timezone": "UTC"}},
        ]
        for body in invalid:
            with self.subTest(body=body):
                response = self.post("add", body)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertTrue(
                    all("input" not in error for error in response.json()["detail"])
                )
        for body in (
            {},
            None,
            [],
            "id",
            {"id": None},
            {"id": True},
            {"id": 42},
            {"id": "id", "origin": "INTERNAL"},
        ):
            self.assertEqual(self.post("delete", body).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_invalid_json_values_never_contact_core(self):
        for body in (
            {**INPUT, "command": "\ud800"},
            {**INPUT, "params": {"nested": ["\udfff"]}},
            {**INPUT, "params": {"\ud800": "key"}},
            {**INPUT, "\ud800": "extra key"},
            {**INPUT, "params": {"nested": [float("nan")]}},
            {**INPUT, "params": float("inf")},
            {**INPUT, "params": -float("inf")},
            {**INPUT, "schedule": {"type": "\ud800"}},
        ):
            with self.subTest(body=body):
                response = self.client.post(
                    "/api/scheduler/add",
                    content=json.dumps(body),
                    headers={**self.headers, "Content-Type": "application/json"},
                )
                self.assertEqual(response.status_code, 422, response.text)
        response = self.client.post(
            "/api/scheduler/delete",
            content=b'{"id":"\\ud800"}',
            headers={**self.headers, "Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 422, response.text)
        raw = json.dumps({**INPUT, "params": "NUMBER"}).replace('"NUMBER"', "1e999")
        self.assertEqual(
            self.client.post(
                "/api/scheduler/add",
                content=raw,
                headers={**self.headers, "Content-Type": "application/json"},
            ).status_code,
            422,
        )
        self.assertEqual(self.calls, [])

    def test_domain_validation_is_delegated(self):
        self.envelope = {"status": "ERROR", "data": None, "error": "domain reason"}
        for body in FIXTURES["semantic_inputs"] + [
            {**INPUT, "command": "unknown.command"},
            {**INPUT, "command": "backup.health.expire"},
            {**INPUT, "command": "  system.info  "},
            {
                **INPUT,
                "schedule": {
                    "type": "cron",
                    "expression": "* * * * *",
                    "timezone": "invalid",
                },
            },
            {**INPUT, "schedule": {"type": "interval", "seconds": 2**64 - 1}},
        ]:
            response = self.post("add", body)
            self.assertEqual(response.status_code, 502, response.text)
            self.assertEqual(
                response.json()["detail"],
                {"code": "core_error", "message": "domain reason"},
            )
            self.assert_call("scheduler.add", body)
        for identifier in ("", "not-a-uuid", "  UUID  "):
            response = self.post("delete", {"id": identifier})
            self.assertEqual(response.status_code, 502)
            self.assert_call("scheduler.delete", {"id": identifier})
        self.envelope["error"] = "schedule not found: id"
        self.assertEqual(self.post("delete", {"id": "id"}).status_code, 502)
        self.envelope["error"] = "schedule id: operation requires User origin"
        self.assertEqual(self.post("delete", {"id": "id"}).status_code, 502)

    def test_session_origin_and_csrf(self):
        for action, body in (("add", INPUT), ("delete", {"id": "id"})):
            for headers in (
                {},
                {"Origin": ORIGIN},
                {**self.headers, "Origin": "https://evil.test"},
                {**self.headers, "X-CSRF-Token": "bad"},
                {"X-CSRF-Token": self.headers["X-CSRF-Token"]},
            ):
                self.assertEqual(
                    self.client.post(
                        "/api/scheduler/" + action, json=body, headers=headers
                    ).status_code,
                    403,
                )
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/scheduler").status_code, 401)
        self.assertEqual(self.post("add", INPUT).status_code, 401)
        self.assertEqual(self.post("delete", {"id": "id"}).status_code, 401)
        self.assertEqual(self.calls, [])

    def test_transport_errors_and_no_retries(self):
        for action, body in (("add", INPUT), ("delete", {"id": "id"})):
            for error, status, code in (
                (httpx.ConnectError, 503, "core_unavailable"),
                (httpx.ReadTimeout, 504, "core_timeout"),
                (httpx.ConnectTimeout, 504, "core_timeout"),
                (httpx.WriteError, 502, "core_transport_error"),
                (httpx.RemoteProtocolError, 502, "core_transport_error"),
            ):
                self.error = error
                before = len(self.calls)
                response = self.post(action, body)
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["detail"]["code"], code)
                if status != 503:
                    self.assertIn("confirmar", response.json()["detail"]["message"])
                self.assertEqual(len(self.calls), before + 1)

    def test_invalid_core_responses(self):
        for status in (301, 307, 400, 500):
            self.http_status = status
            before = len(self.calls)
            response = self.post("add", INPUT)
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["detail"]["code"], "core_http_error")
            self.assertIn("confirmar", response.json()["detail"]["message"])
            self.assertEqual(len(self.calls), before + 1)
        self.http_status = 200
        for raw in (b"invalid", b"[]", b"null", b"{}"):
            self.raw = raw
            self.assertEqual(self.client.get("/api/scheduler").status_code, 502)
        self.raw = None
        for envelope in (
            {"id": "wrong"},
            {"status": "QUEUED"},
            {"status": "ERROR"},
            {"status": "OK", "error": "bad"},
        ):
            self.envelope = envelope
            self.assertEqual(self.client.get("/api/scheduler").status_code, 502)
        self.envelope = None
        for data in (None, {}, [RESULT], [{**RESULT, "next_enqueue_at": None}]):
            self.reply = data
            response = self.client.get("/api/scheduler")
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["detail"]["code"], "core_invalid_response")
        for data in (
            {},
            {**RESULT, "params": None, "origin": None},
            {**RESULT, "schedule": {"type": "interval", "seconds": True}},
            {**RESULT, "schedule": {"type": "cron", "expression": "* * * * *"}},
        ):
            self.reply = data
            for action, body in (("add", INPUT), ("delete", {"id": "id"})):
                response = self.post(action, body)
                self.assertEqual(response.status_code, 502)
                self.assertEqual(
                    response.json()["detail"]["code"], "core_invalid_response"
                )
                self.assertIn("confirmar", response.json()["detail"]["message"])

    def test_protected_docs_and_schema(self):
        paths = (
            "/api/openapi.json",
            "/api/docs",
            "/api/docs-assets/swagger-ui-bundle.js",
            "/api/docs-assets/swagger-ui.css",
            "/api/docs-assets/favicon-32x32.png",
        )
        for path in paths:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.headers["cache-control"], "no-store")
        schema = self.client.get(paths[0]).json()
        for path in ("/api/scheduler", "/api/scheduler/add", "/api/scheduler/delete"):
            self.assertIn(path, schema["paths"])
        self.assertEqual(schema["components"]["schemas"]["Schedules"]["type"], "array")
        self.client.cookies.clear()
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.calls, [])
