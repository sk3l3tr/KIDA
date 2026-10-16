#!/usr/bin/python3
"""Isolated slow Docker/shutdown fake. Never invokes real system tools."""
import os
from pathlib import Path
import sys
import time

root = Path(os.environ["KIDA_BLOCKING_DIR"])
command = os.environ["KIDA_BLOCKING_COMMAND"]
expected = {
    "docker.compose.version": ["compose", "version", "--short"],
    "system.shutdown": ["--poweroff", "+1"],
    "system.reboot": ["--reboot", "+1"],
}
assert sys.argv[1:] == expected[command], sys.argv
(root / "started").write_text("running")
deadline = time.monotonic() + 10
while not (root / "release").exists():
    if time.monotonic() > deadline:
        sys.exit("runtime did not release fake command")
    time.sleep(0.01)
if command == "docker.compose.version":
    print("2.99.0")
