#!/usr/bin/env python3
"""Failure injection for backup cleanup tests; only used in isolated children."""
import os
from pathlib import Path
import sys

root = Path(os.environ["KIDA_BACKUP_TEST_ROOT"])
scenario = os.environ["KIDA_BACKUP_TEST_SCENARIO"]
action, container = sys.argv[1:]
assert container in ("test", "second")
pre_failed = scenario in ("pre_only", "pre_and_post", "handler_errors")
if action == "stop":
    with (root / "calls").open("a") as calls:
        calls.write("pre\n" if container == "test" else "pre2\n")
    assert not list((root / "artifacts").iterdir())
    if pre_failed:
        sys.exit("injected pre failure")
    if scenario in ("partial", "partial_only"):
        (root / "second.txt").unlink()
elif action == "start":
    with (root / "calls").open("a") as calls:
        calls.write("post\n" if container == "test" else "post2\n")
    artifacts = list((root / "artifacts").iterdir())
    if pre_failed:
        assert not artifacts, artifacts
    else:
        assert len(artifacts) == 1, artifacts
        artifact = artifacts[0]
        assert artifact.stat().st_size > 0
    if scenario in ("partial", "post_failure", "post_continues", "post_multiple", "pre_and_post", "handler_errors") and container == "test":
        sys.exit("injected post failure")
    if scenario in ("post_multiple", "pre_and_post", "handler_errors") and container == "second":
        sys.exit("injected second post failure")
    if scenario == "checksum_failure":
        artifact.unlink()
        artifact.symlink_to(root / "absent")
    if scenario in ("required_failure", "optional_failure"):
        # Obstruct the destination without making the target directory unavailable.
        target = "target" if scenario == "required_failure" else "failed-target"
        # The temporary prefix is kida-<UUID>- followed by the public artifact name.
        artifact_name = artifact.name[len("kida-") + 36 + 1:]
        (root / target / artifact_name).mkdir()
else:
    raise AssertionError(action)
