import unittest
from dataclasses import replace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from config import Settings
from main import create_app
from core_api_test_support import ORIGIN, CoreApiTestCase

INFO = {
    "hostname": None,
    "os": {"name": None, "version": "unknown", "long_version": None},
    "kernel": {"version": None, "long_version": None},
    "architecture": "future-arch",
    "hardware": {"model": None, "vendor": None},
    "cpu": {"brand": None, "vendor": None, "logical_cores": 4, "physical_cores": None},
    "memory": {"total_bytes": 2**64 - 1, "available_bytes": 123, "used_bytes": 456},
    "graphics": ["GPU"],
    "disks": [
        {
            "name": "disk",
            "mount_point": "/",
            "file_system": "ext4",
            "total_bytes": 100,
            "available_bytes": 50,
            "removable": False,
        }
    ],
    "future": {"unknown": None},
}
HEALTH = {
    "overall": "FUTURE",
    "sensors": [
        {
            "type": "temperature",
            "device": "dev",
            "label": "cpu",
            "value": 42.5,
            "unit": "C",
            "max": None,
            "critical": 90.0,
            "alarm": False,
            "status": "FUTURE",
        },
        {
            "type": "fan",
            "device": "dev",
            "label": "fan",
            "value": 1200,
            "unit": "RPM",
            "fault": False,
            "alarm": False,
            "status": "OK",
        },
    ],
}
WAKE = {
    "rtc_device": None,
    "rtcwake_available": None,
    "rtc_alarm_available": False,
    "s5_wake_status": "future",
    "warnings": ["Unverified"],
}
CYCLE = {
    "wake_at": "2026-10-25T06:00:00+01:00",
    "shutdown_scheduled": True,
    "s5_wake_status": "unverified",
}


class SystemTests(CoreApiTestCase):
    def post(self, path, body):
        return self.client.post("/api/system/" + path, json=body, headers=self.headers)

    def test_all_operations_and_exact_payloads(self):
        cases = [
            ("info", None, INFO, "system.info"),
            ("health", None, HEALTH, "system.health"),
            ("wake-capabilities", None, WAKE, "system.wake_capabilities"),
            (
                "shutdown",
                {"when": "now"},
                {"scheduled": True, "when": "now"},
                "system.shutdown",
            ),
            (
                "reboot",
                {"when": "+0"},
                {"scheduled": True, "when": "+0"},
                "system.reboot",
            ),
            (
                "shutdown",
                {"when": "23:59"},
                {"scheduled": True, "when": "23:59"},
                "system.shutdown",
            ),
            (
                "power-cycle",
                {"wake_time": "06:00", "shutdown_time": "23:00"},
                {**CYCLE, "shutdown_at": "2026-10-24T23:00:00+02:00"},
                "system.power_cycle",
            ),
            ("health", None, {"overall": "OK", "sensors": []}, "system.health"),
            ("power-cycle", {"wake_after_seconds": 120}, CYCLE, "system.power_cycle"),
            (
                "power-cycle",
                {"wake_after_seconds": 2**64 - 1},
                CYCLE,
                "system.power_cycle",
            ),
        ]
        for path, body, data, command in cases:
            with self.subTest(path=path, body=body):
                self.reply = data
                response = (
                    self.post(path, body)
                    if body is not None
                    else self.client.get("/api/system/" + path)
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), data)
                self.assertEqual(self.calls[-1]["command"], command)
                self.assertEqual(self.calls[-1]["params"], body or {})
        self.assertEqual(len({c["id"] for c in self.calls}), len(cases))

    def test_invalid_inputs_never_contact_core(self):
        for path in ("shutdown", "reboot"):
            for body in (
                {},
                {"when": None},
                {"when": True},
                {"when": 1},
                {"when": ""},
                {"when": "24:00"},
                {"when": "+1.5"},
                {"when": "now\n"},
                {"when": "now", "extra": 1},
            ):
                with self.subTest(path=path, body=body):
                    self.assertEqual(self.post(path, body).status_code, 422)
        invalid = [
            {},
            {"wake_time": "06:00", "wake_after_seconds": 120},
            {"wake_time": "6:00"},
            {"wake_time": "24:00"},
            {"wake_time": "12:60"},
            {"wake_time": "06:00", "shutdown_time": "23:00:00"},
            {"wake_time": "06:00", "extra": 1},
        ]
        for value in (None, True, "120", 120.0, 119, -1, 2**64):
            invalid.append({"wake_after_seconds": value})
        for key in ("wake_time", "wake_after_seconds", "shutdown_time"):
            invalid.append({"wake_time": "06:00", key: None})
        for body in invalid + [[], None, "text"]:
            with self.subTest(body=body):
                self.assertEqual(self.post("power-cycle", body).status_code, 422)
        self.assertEqual(self.calls, [])

    def test_session_origin_and_csrf(self):
        for path in ("shutdown", "reboot", "power-cycle"):
            for headers in (
                {},
                {**self.headers, "Origin": "https://evil.test"},
                {**self.headers, "X-CSRF-Token": "bad"},
            ):
                self.assertEqual(
                    self.client.post(
                        "/api/system/" + path, json={}, headers=headers
                    ).status_code,
                    403,
                )
        self.client.cookies.clear()
        for path in ("info", "health", "wake-capabilities"):
            self.assertEqual(self.client.get("/api/system/" + path).status_code, 401)
        for path in ("shutdown", "reboot", "power-cycle"):
            self.assertEqual(self.post(path, {}).status_code, 401)
        self.assertEqual(self.calls, [])

    def test_transport_errors_no_retries(self):
        for error, status, code in (
            (httpx.ConnectError, 503, "core_unavailable"),
            (httpx.ReadTimeout, 504, "core_timeout"),
            (httpx.ConnectTimeout, 504, "core_timeout"),
            (httpx.WriteError, 502, "core_transport_error"),
            (httpx.RemoteProtocolError, 502, "core_transport_error"),
        ):
            with self.subTest(error=error):
                self.error = error
                count = len(self.calls)
                response = self.post("shutdown", {"when": "now"})
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["detail"]["code"], code)
                if status != 503:
                    self.assertIn("confirmar", response.json()["detail"]["message"])
                self.assertEqual(len(self.calls), count + 1)

    def test_bad_http_json_envelopes_and_data(self):
        for status in (301, 307, 400, 500):
            self.http_status = status
            count = len(self.calls)
            self.assertEqual(
                self.client.get("/api/system/health").json()["detail"]["code"],
                "core_http_error",
            )
            self.assertEqual(len(self.calls), count + 1)
        self.http_status = 200
        for raw in (b"invalid", b"[]", b"null", b"{}"):
            self.raw = raw
            self.assertEqual(self.client.get("/api/system/health").status_code, 502)
        self.raw = None
        for envelope in (
            {"id": "wrong"},
            {"status": "QUEUED"},
            {"status": "ERROR"},
            {"status": "ERROR", "error": 42, "data": None},
            {"status": "OK", "error": "contradiction"},
            {"data": None},
            {"data": {}},
            {"data": {"overall": 1, "sensors": []}},
            {"data": {"overall": "OK", "sensors": [{}]}},
        ):
            self.envelope = envelope
            response = self.client.get("/api/system/health")
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["detail"]["code"], "core_invalid_response")
        self.envelope = {
            "status": "ERROR",
            "error": "RTC unavailable: reason from agent",
            "data": None,
        }
        response = self.post("power-cycle", {"wake_after_seconds": 120})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json(),
            {
                "detail": {
                    "code": "core_error",
                    "message": "RTC unavailable: reason from agent",
                }
            },
        )

    def test_docs_and_local_resources_require_session(self):
        paths = [
            "/api/openapi.json",
            "/api/docs",
            "/api/docs-assets/swagger-ui-bundle.js",
            "/api/docs-assets/swagger-ui.css",
            "/api/docs-assets/favicon-32x32.png",
        ]
        for path in paths:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn(
            "/api/system/power-cycle", self.client.get(paths[0]).json()["paths"]
        )
        docs = self.client.get(paths[1]).text
        self.assertNotIn("cdn.jsdelivr", docs)
        self.assertNotIn("https://", docs)
        self.client.cookies.clear()
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.get("/api/health").json(), {"status": "OK"})
        self.assertEqual(self.calls, [])

    def test_non_finite_core_json_is_rejected(self):
        for number in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(number=number):
                self.raw = (
                    '{"id":"REQUEST_ID","status":"OK","data":'
                    '{"overall":"OK","sensors":[],"future":{"nested":['
                    + number
                    + "]}}}"
                ).encode()
                response = self.client.get("/api/system/health")
                self.assertEqual(response.status_code, 502)
                self.assertEqual(
                    response.json()["detail"]["code"], "core_invalid_response"
                )

    def test_shared_client_lifecycle(self):
        http = self.app.state.core_client.http
        self.assertEqual(str(http.base_url), "http://127.0.0.1:8989/")
        self.assertEqual(http.timeout.read, 10)
        self.assertFalse(http.follow_redirects)
        with TestClient(
            create_app(
                replace(
                    self.settings,
                    core_url="https://core.test/base",
                    core_timeout_seconds=2,
                )
            )
        ) as client:
            other = client.app.state.core_client.http
            self.assertEqual(str(other.base_url), "https://core.test/base/")
            self.assertEqual(other.timeout.read, 2)
            self.assertFalse(other.is_closed)
        self.assertTrue(other.is_closed)


class CoreSettingsTests(unittest.TestCase):
    def test_invalid_settings(self):
        base = Settings(":memory:", None, True, (ORIGIN,))
        for url in (
            "",
            "ftp://core",
            "http://",
            "http://core:bad",
            "http://core:0",
            "http://user:pass@core",
            "http://core?q=1",
            "http://core/#fragment",
            "http://co re",
        ):
            with self.subTest(url=url), self.assertRaises(RuntimeError):
                replace(base, core_url=url)
        for timeout in (0, -1, float("nan"), float("inf")):
            with self.subTest(timeout=timeout), self.assertRaises(RuntimeError):
                replace(base, core_timeout_seconds=timeout)
        with (
            patch.dict("os.environ", {"KIDA_CORE_TIMEOUT_SECONDS": "not-a-number"}),
            self.assertRaisesRegex(RuntimeError, "KIDA_CORE_TIMEOUT_SECONDS"),
        ):
            Settings.from_env()
