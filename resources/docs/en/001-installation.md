# Installing KIDA

[Castellano](../es/001-installation.md) · [Documentation index](000-index.md)

## Requirements

Use Linux with systemd, administrator access, `bash`, `curl`, `sha256sum` and `install`.
The published binaries must match your machine's platform. Docker is required for Docker operations;
Backup Health also needs the Docker Compose plugin. RTC wake needs compatible hardware,
`rtcwake`, and permission for CORE to program the alarm and request shutdown.

The current [installer](../../scripts/install.sh) uses the private Forgejo at
`http://git.atlantis.arpa`, owner `sk3l3t0r`, package `kida`. You need network access
and, when required, credentials. This is not a public download service.
`KIDA_VERSION` selects an existing package version; `KIDA_TOKEN` is optional for downloads
that allow anonymous access. Server, owner and package are fixed in the script, not environment overrides.

## 1. Download and inspect the installer

Replace the credential placeholders with credentials authorized for that Forgejo.
For an anonymously readable repository, omit `--user`.

```bash
curl -fsSL \
  --user 'YOUR_USER:YOUR_TOKEN' \
  http://git.atlantis.arpa/sk3l3t0r/kida/raw/branch/master/resources/scripts/install.sh \
  -o /tmp/kida-install.sh
```

Read `/tmp/kida-install.sh` before executing it.

## 2. Install a published version

Replace `RELEASE_VERSION` with the exact published version. The script requires root.

```bash
sudo env \
  KIDA_VERSION='RELEASE_VERSION' \
  KIDA_TOKEN='YOUR_TOKEN' \
  bash /tmp/kida-install.sh
```

The installer downloads `kida-core`, `kida-cli` and `SHA256SUMS`, verifies checksums,
installs `/usr/local/bin/kida-core` and `/usr/local/bin/kida`, writes `kida.service`,
then enables and starts the service. It installs CORE and CLI; it does not install CONSOLE
or the Docker/RTC prerequisites. The service runs as root with the current unit.

## 3. Verify the installation

```bash
systemctl --no-pager --full status kida
journalctl -u kida -n 50 --no-pager
kida --help
kida system info
```

The installer prints service status but can still print success when that status check fails.
Verify the service and a read-only command yourself. If the CLI reports permission denied,
check socket permissions and your account; an administrator can run the check with `sudo`.
CORE needs permission for its configured paths and operations.

See [configuration](configuration.md) before changing endpoints. The CLI currently connects
only to `/tmp/kida.sock`. Configuration changes require a CORE restart.
