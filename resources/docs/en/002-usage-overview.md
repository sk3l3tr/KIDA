# Usage overview

[Castellano](../es/002-usage-overview.md) · [Documentation index](000-index.md)

CORE is the server agent that executes operations and owns server-side configuration and state.
There are three ways to interact with it; HTTP and Unix socket are two transports of the same direct API.

| Interface | Status | How to use it |
| --- | --- | --- |
| [CONSOLE](console/README.md) | Not implemented yet | Planned web interface |
| [CLI](cli/README.md) | Available | Run `kida` on the CORE machine through `/tmp/kida.sock` |
| [Direct API](api/README.md) | Available | Send JSON to HTTP `POST /command` or the Unix socket |

CLI commands use spaces (`kida system info`). API command identifiers use dots (`system.info`).
The CLI has no HTTP endpoint selector or remote connection flag. Direct API clients receive JSON;
the CLI normally renders human-readable results and has no `--json` option.

Start with a read-only system information query in your chosen interface. Install CORE first and
check its service status. Administrative operations execute with CORE's privileges on the server,
not with the permissions of a file or path supplied by the client.

## Where files are read

- CLI backup configuration and scheduler TOML files are read locally by the CLI; parsed values are sent to CORE.
- Backup source and target paths are retained literally and interpreted by CORE when executing.
- Backup Health definition paths are sent unchanged to CORE. CORE reads the definition and resolves its Compose file relative to it.

See [installation](001-installation.md), [configuration](configuration.md) and the guides for your interface.
