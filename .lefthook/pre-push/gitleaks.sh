#!/usr/bin/env bash
set -euo pipefail

zero="0000000000000000000000000000000000000000"

while read -r local_ref local_oid remote_ref remote_oid; do
  # Ignore deleted references
  [[ "$local_oid" == "$zero" ]] && continue

  # Only commits and tags pointing to commits are supported
  if ! git rev-parse --verify -q "${local_oid}^{commit}" >/dev/null; then
    echo "Cannot scan reference: $local_ref" >&2
    exit 1
  fi

  if [[ "$remote_oid" == "$zero" ]]; then
    # New branch/tag: scan reachable history
    range="$local_oid"
  elif git cat-file -e "${remote_oid}^{commit}" 2>/dev/null; then
    # Existing reference: scan unpublished commits
    range="${remote_oid}..${local_oid}"
  else
    # Unknown remote commit: conservative full scan
    range="$local_oid"
  fi

  echo "Scanning $local_ref -> $remote_ref"

  gitleaks git . \
    --redact \
    --log-opts="--diff-merges=first-parent $range"
done
