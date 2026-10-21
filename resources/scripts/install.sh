#!/usr/bin/env bash
set -euo pipefail

FORGEJO="http://git.atlantis.arpa"
OWNER="sk3l3t0r"
PACKAGE="kida"

VERSION="${KIDA_VERSION:-}"
TOKEN="${KIDA_TOKEN:-}"

if [[ $EUID -ne 0 ]]; then
    echo "Run this installer as root."
    exit 1
fi

if [[ -z "$VERSION" ]]; then
    echo "KIDA_VERSION is required."
    exit 1
fi

BASE_URL="${FORGEJO}/api/packages/${OWNER}/generic/${PACKAGE}/${VERSION}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

AUTH=()
if [[ -n "$TOKEN" ]]; then
    AUTH=(-u "${OWNER}:${TOKEN}")
fi

echo "Installing KIDA ${VERSION}..."

for FILE in kida-core kida-cli SHA256SUMS; do
    curl -fsSL \
        "${AUTH[@]}" \
        "${BASE_URL}/${FILE}" \
        -o "${TMP}/${FILE}"
done

cd "$TMP"
sha256sum -c SHA256SUMS

install -m 755 kida-core /usr/local/bin/kida-core
install -m 755 kida-cli /usr/local/bin/kida

cat > /etc/systemd/system/kida.service <<'EOF'
[Unit]
Description=KIDA Agent
After=network.target docker.service
Wants=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/kida-core

Restart=on-failure
RestartSec=3

RuntimeDirectory=kida
RuntimeDirectoryMode=0755

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now kida

sleep 1

echo
systemctl --no-pager --full status kida || true

echo
echo "KIDA installed successfully."
echo "CLI:   /usr/local/bin/kida"
echo "Agent: /usr/local/bin/kida-core"