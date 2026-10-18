#!/usr/bin/env python3
"""Health integration driver. --real creates its own disposable rootless daemon."""
import argparse
import datetime as dt
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

REPO = Path(__file__).resolve().parents[2]
SERVER = "exec::health_e2e::server"
CLI = "health_e2e_tests::against_core"
IMAGE = "busybox:1.37"


def until(check, description, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("deadline exceeded: " + description)


def command(args, env=None, timeout=60):
    result = subprocess.run(args, env=env, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise AssertionError(f"command failed: {args}\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip()


def binaries():
    output = command(["cargo", "test", "--workspace", "--locked", "--no-run", "--message-format=json"], timeout=180)
    found = {}
    for line in output.splitlines():
        artifact = json.loads(line)
        if artifact.get("reason") == "compiler-artifact" and artifact.get("executable") and artifact["profile"]["test"]:
            found[artifact["target"]["name"]] = artifact["executable"]
    return found["kida-core"], found["kida-cli"]


def stamp(days=0, hours=0, seconds=0):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days, hours=hours, seconds=seconds)).isoformat()


class Core:
    def __init__(self, root, binary, env, real):
        self.root, self.binary, self.real = root, binary, real
        self.env = dict(env, KIDA_HEALTH_E2E_ROOT=str(root), KIDA_HEALTH_E2E_CHILD="1")
        self.sequence = 0
        self.process = None
        root.mkdir(exist_ok=True)
        (root / "evidence").mkdir(exist_ok=True)
        if not real:
            fake = root / "bin"
            fake.mkdir(exist_ok=True)
            shutil.copyfile(REPO / "tests/backup-health/fake_docker.py", fake / "docker")
            (fake / "docker").chmod(0o755)
            self.env["PATH"] = str(fake) + os.pathsep + env.get("PATH", "")
            state = root / "docker-state.json"
            if not state.exists():
                state.write_text(json.dumps({"container": [], "network": [], "volume": [
                    {"Name": "kida-e2e-shared", "Driver": "local", "Scope": "local", "Options": None,
                     "Mountpoint": "/fake/shared", "Labels": {"sentinel": "foreign"}, "CreatedAt": "2026-10-18T12:00:00Z"}]}))
        reservation = socket.socket()
        reservation.bind(("127.0.0.1", 0))
        self.port = reservation.getsockname()[1]
        reservation.close()
        # All paths are absolute; JSON strings are valid TOML basic strings here.
        # Fake Docker also starts many Python processes during ownership checks;
        # use the real fixture's deadline to tolerate contention on CI runners.
        config = {
            "backup": {"backup_dir": str(root / "jobs")},
            "backup_health": {"data_root": str(root / "data"), "restore_root": str(root / "restore"),
                              "manual_ttl_hours": 1, "report_retention_days": 1,
                              "health_timeout_seconds": 15, "max_active_runs": 2},
            "docker": {"ownership_dir": str(root / "ownership")},
            "scheduler": {"path": str(root / "scheduler.toml")},
            "unix": {"socket_path": str(root / "core.sock")},
            "http": {"host": "127.0.0.1", "port": self.port},
            "queue": {"capacity": 1, "max_concurrent_jobs": 2},
        }
        (root / "config.toml").write_text("\n".join(
            f"[{section}]\n" + "\n".join(f"{key} = {json.dumps(value)}" for key, value in values.items())
            for section, values in config.items()) + "\n")

    def start(self):
        (self.root / "ready.json").unlink(missing_ok=True)
        self.log = (self.root / "core.log").open("a")
        self.process = subprocess.Popen([self.binary, "--exact", SERVER, "--ignored", "--nocapture"],
                                        stdin=subprocess.PIPE, stdout=self.log, stderr=self.log,
                                        env=self.env, text=True)

        def ready():
            if self.process.poll() is not None:
                raise AssertionError((self.root / "core.log").read_text())
            if not (self.root / "ready.json").exists():
                return False
            try:
                return self.request("backup.health.list", {}, http=True)["status"] == "OK"
            except (OSError, HTTPException):
                return False
        until(ready, "CORE readiness", 30)
        return self

    def stop(self, crash=False):
        if self.process and self.process.poll() is None:
            if crash:
                self.process.kill()
            else:
                self.process.stdin.close()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
                raise AssertionError("CORE shutdown deadline exceeded")
            if not crash:
                assert self.process.returncode == 0, (self.root / "core.log").read_text()
        if self.process:
            self.log.close()

    def request(self, name, params, http=False):
        payload = json.dumps({"id": str(uuid.uuid4()), "command": name, "params": params})
        if http:
            conn = HTTPConnection("127.0.0.1", self.port, timeout=30)
            try:
                conn.request("POST", "/command", payload, {"Content-Type": "application/json"})
                response = conn.getresponse()
                assert response.status == 200
                return json.loads(response.read())
            finally:
                conn.close()
        with socket.socket(socket.AF_UNIX) as stream:
            stream.settimeout(30)
            stream.connect(str(self.root / "core.sock"))
            stream.sendall(payload.encode() + b"\n")
            with stream.makefile("rb") as reader:
                return json.loads(reader.readline())

    def ok(self, name, params=None, http=False):
        response = self.request(name, {} if params is None else params, http)
        assert response["status"] == "OK", response
        return response["data"]

    def health(self, operation, params=None, http=False):
        value = self.ok("backup.health." + operation, params, http)
        if operation in ("create", "get", "stop", "delete"):
            run_id = str(uuid.UUID(value["run_id"]))
            (self.root / "evidence" / (operation + "-" + run_id + ".json")).write_text(json.dumps(value, indent=2) + "\n")
        elif operation == "report.get":
            run_id = str(uuid.UUID(value["run_id"]))
            (self.root / "evidence" / (run_id + ".md")).write_text(value["markdown"])
        return value

    def control(self, operation, now=None):
        self.sequence += 1
        request = {"id": self.sequence, "operation": operation}
        if now:
            request["now"] = now
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()

        def received():
            path = self.root / "control.json"
            if not path.exists():
                return False
            result = json.loads(path.read_text())
            return result if result["id"] == self.sequence else False
        return until(received, "fixture control " + operation)["data"]

    def get(self, run_id):
        return self.health("get", {"run_id": run_id})

    def wait_run(self, run_id, final=True):
        def done():
            value = self.get(run_id)
            if value["diagnosis"]["complete"] and (not final or value["state"] in ("STOPPED", "ERROR")):
                return value
            return False
        return until(done, "run diagnosis " + run_id, 90)

    def definition(self, name, result="HEALTHY"):
        relative = str(self.root / "source").lstrip("/") + "/data.txt"
        service = {"image": IMAGE, "restart": "no", "command": ["sleep", "86400"],
                   "labels": {"kida.test.result": result},
                   "volumes": [{"type": "bind", "source": "${KIDA_RESTORE_DIR}", "target": "/restore",
                                "bind": {"create_host_path": False}},
                               {"type": "volume", "source": "data", "target": "/owned"},
                               {"type": "volume", "source": "shared", "target": "/shared", "read_only": True}]}
        if result != "UNKNOWN":
            service["healthcheck"] = {"test": ["CMD-SHELL", f"test \"$(cat /restore/{relative})\" = payload"],
                                      "interval": "1s", "timeout": "1s", "retries": 2}
        compose = self.root / (name + ".json")
        compose.write_text(json.dumps({"services": {"app": service}, "volumes": {
            "data": {}, "shared": {"name": "kida-e2e-shared", "external": True}}, "networks": {"default": {}}}))
        definition = self.root / (name + ".toml")
        definition.write_text(f'id={json.dumps(name)}\nname={json.dumps(name)}\n[backup]\nreference="daily"\nversion="latest"\n[docker]\ncompose={json.dumps(compose.name)}\n')
        return str(definition)

    def create(self, definition, mode="MANUAL", http=False):
        return self.health("create", {"definition_path": definition, "mode": mode}, http)["run_id"]

    def start_run(self, run_id, http=False):
        queued = self.health("start", {"run_id": run_id}, http)
        assert queued["run_id"] == run_id and queued["execution_id"] != run_id
        assert queued["state"] == "STARTING"

    def backup(self):
        source = self.root / "source"
        source.mkdir()
        (source / "data.txt").write_text("payload\n")
        (self.root / "targets").mkdir()
        self.ok("backup.config.create", {"name": "daily", "sources": [str(source)],
                                        "targets": [{"path": str(self.root / "targets")} ]}, http=True)
        queued = self.ok("backup.run", {"name": "daily"})
        assert queued["state"] == "QUEUED"
        until(lambda: list((self.root / "data/artifacts").glob("*/*.json")), "registered backup")
        self.artifact = next((self.root / "targets").iterdir())
        self.original = (source / "data.txt").read_bytes()
        self.artifact_bytes = self.artifact.read_bytes()

    def unchanged(self):
        assert (self.root / "source/data.txt").read_bytes() == self.original
        assert self.artifact.read_bytes() == self.artifact_bytes


def cli_flows(core, cli_binary):
    env = dict(core.env, KIDA_HEALTH_E2E_SOCKET=str(core.root / "core.sock"),
               KIDA_HEALTH_E2E_DEFINITION=core.definition("cli"))
    output = command([cli_binary, "--exact", CLI, "--ignored", "--nocapture"], env, timeout=180)
    assert "1 passed" in output, output


def flows(core, cli_binary):
    core.backup()
    for http in (False, True):
        definition = core.definition("transport-" + str(http))
        manual = core.create(definition, http=http)
        partial = core.health("get", {"run_id": manual}, http)
        assert partial["state"] == "CREATED" and not partial["diagnosis"]["complete"]
        core.start_run(manual, http)
        done = core.wait_run(manual, final=False)
        assert done["state"] == "RUNNING" and done["diagnosis"]["result"] == "HEALTHY", done
        assert Path(done["restore_dir"]).joinpath(str(core.root / "source").lstrip("/"), "data.txt").read_bytes() == core.original
        if core.real:
            ids = docker(core.env, ["ps", "-q", "--filter", "label=com.docker.compose.project=" + done["project"]["project"]]).splitlines()
            assert ids
            assert docker(core.env, ["exec", ids[0], "cat", "/restore/" + str(core.root / "source").lstrip("/") + "/data.txt"]) == "payload"
        stopped = core.health("stop", {"run_id": manual}, http)
        assert stopped["state"] == "STOPPED" and stopped["cleanup"]["state"] == "PENDING"
        deleted = core.health("delete", {"run_id": manual}, http)
        assert deleted["cleanup"]["state"] == "COMPLETED", deleted
        assert not Path(done["restore_dir"]).exists()
        assert manual in core.health("report.list", http=http)
        assert "#" in core.health("report.get", {"run_id": manual}, http)["markdown"]
        core.health("report.delete", {"run_id": manual}, http)
        assert manual not in core.health("report.list", http=http)
        assert any(row["run_id"] == manual for row in core.health("list", http=http))
        assert core.request("backup.health.start", {"run_id": manual}, http)["status"] == "ERROR"
        automatic = core.health("run", {"definition_path": definition}, http)
        assert automatic["execution_id"] != automatic["run_id"]
        done = core.wait_run(automatic["run_id"])
        assert done["diagnosis"]["result"] == "HEALTHY" and done["cleanup"]["state"] == "COMPLETED", done
        assert not Path(done["restore_dir"]).exists()
    if cli_binary:
        cli_flows(core, cli_binary)
    core.unchanged()


def protections(core):
    for http in (False, True):
        jobs = core.ok("scheduler.list", {"origin": "INTERNAL"}, http)
        assert len(jobs) == 2
        for job in jobs:
            assert core.request("scheduler.delete", {"id": job["id"]}, http)["status"] == "ERROR"
            assert core.request(job["command"], {}, http)["status"] == "ERROR"
            assert core.request("scheduler.add", {"command": job["command"], "params": {},
                "schedule": {"type": "interval", "seconds": 1}}, http)["status"] == "ERROR"
        assert core.request("backup.health.get", {"run_id": "invalid"}, http)["status"] == "ERROR"


def concurrency_and_time(core):
    first_def, second_def = core.definition("concurrent-a"), core.definition("concurrent-b")
    first, second = core.create(first_def), core.create(second_def)
    # Hold the actual worker before dispatch so both admissions coexist deterministically.
    (core.root / "paused").touch()
    core.start_run(first)
    until(lambda: (core.root / "worker-entered").exists(), "worker admission barrier")
    core.start_run(second)
    assert core.get(first)["state"] == core.get(second)["state"] == "STARTING"
    duplicate = core.create(first_def)
    assert core.request("backup.health.start", {"run_id": duplicate})["status"] == "ERROR"
    third = core.create(core.definition("capacity"))
    assert core.request("backup.health.start", {"run_id": third})["status"] == "ERROR"
    assert core.get(third)["state"] == "CREATED"
    (core.root / "paused").unlink()
    a, b = core.wait_run(first, False), core.wait_run(second, False)
    assert a["state"] == b["state"] == "RUNNING"
    assert a["project"]["project"] != b["project"]["project"]
    core.health("delete", {"run_id": first})
    assert core.get(second)["state"] == "RUNNING"
    core.start_run(third)
    core.wait_run(third, False)
    expired = core.control("expire", stamp(hours=2))
    assert not expired["errors"], expired
    for run_id in (second, third):
        value = core.get(run_id)
        assert value["cleanup"]["state"] == "COMPLETED", value
        assert not Path(value["restore_dir"]).exists()
    # Expiry must not start a CREATED execution.
    assert core.get(duplicate)["state"] == "CREATED"


def technical_results(core):
    for result in ("FAILED", "UNHEALTHY", "UNKNOWN", "DEGRADED", "HEALTHY"):
        automatic = core.health("run", {"definition_path": core.definition("result-" + result, result)})
        value = core.wait_run(automatic["run_id"])
        assert value["diagnosis"]["result"] == result, value
        assert value["cleanup"]["state"] == "COMPLETED", value
        assert "#" in core.health("report.get", {"run_id": value["run_id"]})["markdown"]


def cleanup_failure(core):
    run_id = core.create(core.definition("cleanup-retry"))
    core.start_run(run_id)
    original = core.wait_run(run_id, False)
    failure = core.root / "daemon-unavailable"
    failure.touch()
    try:
        failed = core.health("delete", {"run_id": run_id})
        assert failed["cleanup"]["state"] == "ERROR" and failed["cleanup"]["errors"], failed
        assert Path(original["restore_dir"]).exists()
        retained = core.control("retain", stamp(days=2))
        assert not retained["errors"], retained
        assert core.get(run_id)["run_id"] == run_id
    finally:
        failure.unlink()
    result = core.control("expire", stamp(hours=2))
    assert not result["errors"], result
    assert core.get(run_id)["cleanup"]["state"] == "COMPLETED"
    assert not Path(original["restore_dir"]).exists()
    assert run_id in core.health("report.list")


def saturation(core):
    (core.root / "worker-entered").unlink(missing_ok=True)
    (core.root / "paused").touch()
    filled = 0
    def fill_all_slots():
        nonlocal filled
        filled += core.control("fill")["enqueued"]
        # max_admitted_jobs=capacity+workers=3; the queue holds one more.
        assert filled <= 4
        return filled == 4
    until(fill_all_slots, "worker admission slots and queue saturated")
    until(lambda: (core.root / "worker-entered").exists(), "worker blocked")
    before = len(core.health("list"))
    schedules = []
    for index in range(3):
        definition = core.definition("scheduled-" + str(index))
        schedules.append(core.ok("scheduler.add", {"command": "backup.health.run",
            "params": {"definition_path": definition}, "schedule": {"type": "once", "at": stamp(seconds=1)}})["id"])
    time.sleep(1.1)
    core.control("tick")
    pending = core.ok("scheduler.list", {"origin": "USER"})
    assert {row["id"] for row in pending} == set(schedules), pending
    core.control("tick")
    assert len(core.health("list")) == before
    (core.root / "paused").unlink()

    def admitted():
        core.control("tick")
        return len(core.health("list")) == before + 3
    until(admitted, "pending scheduled occurrences admitted")
    until(lambda: all(row["state"] in ("STOPPED", "ERROR") for row in core.health("list") if row["definition"]["id"].startswith("scheduled-")), "scheduled jobs completed")
    assert not core.ok("scheduler.list", {"origin": "USER"})
    core.control("tick")
    assert len(core.health("list")) == before + 3
    for row in core.health("list"):
        if row["definition"]["id"].startswith("scheduled-"):
            assert row["diagnosis"]["result"] == "HEALTHY", row


def docker(env, args, timeout=60):
    return command(["docker", *args], env, timeout)


def sentinels(core, reference=None):
    # Only called for the dedicated real daemon. Copied labels cannot establish ownership.
    project = reference["project"]["project"] if reference else "foreign-project"
    owner = reference["project"]["owner"] if reference else str(uuid.uuid4())
    suffix = str(uuid.uuid4())[:8]
    tags = {"com.docker.compose.project": project, "io.kida.owner": owner}
    if reference:
        container_id = next(row["identity"] for row in reference["resources"] if row["kind"] == "container")
        tags = json.loads(docker(core.env, ["container", "inspect", container_id]))[0]["Config"]["Labels"]
    labels = [arg for key, value in tags.items() for arg in ("--label", key + "=" + value)]
    network = docker(core.env, ["network", "create", *labels, "sentinel-" + suffix])
    volume = docker(core.env, ["volume", "create", *labels, "sentinel-" + suffix])
    container = docker(core.env, ["run", "-d", "--name", "sentinel-" + suffix, *labels,
        "--network", network, "--mount", "type=volume,source=" + volume + ",target=/data", IMAGE,
        "sh", "-c", "printf sentinel >/data/marker; sleep 86400"])
    until(lambda: marker(core, container, "/data/marker", "sentinel"), "sentinel content")
    return container, network, volume


def sentinel_snapshot(core, identities):
    container, network, volume = identities
    c = json.loads(docker(core.env, ["container", "inspect", container]))[0]
    n = json.loads(docker(core.env, ["network", "inspect", network]))[0]
    v = json.loads(docker(core.env, ["volume", "inspect", volume]))[0]
    return {"container": c["Id"], "network": n["Id"], "volume": v,
            "running": c["State"]["Running"], "content": docker(core.env, ["exec", container, "cat", "/data/marker"])}


def marker(core, container, path, expected):
    result = subprocess.run(["docker", "exec", container, "cat", path], env=core.env,
                            text=True, capture_output=True, timeout=10)
    return result.returncode == 0 and result.stdout.strip() == expected


def resource_snapshot(core, resources):
    snapshot = {}
    for resource in resources:
        kind, identity = resource["kind"], resource["identity"]
        value = json.loads(docker(core.env, [kind, "inspect", identity]))[0]
        snapshot[(kind, identity)] = (value.get("Id", value.get("Name")), value.get("State", {}).get("Running"))
    return snapshot


def resources_absent(core, resources):
    # Successful full inventories distinguish absence from a failed inspection/daemon.
    inventories = {
        "container": docker(core.env, ["ps", "-aq", "--no-trunc"]).splitlines(),
        "network": docker(core.env, ["network", "ls", "-q", "--no-trunc"]).splitlines(),
        "volume": docker(core.env, ["volume", "ls", "-q"]).splitlines(),
    }
    for resource in resources:
        assert resource["identity"] not in inventories[resource["kind"]], resource


def real_preservation(core):
    baseline = sentinels(core)
    before = sentinel_snapshot(core, baseline)
    docker(core.env, ["run", "-d", "--name", "shared-sentinel", "--mount",
        "type=volume,source=kida-e2e-shared,target=/shared", IMAGE, "sh", "-c", "printf shared >/shared/marker; sleep 86400"])
    until(lambda: marker(core, "shared-sentinel", "/shared/marker", "shared"), "shared sentinel content")

    def operate(operation, run_id):
        if operation == "delete":
            core.health("delete", {"run_id": run_id})
        elif operation == "expire":
            return core.control("expire", stamp(hours=2))
        else:
            core.stop(crash=True)
            core.start()
        return None

    for operation in ("delete", "expire", "restart"):
        run_id = core.create(core.definition("preserve-" + operation))
        core.start_run(run_id)
        original = core.wait_run(run_id, False)
        operate(operation, run_id)
        value = core.get(run_id)
        assert value["cleanup"]["state"] == "COMPLETED", value
        assert not Path(value["restore_dir"]).exists()
        resources_absent(core, original["resources"])
        assert sentinel_snapshot(core, baseline) == before
        assert marker(core, "shared-sentinel", "/shared/marker", "shared")

        # Ambiguous copied labels must preserve both foreign and managed resources.
        run_id = core.create(core.definition("copied-" + operation))
        core.start_run(run_id)
        original = core.wait_run(run_id, False)
        owned_before = resource_snapshot(core, original["resources"])
        copied = sentinels(core, original)
        copied_before = sentinel_snapshot(core, copied)
        operate(operation, run_id)
        value = core.get(run_id)
        assert value["cleanup"]["state"] == "ERROR", value
        assert value["cleanup"]["errors"]
        assert Path(original["restore_dir"]).exists()
        assert resource_snapshot(core, original["resources"]) == owned_before
        assert sentinel_snapshot(core, copied) == copied_before
        assert sentinel_snapshot(core, baseline) == before
        assert marker(core, "shared-sentinel", "/shared/marker", "shared")
        # Remove only the three sentinels created by this driver, by exact identity.
        docker(core.env, ["container", "rm", "--force", copied[0]])
        docker(core.env, ["network", "rm", copied[1]])
        docker(core.env, ["volume", "rm", copied[2]])
        retried = core.control("expire", stamp(hours=2))
        assert not retried["errors"], retried
        assert core.get(run_id)["cleanup"]["state"] == "COMPLETED"
        assert not Path(original["restore_dir"]).exists()
        resources_absent(core, original["resources"])
        assert sentinel_snapshot(core, baseline) == before
        assert marker(core, "shared-sentinel", "/shared/marker", "shared")


def restart_and_retention(core):
    run_id = core.create(core.definition("restart"))
    core.start_run(run_id)
    value = core.wait_run(run_id, False)
    jobs = core.ok("scheduler.list", {"origin": "INTERNAL"})
    core.stop(crash=True)
    core.start()
    recovered = core.get(run_id)
    assert recovered["state"] == "ERROR", recovered
    assert recovered["cleanup"]["state"] == "COMPLETED", recovered
    assert not Path(value["restore_dir"]).exists()
    assert any("restart" in text for text in recovered["diagnosis"]["anomalies"])
    assert core.ok("scheduler.list", {"origin": "INTERNAL"}) == jobs
    assert run_id in core.health("report.list")
    core.health("report.delete", {"run_id": run_id})
    core.stop()
    core.start()
    assert run_id not in core.health("report.list")
    retained = core.control("retain", stamp(days=2))
    assert not retained["errors"], retained
    assert not core.health("list")
    assert not core.health("report.list")
    core.unchanged()


def run_suite(root, core_bin, cli_bin, env, real, result):
    core = Core(root, core_bin, env, real)
    result["checks"] = []
    def checked(name, operation):
        operation()
        result["checks"].append(name)
        print("PASS:", name, flush=True)
    try:
        core.start()
        checked("backup, restored data, HTTP/socket" + ("/CLI" if cli_bin else ""), lambda: flows(core, cli_bin))
        checked("protected maintenance", lambda: protections(core))
        checked("concurrency, exclusion, capacity, TTL", lambda: concurrency_and_time(core))
        if not real:
            checked("five technical results (simulated Docker)", lambda: technical_results(core))
            checked("pending cleanup retention and retry (simulated Docker)", lambda: cleanup_failure(core))
        checked("queue saturation and pending schedules", lambda: saturation(core))
        if real:
            checked("real ownership, shared resources, copied labels", lambda: real_preservation(core))
        checked("process restart, reports, retention", lambda: restart_and_retention(core))
    finally:
        core.stop(crash=True)


def isolated_daemon(root, env):
    for executable in ("docker", "dockerd", "dockerd-rootless.sh", "rootlesskit"):
        if not shutil.which(executable):
            raise RuntimeError("missing rootless prerequisite: " + executable)
    docker(env, ["compose", "version"])
    daemon = root / "daemon"
    daemon.mkdir()
    runtime = daemon / "runtime"
    runtime.mkdir(mode=0o700)
    host = "unix://" + str(daemon / "docker.sock")
    isolated = dict(env, DOCKER_HOST=host, XDG_RUNTIME_DIR=str(runtime),
                    KIDA_HEALTH_E2E_REAL="1", KIDA_E2E_DOCKER_HOST=host)
    for name in ("DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        isolated.pop(name, None)
    (daemon / "config.json").write_text("{}\n")
    log = (daemon / "daemon.log").open("w")
    process = subprocess.Popen(["dockerd-rootless.sh", "--config-file=" + str(daemon / "config.json"),
        "--live-restore=false", "--host=" + host,
        "--data-root=" + str(daemon / "data"), "--exec-root=" + str(daemon / "exec"),
        "--pidfile=" + str(daemon / "dockerd.pid"), "--storage-driver=vfs"],
        env=isolated, stdout=log, stderr=log, start_new_session=True)
    return process, log, isolated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--simulated", action="store_true")
    mode.add_argument("--real", action="store_true", help="authorize creation and disposal of a dedicated rootless daemon")
    parser.add_argument("--core-test-bin")
    parser.add_argument("--cli-test-bin")
    args = parser.parse_args()
    core_bin, cli_bin = args.core_test_bin, args.cli_test_bin
    if not core_bin:
        core_bin, built_cli = binaries()
        cli_bin = cli_bin or built_cli
    if args.real and not cli_bin:
        _, cli_bin = binaries()
    root = Path(tempfile.mkdtemp(prefix="kida-e2e-"))
    print("Evidence directory:", root, flush=True)
    result = {"mode": "real" if args.real else "simulated", "passed": False, "cli": bool(cli_bin)}
    daemon_process = daemon_log = None
    env = os.environ.copy()
    # Test-mode and rootless control variables must come from this invocation.
    for key in list(env):
        if key.startswith(("KIDA_E2E_", "KIDA_HEALTH_E2E_", "DOCKERD_ROOTLESS_")) or key == "_DOCKERD_ROOTLESS_CHILD":
            env.pop(key)
    exit_code = 0
    try:
        if args.real:
            daemon_process, daemon_log, env = isolated_daemon(root, env)

            def daemon_ready():
                if daemon_process.poll() is not None:
                    raise RuntimeError("rootless daemon failed: " + (root / "daemon/daemon.log").read_text())
                response = subprocess.run(["docker", "info", "--format", "{{json .}}"], env=env,
                                          text=True, capture_output=True, timeout=5)
                return json.loads(response.stdout) if response.returncode == 0 else False
            info = until(daemon_ready, "rootless daemon readiness", 30)
            assert Path(info["DockerRootDir"]).resolve() == (root / "daemon/data").resolve(), info
            assert "rootless" in " ".join(info["SecurityOptions"]), info
            env["KIDA_E2E_DAEMON_ID"] = info["ID"]
            result["daemon"] = {"id": info["ID"], "root": info["DockerRootDir"],
                                "version": info["ServerVersion"], "compose": docker(env, ["compose", "version"])}
            docker(env, ["pull", IMAGE], timeout=180)
            result["image"] = json.loads(docker(env, ["image", "inspect", IMAGE]))[0]["Id"]
            docker(env, ["volume", "create", "kida-e2e-shared"])
        run_suite(root / "case", core_bin, cli_bin, env, args.real, result)
        result["passed"] = True
    except Exception as error:
        result["error"] = str(error)
        print(str(error), file=sys.stderr)
        exit_code = 1
    finally:
        if daemon_process:
            try:
                if daemon_process.poll() is None:
                    os.killpg(daemon_process.pid, signal.SIGTERM)
                    try:
                        daemon_process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(daemon_process.pid, signal.SIGKILL)
                        daemon_process.wait(timeout=10)
                # Never remove storage while the dedicated endpoint still answers.
                probe = subprocess.run(["docker", "info", "--format", "{{.ID}}"], env=env,
                                       text=True, capture_output=True, timeout=5)
                if probe.returncode == 0:
                    raise RuntimeError("dedicated Docker endpoint still active after shutdown; data preserved")
                for name in ("data", "exec", "runtime"):
                    directory = root / "daemon" / name
                    if directory.exists():
                        shutil.rmtree(directory)
                result["daemon_stopped"] = True
            except Exception as error:
                result["cleanup_error"] = str(error)
                result["passed"] = False
                print("daemon cleanup failed:", error, file=sys.stderr)
                exit_code = 1
            finally:
                daemon_log.close()
        (root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        # Evidence stays outside the repository, including logs on failure.
    if exit_code == 0:
        print("HEALTH E2E PASS (" + result["mode"] + ")", flush=True)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
