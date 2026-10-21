# Integrations

[Castellano](../es/007-integrations.md) · [Documentation index](000-index.md)

Use the [direct API](api/README.md) for scripts and external tools that need JSON responses.
HTTP and Unix socket accept the same command envelopes; their framing differs.

- HTTP: `POST http://127.0.0.1:8989/command` with `Content-Type: application/json`.
- Unix socket: `/tmp/kida.sock`, one JSON request and response per line.

These are defaults; see [configuration](configuration.md). The current HTTP server has no built-in
authentication or TLS. Keep it within a trusted access boundary; do not assume an authorization header is enforced.
The CLI uses the local Unix socket and is a human-facing client, not an HTTP client or a JSON-output mode.

For each command, inspect protocol status and its result. Queue acceptance is not completion,
and a successful Health response can contain an unhealthy diagnosis or incomplete cleanup.
Do not automatically retry mutating requests after a lost response: a request ID is not an idempotency key.
CONSOLE is a planned web interface, not an available integration endpoint.
