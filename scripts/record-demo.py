#!/usr/bin/env python3
"""Record the real KIDA CLI against a disposable rootless Docker daemon."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time


REPO = Path(__file__).resolve().parents[1]
TOOLS = ("cargo", "vhs", "ffmpeg", "ffprobe", "ttyd", "bwrap", "docker",
         "dockerd", "dockerd-rootless.sh", "rootlesskit", "newuidmap",
         "newgidmap", "slirp4netns", "busybox", "fc-match", "fc-cache")
SCENES = {
    "overview": ("demo.tape", "demo.gif", 3),
    "scheduler": ("demos/scheduler.tape", "scheduler.gif", 2),
    "backup-run": ("demos/backup-run.tape", "backup-run.gif", 2),
    "backup-health": ("demos/backup-health.tape", "backup-health.gif", 3),
}


def run(args, *, env=None, cwd=None, timeout=60):
    return subprocess.run(args, env=env, cwd=cwd, check=True, text=True,
                          capture_output=True, timeout=timeout).stdout.strip()


def until(check, description, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        time.sleep(0.1)
    raise RuntimeError("Timed out: " + description)


def docker(env, *args):
    return run(["docker", *args], env=env)


def daemon_info(env):
    try:
        return json.loads(docker(env, "info", "--format", "{{json .}}"))
    except (subprocess.SubprocessError, json.JSONDecodeError):
        return None


def stop(process):
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)


def validate_gif(path):
    video = json.loads(run(["ffprobe", "-v", "error", "-show_streams",
                           "-show_format", "-of", "json", str(path)]))
    stream = video["streams"][0]
    duration = float(video["format"]["duration"])
    if (stream["codec_name"] != "gif" or stream["width"] != 1000
            or stream["height"] != 560 or not 15 <= duration <= 25):
        raise RuntimeError("GIF must be 1000x560 and 15–25 seconds")
    if path.stat().st_size > 3 * 1024 * 1024:
        raise RuntimeError("GIF exceeds the 3 MiB budget")
    if b"NETSCAPE2.0\x03\x01\x00\x00" not in path.read_bytes():
        raise RuntimeError("GIF does not loop indefinitely")
    run(["ffmpeg", "-v", "error", "-xerror", "-i", str(path),
         "-f", "null", "-"], timeout=120)
    return {"seconds": duration, "bytes": path.stat().st_size,
            "width": stream["width"], "height": stream["height"]}


def request(command, params):
    with socket.socket(socket.AF_UNIX) as stream:
        stream.settimeout(30)
        stream.connect("/tmp/kida.sock")
        stream.sendall(json.dumps({"id": "demo-validation", "command": command,
                                   "params": params}).encode() + b"\n")
        with stream.makefile("rb") as reader:
            response = json.loads(reader.readline())
    if response["status"] != "OK":
        raise RuntimeError(str(response))
    return response["data"]


def assert_isolated():
    if (str(os.stat("/proc/self/ns/mnt").st_ino) == os.environ["KIDA_DEMO_HOST_MNT"]
            or Path("/etc/kida/kida.toml").read_bytes() != Path("/demo/kida.toml").read_bytes()):
        raise RuntimeError("The demo requires its private mount namespace")


def wait_health():
    assert_isolated()
    def ready():
        value = request("backup.health.get", {"run_id": os.environ["run_id"]})
        if value["state"] == "ERROR":
            raise RuntimeError("Backup Health failed: " + json.dumps(value))
        if value["diagnosis"]["complete"]:
            if value["state"] != "RUNNING" or value["diagnosis"]["result"] != "HEALTHY":
                raise RuntimeError("Expected a healthy manual restoration: " + json.dumps(value))
            return value
        return None
    return until(ready, "Backup Health diagnosis", timeout=60)


def verify_new_backup(previous):
    directory = Path("/demo/health-data/artifacts")
    metadata = until(lambda: set(directory.glob("*/*.json")) - previous, "backup completion")
    if len(metadata) != 1:
        raise RuntimeError("Expected exactly one new registered backup")
    artifact = json.loads(metadata.pop().read_text())
    archive = Path(artifact["destinations"][0])
    if (archive.parent != Path("/demo/backups") or archive.stat().st_size != artifact["size"]
            or hashlib.sha256(archive.read_bytes()).hexdigest() != artifact["checksum"]):
        raise RuntimeError("Backup archive verification failed")


def inside():
    root = Path("/demo")
    # Refuse manual invocation outside the mount namespace created below.
    assert_isolated()
    env = dict(os.environ)
    info = daemon_info(env)
    if not info or info["ID"] != env["KIDA_DEMO_DAEMON_ID"]:
        raise RuntimeError("Private Docker daemon identity mismatch")
    run(["fc-cache", "-f"], env=env)
    if "Fira Code" not in run(["fc-match", "-f", "%{family}", "Fira Code"], env=env).split(","):
        raise RuntimeError("Fira Code is unavailable inside the recording namespace")
    with (root / "core.log").open("w") as log:
        core = subprocess.Popen(["/repo/target/debug/kida-core"], env=env,
                                stdout=log, stderr=log, start_new_session=True)
        try:
            def ready():
                if core.poll() is not None:
                    raise RuntimeError("CORE exited; inspect core.log")
                try:
                    return run(["kida", "backup", "config", "list"], env=env)
                except subprocess.SubprocessError:
                    return None
            until(ready, "CORE readiness")
            run(["kida", "backup", "config", "create", "--name", "demo-site",
                 "--source", "/demo/site", "--target", "/demo/backups"], env=env)
            results = {}
            for scene in json.loads(env["KIDA_DEMO_SCENES"]):
                tape, output, count = SCENES[scene]
                (root / "status").unlink(missing_ok=True)
                previous = set((root / "health-data/artifacts").glob("*/*.json"))
                before = docker(env, "inspect", "--format", "{{.State.StartedAt}}", "demo-web")
                containers = docker(env, "ps", "-aq")
                if scene == "backup-health":
                    # Create a real restore point and CREATED run before recording.
                    docker(env, "compose", "version")
                    request("backup.run", {"name": "demo-site"})
                    verify_new_backup(previous)
                    health = request("backup.health.create", {"definition_path": "/demo/health.toml",
                                                              "mode": "MANUAL"})
                    env.update(run_id=health["run_id"], restore_dir=health["restore_dir"])
                recording = subprocess.run(["vhs", "/repo/" + tape], env=env, cwd=root,
                                           text=True, capture_output=True, timeout=180)
                (root / (scene + ".vhs.log")).write_text(recording.stdout + recording.stderr)
                if recording.returncode:
                    raise RuntimeError("VHS failed; inspect " + scene + ".vhs.log")
                if (root / "status").read_text().splitlines() != ["0"] * count:
                    raise RuntimeError("A recorded CLI operation failed: " + scene)
                checks = {}
                if scene == "overview":
                    if before == docker(env, "inspect", "--format", "{{.State.StartedAt}}", "demo-web"):
                        raise RuntimeError("Container restart was not observed")
                    checks["restart_verified"] = True
                if scene in ("overview", "backup-run"):
                    verify_new_backup(previous)
                    checks["backup_checksum_verified"] = True
                if scene == "scheduler":
                    schedules = request("scheduler.list", {"origin": "USER"})
                    if (len(schedules) != 1 or schedules[0]["command"] != "backup.run"
                            or schedules[0]["params"] != {"name": "demo-site"}
                            or schedules[0]["schedule"] != {"type": "interval", "seconds": 86400}):
                        raise RuntimeError("Recorded schedule does not match its definition")
                    checks["schedule_verified"] = True
                if scene == "backup-health":
                    health = request("backup.health.get", {"run_id": env["run_id"]})
                    if (health["state"] != "STOPPED" or health["diagnosis"]["result"] != "HEALTHY"
                            or health["cleanup"]["state"] != "COMPLETED"
                            or Path(health["restore_dir"]).exists()
                            or docker(env, "ps", "-aq") != containers):
                        raise RuntimeError("Backup Health diagnosis/cleanup verification failed")
                    checks.update(restoration_verified=True, healthy=True, cleanup_verified=True)
                if (root / "site/index.html").read_text() != "<h1>KIDA demo site</h1>\n":
                    raise RuntimeError("Demo source changed")
                results[scene] = dict(validate_gif(root / "assets" / output), **checks,
                                      source_unchanged=True, cli_exit_codes=[0] * count)
            (root / "validation.json").write_text(json.dumps(results, indent=2) + "\n")
        finally:
            stop(core)


def main():
    if sys.argv[1:] == ["--inside"]:
        inside()
        return
    if sys.argv[1:] == ["--wait-health"]:
        health = wait_health()
        restored = Path(health["restore_dir"]) / "demo/site/index.html"
        if restored.read_bytes() != Path("/demo/site/index.html").read_bytes():
            raise RuntimeError("Restored data differs from the source")
        print("HEALTH_READY", flush=True)
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", nargs="+", choices=[*SCENES, "all"], default=["overview"])
    options = parser.parse_args()
    selected = list(SCENES) if "all" in options.demo else list(dict.fromkeys(options.demo))
    missing = [name for name in TOOLS if shutil.which(name) is None]
    if missing:
        raise RuntimeError("Missing prerequisites (nothing installed): " + ", ".join(missing))
    if os.geteuid() == 0:
        raise RuntimeError("Run as an ordinary user; do not use sudo")
    if "Fira Code" not in run(["fc-match", "-f", "%{family}", "Fira Code"]).split(","):
        raise RuntimeError("Install Fira Code before recording")
    browser = os.environ.get("CHROME_BIN") or next(
        (shutil.which(name) for name in ("chromium", "chromium-browser", "google-chrome")
         if shutil.which(name)), None)
    if not browser or not Path(browser).is_file():
        raise RuntimeError("Set CHROME_BIN to an existing Chromium executable; no downloads are performed")
    # A static BusyBox gives us a tiny, offline image with no registry dependency.
    busybox = shutil.which("busybox")
    linked = subprocess.run(["ldd", busybox], text=True, capture_output=True)
    if "=>" in linked.stdout or "ld-linux" in linked.stdout:
        raise RuntimeError("The demo needs a statically linked BusyBox")
    run(["vhs", "validate", *(SCENES[name][0] for name in selected)], cwd=REPO)
    subprocess.run(["cargo", "build", "--workspace", "--locked"], cwd=REPO, check=True)
    root = Path(tempfile.mkdtemp(prefix="kida-demo-"))
    print("Demo evidence: " + str(root), flush=True)
    for directory in ("runtime", "home", "bin", "site", "backups", "assets"):
        (root / directory).mkdir(mode=0o700)
    font = Path(run(["fc-match", "-f", "%{file}", "Fira Code"]))
    fonts = root / "home/.local/share/fonts"
    fonts.mkdir(parents=True)
    shutil.copyfile(font, fonts / font.name)
    (root / "site/index.html").write_text("<h1>KIDA demo site</h1>\n")
    (root / "backup.toml").write_text('name = "on-demand"\nsources = ["/demo/site"]\n'
                                      '[[targets]]\npath = "/demo/backups"\n')
    (root / "schedule.toml").write_text('command = "backup.run"\nparams = \'{"name":"demo-site"}\'\n\n'
                                        '[schedule]\ntype = "interval"\nseconds = 86400\n')
    (root / "health.toml").write_text('id = "demo-restore"\nname = "Demo restore"\n'
                                      '[backup]\nreference = "demo-site"\nversion = "latest"\n'
                                      '[docker]\ncompose = "compose.json"\n')
    (root / "compose.json").write_text(json.dumps({"services": {"app": {
        "image": "demo-site:local", "pull_policy": "never", "restart": "no", "network_mode": "none",
        "command": ["/bin/busybox", "httpd", "-f", "-h", "/restore/demo/site", "-p", "8080"],
        "stop_grace_period": "1s", "volumes": [{"type": "bind", "source": "${KIDA_RESTORE_DIR}",
            "target": "/restore", "read_only": True, "bind": {"create_host_path": False}}],
        "healthcheck": {"test": ["CMD", "/bin/busybox", "grep", "-q", "KIDA demo site",
                                  "/restore/demo/site/index.html"],
                        "interval": "1s", "timeout": "1s", "retries": 3}}}}) + "\n")
    (root / "daemon.json").write_text("{}\n")
    (root / "bin/kida").symlink_to("/repo/target/debug/kida-cli")
    (root / "bin/chromium").symlink_to(Path(browser).resolve())
    guard = root / "bin/kida-demo-guard"
    guard.write_text('#!/bin/sh\ntest -n "$KIDA_DEMO_DAEMON_ID" && test -S /run/demo-docker.sock\n')
    guard.chmod(0o700)
    (root / "session.sh").write_text(
        'kida-demo-guard || return 1\n'
        "PS1='\\[\\e[38;5;117m\\]❯\\[\\e[0m\\] '\n"
        'kida() { /repo/target/debug/kida-cli "$@"; local rc=$?; '
        'printf "%s\\n" "$rc" >> /demo/status; return "$rc"; }\n'
        "clear\nprintf 'DEMO_READY\\n'\n")
    config = {"unix": {"socket_path": "/tmp/kida.sock"},
              "http": {"host": "127.0.0.1", "port": 0},
              "backup": {"backup_dir": "/demo/jobs"},
              "scheduler": {"path": "/demo/scheduler.toml"},
              "docker": {"ownership_dir": "/demo/ownership"},
              "backup_health": {"data_root": "/demo/health-data", "restore_root": str(root / "restored")}}
    (root / "kida.toml").write_text("\n".join(
        f"[{section}]\n" + "\n".join(f"{key} = {json.dumps(value)}" for key, value in fields.items())
        for section, fields in config.items()) + "\n")
    env = dict(os.environ, HOME=str(root / "home"), DOCKER_HOST="unix://" + str(root / "docker.sock"),
               DOCKER_CONFIG=str(root / "home/.docker"), XDG_RUNTIME_DIR=str(root / "runtime"),
               DOCKERD_ROOTLESS_ROOTLESSKIT_STATE_DIR=str(root / "runtime/rootlesskit"),
               DOCKERD_ROOTLESS_ROOTLESSKIT_NET="slirp4netns",
               DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER="builtin",
               DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS="")
    for name in ("DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKERD",
                 "_DOCKERD_ROOTLESS_CHILD", "ROOTLESSKIT_STATE_DIR", "VHS_PUBLISH"):
        env.pop(name, None)
    with (root / "daemon.log").open("w") as log:
        daemon = subprocess.Popen([
            "dockerd-rootless.sh", "--config-file=" + str(root / "daemon.json"),
            "--host=" + env["DOCKER_HOST"], "--data-root=" + str(root / "docker-data"),
            "--exec-root=" + str(root / "docker-exec"), "--pidfile=" + str(root / "docker.pid"),
            "--storage-driver=vfs", "--live-restore=false", "--bridge=none", "--iptables=false",
            "--ip6tables=false", "--ip-forward=false", "--ip-masq=false"],
            env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            def ready():
                if daemon.poll() is not None:
                    raise RuntimeError("Rootless Docker exited; inspect " + str(root / "daemon.log"))
                return daemon_info(env)
            info = until(ready, "private Docker readiness")
            if (not any("rootless" in item for item in info["SecurityOptions"])
                    or Path(info["DockerRootDir"]) != root / "docker-data"):
                raise RuntimeError("Docker isolation verification failed")
            with tarfile.open(root / "image.tar", "w") as archive:
                archive.add(busybox, arcname="bin/busybox", recursive=False)
            docker(env, "import", str(root / "image.tar"), "demo-site:local")
            docker(env, "run", "-d", "--name", "demo-web", "--network=none", "--restart=no",
                   "--stop-timeout=1", "--mount", f"type=bind,src={root / 'site'},dst=/site,readonly",
                   "demo-site:local", "/bin/busybox", "httpd", "-f", "-h", "/site", "-p", "8080")
            sandbox = ["bwrap", "--tmpfs", "/", "--unshare-user", "--unshare-pid",
                       "--unshare-ipc", "--unshare-uts", "--die-with-parent", "--new-session",
                       "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/run",
                       "--tmpfs", "/etc", "--bind", str(root), "/demo", "--bind", str(root), str(root),
                       "--ro-bind", str(REPO), "/repo",
                       "--ro-bind", str(root / "kida.toml"), "/etc/kida/kida.toml",
                       "--ro-bind", str(root / "docker.sock"), "/run/demo-docker.sock", "--clearenv"]
            for entry in ("/usr", "/bin", "/sbin", "/lib", "/lib64", "/opt", "/home", "/sys",
                          "/var/cache/fontconfig"):
                if Path(entry).exists():
                    sandbox += ["--ro-bind", entry, entry]
            for entry in ("fonts", "ssl", "passwd", "group", "nsswitch.conf", "hosts", "resolv.conf", "localtime"):
                path = Path("/etc") / entry
                if path.exists():
                    sandbox += ["--ro-bind", str(path), str(path)]
            isolated = {"PATH": "/demo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                        "HOME": "/demo/home", "LANG": "C.UTF-8", "TERM": "xterm-256color",
                        "DOCKER_HOST": "unix:///run/demo-docker.sock", "DOCKER_CONFIG": "/demo/home/.docker",
                        "KIDA_DEMO_DAEMON_ID": info["ID"], "VHS_NO_SANDBOX": "1",
                        "KIDA_DEMO_SCENES": json.dumps(selected),
                        "KIDA_DEMO_HOST_MNT": str(os.stat("/proc/self/ns/mnt").st_ino)}
            for key, value in isolated.items():
                sandbox += ["--setenv", key, value]
            subprocess.run([*sandbox, "--chdir", "/demo", "/usr/bin/python3",
                            "/repo/scripts/record-demo.py", "--inside"], check=True,
                           timeout=240 * len(selected))
            # Publish only after every execution and media check passes.
            results = json.loads((root / "validation.json").read_text())
            for scene, result in results.items():
                destination = REPO / "assets" / SCENES[scene][1]
                staging = destination.with_suffix(".gif.tmp")
                shutil.copyfile(root / "assets" / destination.name, staging)
                staging.replace(destination)
                print("Generated assets/" + destination.name + ": " + json.dumps(result), flush=True)
        finally:
            stop(daemon)
            if daemon_info(env):
                raise RuntimeError("Private daemon still responds; evidence preserved at " + str(root))
    # Logs and private data remain in the printed evidence directory for inspection.
    # No host Docker cleanup or broad filesystem removal is performed.


if __name__ == "__main__":
    try:
        main()
    except (KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print("Demo blocked: " + str(error), file=sys.stderr)
        sys.exit(1)
