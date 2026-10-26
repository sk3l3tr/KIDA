import httpx

from core_api_test_support import ORIGIN, CoreApiTestCase

CONTAINER = {
    "id": "abc123",
    "name": "web",
    "image": "web:latest",
    "online": True,
    "status": "future-state",
    "health": None,
    "started_at": "unparsed-date",
    "finished_at": None,
    "exit_code": None,
    "restart_count": 2**64 - 1,
    "restart_policy": None,
    "ports": [
        {
            "container_port": 80,
            "protocol": "tcp",
            "host_ip": None,
            "host_port": "8080",
            "future": True,
        },
        {
            "container_port": None,
            "protocol": "future",
            "host_ip": "::",
            "host_port": None,
        },
    ],
    "networks": [
        {
            "name": "default",
            "ip_address": None,
            "gateway": None,
            "mac_address": None,
            "future": [],
        }
    ],
    "future": {"nested": None},
}
PROJECT = {
    "name": "demo",
    "services": [{"name": None, "containers": [CONTAINER], "future": True}],
    "future": None,
}
READS = (
    "containers",
    "compose/version",
    "compose/projects",
    "compose/projects/inspect?project=demo",
)
ACTIONS = ("start", "stop", "restart", "delete")


class DockerTests(CoreApiTestCase):
    def get(self, path):
        return self.client.get("/api/docker/" + path)

    def post(self, action, body):
        return self.client.post(
            "/api/docker/containers/" + action, json=body, headers=self.headers
        )

    def test_all_operations_and_exact_payloads(self):
        cases = [
            (
                "containers",
                {"total": 1, "running": 1, "containers": [CONTAINER], "future": 1},
                "docker.containers.list",
                {},
            ),
            (
                "containers",
                {"total": 0, "running": 0, "containers": []},
                "docker.containers.list",
                {},
            ),
            (
                "compose/version",
                {"version": "future", "future": None},
                "docker.compose.version",
                {},
            ),
            ("compose/projects", [PROJECT], "docker.compose.projects.list", {}),
            ("compose/projects", [], "docker.compose.projects.list", {}),
            (
                "compose/projects/inspect?project=%20demo%20",
                PROJECT,
                "docker.compose.project.inspect",
                {"project": "demo"},
            ),
        ]
        for path, data, command, params in cases:
            with self.subTest(path=path, data=data):
                self.reply = data
                response = self.get(path)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), data)
                self.assertEqual(self.calls[-1]["command"], command)
                self.assertEqual(self.calls[-1]["params"], params)
        for action in ACTIONS:
            self.reply = {"container": "abc123", "status": "future", "extra": None}
            response = self.post(action, {"container": "  abc123  "})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json(), self.reply)
            self.assertEqual(self.calls[-1]["command"], "docker.container." + action)
            self.assertEqual(self.calls[-1]["params"], {"container": "abc123"})
        self.assertEqual(len({call["id"] for call in self.calls}), len(self.calls))

    def test_local_validation(self):
        invalid = [{}, None, [], "abc", {"container": "abc", "force": True}]
        invalid += [
            {"container": value}
            for value in (
                None,
                True,
                1,
                1.5,
                [],
                {},
                "",
                "  ",
                "-f",
                " --force ",
                "a\n",
                "a\t",
                "\x00a",
                "a\x7f",
                "a\x85",
            )
        ]
        for action in ACTIONS:
            for body in invalid:
                with self.subTest(action=action, body=body):
                    response = self.post(action, body)
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertIsInstance(response.json()["detail"], list)
                    self.assertTrue(
                        all("input" not in e for e in response.json()["detail"])
                    )
        for params in (
            {},
            {"project": ""},
            {"project": " "},
            {"project": "a\n"},
            {"project": "a\x7f"},
        ):
            self.assertEqual(
                self.client.get(
                    "/api/docker/compose/projects/inspect", params=params
                ).status_code,
                422,
            )
        self.assertEqual(self.calls, [])

    def test_unicode_surrogates_are_rejected_before_core(self):
        for action in ACTIONS:
            response = self.client.post(
                "/api/docker/containers/" + action,
                content=b'{"container":"\\ud800"}',
                headers={**self.headers, "Content-Type": "application/json"},
            )
            self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.calls, [])

    def test_rust_integer_ranges(self):
        for field, value in (
            ("restart_count", -1),
            ("restart_count", 2**64),
            ("exit_code", -(2**63) - 1),
            ("exit_code", 2**63),
        ):
            self.reply = {
                "total": 1,
                "running": 1,
                "containers": [{**CONTAINER, field: value}],
            }
            self.assertEqual(self.get("containers").status_code, 502)
        for value in (-1, 2**16):
            self.reply = {
                "total": 1,
                "running": 1,
                "containers": [
                    {
                        **CONTAINER,
                        "ports": [{**CONTAINER["ports"][0], "container_port": value}],
                    }
                ],
            }
            self.assertEqual(self.get("containers").status_code, 502)
        self.reply = {"total": -1, "running": 0, "containers": []}
        self.assertEqual(self.get("containers").status_code, 502)

    def test_session_origin_and_csrf(self):
        for action in ACTIONS:
            for headers in (
                {},
                {"Origin": ORIGIN},
                {**self.headers, "Origin": "https://evil.test"},
                {**self.headers, "X-CSRF-Token": "bad"},
                {"X-CSRF-Token": self.headers["X-CSRF-Token"]},
            ):
                self.assertEqual(
                    self.client.post(
                        "/api/docker/containers/" + action,
                        json={"container": "abc"},
                        headers=headers,
                    ).status_code,
                    403,
                )
        self.client.cookies.clear()
        for path in READS:
            self.assertEqual(self.get(path).status_code, 401)
        for action in ACTIONS:
            self.assertEqual(self.post(action, {"container": "abc"}).status_code, 401)
        self.assertEqual(self.calls, [])

    def test_incompatible_data(self):
        cases = [
            ("containers", {}),
            ("containers", {"total": True, "running": 0, "containers": []}),
            (
                "containers",
                {"total": 1, "running": 1, "containers": [{**CONTAINER, "online": 1}]},
            ),
            ("compose/version", {"version": None}),
            ("compose/projects", {}),
            ("compose/projects", [None]),
            ("compose/projects", [{**PROJECT, "services": [{"containers": []}]}]),
            (
                "compose/projects/inspect?project=demo",
                {"name": "demo", "services": None},
            ),
        ]
        for path, data in cases:
            with self.subTest(path=path, data=data):
                self.reply = data
                response = self.get(path)
                self.assertEqual(response.status_code, 502)
                self.assertEqual(
                    response.json()["detail"]["code"], "core_invalid_response"
                )
        for data in (
            {},
            {"container": "abc", "status": None},
            {"container": 1, "status": "deleted"},
        ):
            self.reply = data
            for action in ACTIONS:
                response = self.post(action, {"container": "abc"})
                self.assertEqual(response.status_code, 502)
                self.assertIn("confirmar", response.json()["detail"]["message"])

    def test_transport_and_agent_errors(self):
        for action in ACTIONS:
            for error, status, code in (
                (httpx.ConnectError, 503, "core_unavailable"),
                (httpx.ReadTimeout, 504, "core_timeout"),
                (httpx.ConnectTimeout, 504, "core_timeout"),
                (httpx.WriteError, 502, "core_transport_error"),
                (httpx.RemoteProtocolError, 502, "core_transport_error"),
            ):
                self.error = error
                before = len(self.calls)
                response = self.post(action, {"container": "abc"})
                self.assertEqual(response.status_code, status)
                self.assertEqual(response.json()["detail"]["code"], code)
                if status != 503:
                    self.assertIn("confirmar", response.json()["detail"]["message"])
                self.assertEqual(len(self.calls), before + 1)
        self.error = None
        self.envelope = {
            "status": "ERROR",
            "data": None,
            "error": "No such container: abc",
        }
        response = self.post("delete", {"container": "abc"})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json()["detail"],
            {"code": "core_error", "message": "No such container: abc"},
        )

    def test_http_and_envelope_errors(self):
        for status in (301, 307, 400, 500):
            self.http_status = status
            before = len(self.calls)
            response = self.post("start", {"container": "abc"})
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()["detail"]["code"], "core_http_error")
            self.assertEqual(len(self.calls), before + 1)
        self.http_status = 200
        for raw in (b"invalid", b"[]", b"null", b"{}"):
            self.raw = raw
            self.assertEqual(self.get("compose/projects").status_code, 502)
        self.raw = None
        for envelope in (
            {"id": "wrong"},
            {"status": "QUEUED"},
            {"status": "ERROR"},
            {"status": "OK", "error": "bad"},
        ):
            self.envelope = envelope
            self.assertEqual(self.get("compose/projects").status_code, 502)

    def test_protected_schema(self):
        paths = self.client.get("/api/openapi.json").json()["paths"]
        for path in READS:
            self.assertIn("/api/docker/" + path.split("?")[0], paths)
        for action in ACTIONS:
            self.assertIn("/api/docker/containers/" + action, paths)
        self.assertEqual(self.calls, [])
