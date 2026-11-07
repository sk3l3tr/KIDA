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

The wizard always installs CORE and asks separately about CLI and Console
(both optional, default: no). Installation order is CORE → CLI → Console;
omitting a component does not remove an earlier installation.

It verifies checksums for the selected binaries, installs CORE and optionally
`kida` in `/usr/local/bin`, and enables and restarts `kida.service` as root.
It shows progress by stage and checks service status before reporting success.
Docker, Compose and `rtcwake` are not installed.

Selecting Console first checks Docker and Compose (with `up --wait-timeout`
support) and downloads
`git.atlantis.arpa/sk3l3t0r/kida-console:RELEASE_VERSION`. If this fails, no
components are installed. The release must include a published image; older
releases may not have one. `KIDA_TOKEN` also authenticates image downloads,
without retaining that registry login.

The registry uses HTTP: both the target Docker daemon and the release runner
must allow `git.atlantis.arpa` as an insecure registry. The installer does not
change Docker configuration. HTTP transmits credentials without encryption;
use it only on a trusted network.

For a new Console installation, enter its public HTTP or HTTPS origin and an
initial admin password of 12–128 characters (hidden, with confirmation).
Direct HTTP can use `http://HOST_IP:8000`; HTTPS requires an external TLS proxy,
which this script does not configure. Cookie security follows the selected
protocol. Configuration is saved to `/opt/kida-console/.env` with mode `0600`,
alongside the deployment Compose file. Reinstallation preserves this file and
the accounts/sessions volume. The Compose project is named `kida-console` and
uses host networking. The script waits up to 120 seconds for Console health.

Failures identify completed components; there is no automatic rollback. Run
the downloaded script with interactive input available, rather than piping it
to Bash.

## 3. Check

```bash
systemctl --no-pager --full status kida
kida system info
```

Run `kida system info` only if CLI was selected. For Console:

```bash
sudo docker compose --project-name kida-console -f /opt/kida-console/compose.yaml ps
```

Check the selected components even if the installer reports success.
Continue with [getting started](002-usage-overview.md) or [troubleshooting](troubleshooting.md).
Before editing settings, see [configuration](configuration.md).
