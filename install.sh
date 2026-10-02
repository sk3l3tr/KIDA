#!/usr/bin/env bash

set -euo pipefail

FORGEJO="http://git.atlantis.arpa"
OWNER="TU_USUARIO"
REPO="kida"

ARCH="$(uname -m)"

if [ "$ARCH" != "x86_64" ]; then
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

VERSION="${KIDA_VERSION:-latest}"

if [ "$VERSION" = "latest" ]; then
    VERSION="$(
        curl -fsSL \
            "$FORGEJO/api/v1/repos/$OWNER/$REPO/releases/latest" |
        sed -n 's/.*"tag_name":"\([^"]*\)".*/\1/p'
    )"
fi

if [ -z "$VERSION" ]; then
    echo "Unable to determine latest KIDA version."
    exit 1
fi

echo "Installing KIDA $VERSION..."

BASE="$FORGEJO/$OWNER/$REPO/releases/download/$VERSION"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$BASE/kida-core-linux-x86_64" \
    -o "$TMP/kida-core"

curl -fsSL "$BASE/kida-cli-linux-x86_64" \
    -o "$TMP/kida"

chmod +x "$TMP/kida-core" "$TMP/kida"

install -m 755 "$TMP/kida-core" /usr/local/bin/kida-core
install -m 755 "$TMP/kida" /usr/local/bin/kida

echo "KIDA installed successfully."