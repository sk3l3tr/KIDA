# Install KIDA

[Castellano](../es/001-installation.md) · [Index](000-index.md)

## Requirements

Linux with systemd, administrator permissions, and `bash`, `curl`, `sha256sum` and `install`.
Check that the published binaries are compatible with your machine.
Containers require [Docker](003-docker-management.md); scheduled wake requires [compatible RTC and `rtcwake`](006-system-control.md#shutdown-with-rtc-wake).

The installer downloads from private Forgejo `http://git.atlantis.arpa`, owner `sk3l3t0r`, package `kida`.
You need access to that network and a published version; this is not a public download service.
Server, owner and package are fixed in the [script](../../scripts/install.sh).

## 1. Download and inspect

Replace credentials with authorized ones. Omit `--user` if anonymous reading is allowed:

```bash
curl -fsSL \
  --user 'YOUR_USER:YOUR_TOKEN' \
  http://git.atlantis.arpa/sk3l3t0r/kida/raw/branch/master/resources/scripts/install.sh \
  -o /tmp/kida-install.sh
```

Read `/tmp/kida-install.sh` before executing it.

## 2. Install

Replace `RELEASE_VERSION` with the exact published version. Omit `KIDA_TOKEN` for anonymous downloads:

```bash
sudo env \
  KIDA_VERSION='RELEASE_VERSION' \
  KIDA_TOKEN='YOUR_TOKEN' \
  bash /tmp/kida-install.sh
```

The installer verifies checksums, installs `kida-core` and `kida` in `/usr/local/bin` and enables and starts `kida.service`.
The service runs as root. Docker, the Compose plugin and `rtcwake` are not installed.

## 3. Check

```bash
systemctl --no-pager --full status kida
kida system info
```

Check both results even if the installer reports success.
Continue with [getting started](002-usage-overview.md) or [troubleshooting](troubleshooting.md).
Before editing settings, see [configuration](configuration.md).
