#!/usr/bin/python3
"""Small multi-project Docker double for Health integration, never a real daemon."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(os.environ["KIDA_HEALTH_E2E_ROOT"])
args = sys.argv[1:]
if (root / "daemon-unavailable").exists():
    print("injected daemon unavailable", file=sys.stderr)
    sys.exit(1)
lock = (root / "docker-state.lock").open("a")
fcntl.flock(lock, fcntl.LOCK_EX)
path = root / "docker-state.json"
state = json.loads(path.read_text()) if path.exists() else {
    "container": [], "network": [], "volume": []}


def save():
    path.write_text(json.dumps(state))


def emit(value):
    print(json.dumps(value))
    sys.exit(0)


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def identity(value):
    return value.get("Id", value.get("Name"))


def selected(rows):
    filters = [args[i + 1] for i, arg in enumerate(args[:-1]) if arg == "--filter"]
    for query in filters:
        if query.startswith("label="):
            key, _, value = query[6:].partition("=")
            rows = [row for row in rows if row.get("Labels", row.get("Config", {}).get("Labels", {})).get(key) == value]
    return rows


if args[0] == "info":
    print("kida-e2e-simulated-daemon")
elif args[0] == "compose":
    project = args[args.index("--project-name") + 1]
    files = [args[i + 1] for i, arg in enumerate(args[:-1]) if arg == "--file"]
    model = json.loads(Path(files[0]).read_text().replace("${KIDA_RESTORE_DIR}", os.environ["KIDA_RESTORE_DIR"]))
    for name, network in model.get("networks", {}).items():
        network.setdefault("name", project + "_" + name)
    for name, volume in model.get("volumes", {}).items():
        volume.setdefault("name", project + "_" + name)
    if "config" in args:
        emit(model)
    if "create" in args:
        overlay = json.loads(Path(files[1]).read_text())
        owner = next(iter(overlay["services"].values()))["labels"]["io.kida.owner"]
        tags = {"com.docker.compose.project": project, "io.kida.owner": owner}
        network_name = project + "_default"
        network_id = hashlib.sha256(network_name.encode()).hexdigest()
        for name, service in model["services"].items():
            expected = service.get("labels", {}).get("kida.test.result", "HEALTHY")
            cid = hashlib.sha256((project + name).encode()).hexdigest()
            labels = dict(tags, **{
                "com.docker.compose.service": name,
                "com.docker.compose.project.config_files": ",".join(files),
                "com.docker.compose.project.working_dir": str(Path(files[0]).parent),
            })
            mounts = [{"Type": "bind", "Source": v["source"], "Destination": v["target"]}
                      for v in service.get("volumes", []) if v["type"] == "bind"]
            mounts.extend({"Type": "volume", "Name": model["volumes"][v["source"]]["name"], "Destination": v["target"]}
                          for v in service.get("volumes", []) if v["type"] == "volume")
            state["container"].append({
                "Id": cid, "Name": project + "-" + name + "-1",
                "Config": {"Image": service["image"], "Labels": labels},
                "HostConfig": {"RestartPolicy": {"Name": "no"}},
                "State": {"Running": False, "Status": "created", "ExitCode": 0,
                          "StartedAt": "2026-10-18T12:00:00Z", "FinishedAt": "0001-01-01T00:00:00Z",
                          "OOMKilled": False, "Error": ""},
                "RestartCount": int(expected == "DEGRADED"), "TestResult": expected,
                "Mounts": mounts,
                "NetworkSettings": {"Ports": {}, "Networks": {network_name: {"NetworkID": network_id}}},
            })
        state["network"].append({"Id": network_id, "Name": network_name,
                                 "Labels": dict(tags, **{"com.docker.compose.network": "default"}), "Containers": {}})
        for name, volume in model.get("volumes", {}).items():
            if not volume.get("external"):
                state["volume"].append({"Name": volume["name"], "CreatedAt": "2026-10-18T12:00:00Z",
                    "Labels": dict(tags, **{"com.docker.compose.volume": name}),
                    "Driver": "local", "Scope": "local", "Options": None, "Mountpoint": "/fake/volumes/" + volume["name"]})
        save()
    elif "start" in args or "stop" in args:
        for row in state["container"]:
            if row["Config"]["Labels"].get("com.docker.compose.project") != project:
                continue
            running = "start" in args
            result = row["TestResult"]
            row["State"].update(Running=running, Status="running" if running else "exited")
            if running and result == "FAILED":
                row["State"].update(Running=False, Status="exited", ExitCode=7)
            if running and result != "UNKNOWN":
                row["State"]["Health"] = {"Status": "unhealthy" if result == "UNHEALTHY" else "healthy"}
        save()
    else:
        fail("unexpected Compose operation: " + repr(args))
elif args[0] == "ps":
    rows = selected(state["container"])
    print("\n".join(row["Name"] if "--format" in args else row["Id"] for row in rows))
elif args[0] in ("network", "volume") and args[1] == "ls":
    print("\n".join(row["Name"] if args[0] == "volume" or "--format" in args else row["Id"] for row in selected(state[args[0]])))
elif args[0] == "inspect" or (args[0] in ("container", "network", "volume") and args[1] == "inspect"):
    kind = "container" if args[0] == "inspect" else args[0]
    ids = args[1:] if args[0] == "inspect" else args[2:]
    rows = [row for row in state[kind] if identity(row) in ids or row.get("Name") in ids]
    if not rows:
        fail("not found")
    emit(rows)
elif len(args) == 3 and args[1] == "rm":
    kind = args[0]
    rows = [row for row in state[kind] if identity(row) == args[2]]
    if not rows:
        fail("not found")
    if kind == "container" and rows[0]["State"]["Running"]:
        fail("running container preserved")
    state[kind].remove(rows[0])
    save()
elif args[:2] == ["container", "logs"]:
    print("safe integration fixture logs")
else:
    fail("unexpected Docker operation: " + repr(args))
