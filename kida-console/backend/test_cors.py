import unittest

from main import app


class CorsTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, origin, method="GET", extra_headers=()):
        messages = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            messages.append(message)

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": "/api/health",
                "root_path": "",
                "query_string": b"",
                "headers": [(b"origin", origin.encode()), *extra_headers],
                "server": ("127.0.0.1", 8000),
                "client": ("127.0.0.1", 12345),
            },
            receive,
            send,
        )
        response = messages[0]
        return response["status"], dict(response["headers"])

    async def test_allows_angular_development_origins(self):
        for origin in ("http://localhost:4200", "http://127.0.0.1:4200"):
            with self.subTest(origin=origin):
                status, headers = await self.request(origin)
                self.assertEqual(status, 200)
                self.assertEqual(headers[b"access-control-allow-origin"], origin.encode())

    async def test_does_not_allow_other_origins(self):
        status, headers = await self.request("http://example.com")
        self.assertEqual(status, 200)
        self.assertNotIn(b"access-control-allow-origin", headers)

    async def test_allows_preflight_for_angular(self):
        status, headers = await self.request(
            "http://localhost:4200",
            method="OPTIONS",
            extra_headers=[
                (b"access-control-request-method", b"POST"),
                (b"access-control-request-headers", b"content-type"),
            ],
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers[b"access-control-allow-origin"], b"http://localhost:4200")
        self.assertIn(b"POST", headers[b"access-control-allow-methods"])
        self.assertEqual(headers[b"access-control-allow-headers"], b"content-type")
