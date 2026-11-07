#!/usr/bin/env bash
set -Eeuo pipefail

FORGEJO="http://git.atlantis.arpa"
OWNER="sk3l3t0r"
PACKAGE="kida"
REGISTRY="git.atlantis.arpa"
CONSOLE_DIR="/opt/kida-console"
VERSION="${KIDA_VERSION:-}"
TOKEN="${KIDA_TOKEN:-}"
STAGE="preflight"
COMPLETED="none"

fail() {
    echo "Error during $STAGE: $*. Completed: $COMPLETED." >&2
    exit 1
}

ask() {
    local answer
    while true; do
        read -r -p "$1 [y/N]: " answer || fail "Input closed; installation cancelled."
        case "$answer" in
            y|Y|yes|YES|s|S|si|SI) return 0 ;;
            n|N|no|NO|'') return 1 ;;
            *) echo "Please answer yes or no." ;;
        esac
    done
}

configure_console() {
    if [[ -f "$CONSOLE_DIR/.env" ]]; then
        echo "Keeping existing Console configuration."
        return
    fi
    local origin password confirmation escaped
    while true; do
        read -r -p "Console public origin (http://host:8000 or https://host): " origin || fail "Input closed."
        origin="${origin%/}"
        if [[ "$origin" =~ ^https?://(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:([0-9]{1,5}))?$ ]]; then
            if [[ -z "${BASH_REMATCH[4]}" ]] || (( 10#${BASH_REMATCH[4]} >= 1 && 10#${BASH_REMATCH[4]} <= 65535 )); then
                break
            fi
        fi
        echo "Enter an HTTP(S) origin without credentials, path, query or fragment."
    done
    while true; do
        read -r -s -p "Initial admin password (12–128 characters): " password || fail "Input closed."
        echo
        read -r -s -p "Confirm password: " confirmation || fail "Input closed."
        echo
        if [[ ${#password} -ge 12 && ${#password} -le 128 && "$password" == "$confirmation" ]]; then
            break
        fi
        echo "Passwords must match and contain 12–128 characters."
    done
    # Escape dotenv syntax and Compose interpolation without evaluating the password.
    escaped="${password//\\/\\\\}"
    escaped="${escaped//\"/\\\"}"
    escaped="${escaped//\$/\$\$}"
    {
        printf 'KIDA_ADMIN_PASSWORD="%s"\n' "$escaped"
        printf 'KIDA_ALLOWED_ORIGINS=%s\n' "$origin"
        if [[ "$origin" == https://* ]]; then
            echo 'KIDA_COOKIE_SECURE=true'
        else
            echo 'KIDA_COOKIE_SECURE=false'
        fi
        echo 'KIDA_CORE_URL=http://127.0.0.1:8989'
    } > "$TMP/console.env"
    unset password confirmation escaped
}

verify_binary() {
    local file="$1" hash name extra count=0
    while read -r hash name extra; do
        if [[ "$name" == "$file" || "$name" == "*$file" ]]; then
            [[ "$hash" =~ ^[[:xdigit:]]{64}$ && -z "$extra" ]] || fail "Invalid checksum entry for $file."
            printf '%s  %s\n' "$hash" "$file" >> "$TMP/selected-checksums"
            count=$((count + 1))
        fi
    done < "$TMP/SHA256SUMS"
    [[ "$count" -eq 1 ]] || fail "Expected exactly one checksum for $file."
}

main() {
    [[ $EUID -eq 0 ]] || fail "Run this installer as root."
    [[ "$VERSION" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || fail "KIDA_VERSION must be a valid release/image tag."
    local command
    for command in curl sha256sum install systemctl mktemp; do
        command -v "$command" >/dev/null || fail "Required command missing: $command."
    done
    echo "KIDA $VERSION — kida-core is required."
    local with_cli=false with_console=false total=1 step=0
    if ask "Install kida-cli?"; then with_cli=true; total=$((total + 1)); fi
    if ask "Install kida-console?"; then with_console=true; total=$((total + 1)); fi

    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    trap 'echo "Installation failed during $STAGE. Completed: $COMPLETED." >&2' ERR
    umask 077
    local base_url="$FORGEJO/api/packages/$OWNER/generic/$PACKAGE/$VERSION"
    local image="$REGISTRY/$OWNER/kida-console:$VERSION"
    local auth=() files=(kida-core)
    if [[ -n "$TOKEN" ]]; then auth=(-u "$OWNER:$TOKEN"); fi
    if $with_cli; then files+=(kida-cli); fi
    if $with_console; then
        command -v docker >/dev/null || fail "Console requires Docker and Docker Compose. Install them and retry; nothing has been installed."
        docker info >/dev/null 2>&1 || fail "Docker is unavailable. Start the daemon and check access; nothing has been installed."
        docker compose version >/dev/null 2>&1 || fail "Console requires the Docker Compose plugin."
        local compose_help
        compose_help="$(docker compose up --help)"
        [[ "$compose_help" == *--wait-timeout* ]] || fail "Update Docker Compose: Console requires up --wait-timeout."
        configure_console
        mkdir -p "$TMP/console"
        if [[ -f "$TMP/console.env" ]]; then
            cp "$TMP/console.env" "$TMP/console/.env"
        else
            cp "$CONSOLE_DIR/.env" "$TMP/console/.env"
        fi
        cat > "$TMP/console/compose.yaml" <<EOF
services:
  kida-console:
    image: $image
    network_mode: host
    restart: unless-stopped
    env_file: .env
    environment:
      KIDA_DATABASE_PATH: /app/data/auth.sqlite3
    volumes:
      - console-data:/app/data
volumes:
  console-data:
EOF
        docker compose --project-name kida-console -f "$TMP/console/compose.yaml" config --quiet
        # Keep registry credentials temporary without changing the user's Docker configuration.
        mkdir -p "$TMP/docker"
        if [[ -n "$TOKEN" ]]; then
            printf '%s' "$TOKEN" | docker --config "$TMP/docker" login "$REGISTRY" --username "$OWNER" --password-stdin || fail "Registry login failed. Check token permissions and HTTP registry configuration."
        fi
        echo "Downloading Console image $image..."
        docker --config "$TMP/docker" pull "$image" || fail "Cannot download Console. Check version, credentials and Docker's insecure-registry configuration for $REGISTRY (HTTP). Nothing has been installed."
    fi

    echo "Downloading selected binaries and checksums..."
    local file
    for file in "${files[@]}" SHA256SUMS; do
        echo "Downloading $file..."
        curl -fL --progress-bar "${auth[@]}" "$base_url/$file" -o "$TMP/$file"
    done
    for file in "${files[@]}"; do verify_binary "$file"; done
    (cd "$TMP" && sha256sum -c selected-checksums)

    step=$((step + 1)); STAGE="kida-core"
    echo "[$step/$total] Installing kida-core..."
    install -m 755 "$TMP/kida-core" /usr/local/bin/kida-core
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
    systemctl enable kida
    systemctl restart kida
    sleep 1
    systemctl is-active --quiet kida
    COMPLETED="kida-core"

    if $with_cli; then
        step=$((step + 1)); STAGE="kida-cli"
        echo "[$step/$total] Installing kida-cli..."
        install -m 755 "$TMP/kida-cli" /usr/local/bin/kida
        COMPLETED="$COMPLETED, kida-cli"
    fi
    if $with_console; then
        step=$((step + 1)); STAGE="kida-console"
        echo "[$step/$total] Installing kida-console..."
        install -d -m 700 "$CONSOLE_DIR"
        if [[ -f "$TMP/console.env" ]]; then
            install -m 600 "$TMP/console.env" "$CONSOLE_DIR/.env"
        fi
        install -m 600 "$TMP/console/compose.yaml" "$CONSOLE_DIR/compose.yaml"
        docker compose --project-name kida-console -f "$CONSOLE_DIR/compose.yaml" up -d --pull never --wait --wait-timeout 120
        COMPLETED="$COMPLETED, kida-console"
        echo "Console configuration: $CONSOLE_DIR/.env (HTTPS requires an external TLS proxy)."
    fi
    echo "KIDA $VERSION installed successfully: $COMPLETED."
    echo 'Agent: /usr/local/bin/kida-core; service: kida.service'
    if $with_cli; then echo 'CLI: /usr/local/bin/kida'; fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
