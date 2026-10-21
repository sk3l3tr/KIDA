# Terminal demo

From the workspace root, run:

```sh
python3 resources/scripts/record-demo.py
```

Generate the focused demos together, or select a single name:

```sh
python3 resources/scripts/record-demo.py --demo scheduler backup-run backup-health
python3 resources/scripts/record-demo.py --demo backup-health
```

`--demo all` also regenerates the original overview. If Chromium is outside
PATH, prefix the command with `CHROME_BIN=/path/to/chromium`.

| Tape | GIF | Recorded flow |
|---|---|---|
| `demo.tape` | `demo.gif` | Original container and backup overview |
| `resources/demos/scheduler.tape` | `scheduler.gif` | Inspect a TOML definition, add it, list the resulting schedule |
| `resources/demos/backup-run.tape` | `backup-run.gif` | Inspect a TOML job, create it, queue its backup |
| `resources/demos/backup-health.tape` | `backup-health.gif` | Start an isolated restoration, inspect restored data and diagnosis, delete its environment |

Requires Linux with unprivileged user namespaces, Rust/Cargo, Python 3, VHS
0.12.1, FFmpeg/ffprobe, ttyd, Bubblewrap, Docker with rootless support,
RootlessKit, `newuidmap`/`newgidmap`, slirp4netns, static BusyBox, and Fira Code.
Configure subordinate UID/GID ranges for your user. Set `CHROME_BIN` to an
existing Chromium executable if it is not on PATH. The runner installs nothing
and imports its tiny demo image from local BusyBox without a registry download.

The runner builds the real binaries, starts a disposable rootless Docker daemon,
and records the selected tapes in a private filesystem. It verifies the recorded
schedule through CORE, completed backup archives through their SHA-256, and
Backup Health through its real state and resource cleanup. The CLI's queue
acknowledgement does not claim backup completion.

KIDA has no standalone `backup restore` or `lifecycle` CLI commands. The Health
demo uses `backup health start`, `get`, and `delete`. Its real backup and CREATED
manual run are prepared before recording; `$run_id` and `$restore_dir` identify
that run. A hidden, bounded wait verifies HEALTHY and restored file contents
before they appear. Visible `sed` commands select diagnosis fields from the
actual CLI output. After delete, the runner verifies COMPLETED cleanup, absence
of the restored directory, and preservation of the pre-existing demo container.
The original sample data remains unchanged. No additional Docker-cycle demo is
generated.

Each GIF uses a dark theme, 1000×560 pixels, and 20 fps. Generation fails unless
duration is 15–25 seconds, size is at most 3 MiB, every frame decodes, and looping
is enabled. Inspect representative frames for clipping and readability before
publishing. The runner prints a temporary evidence directory containing logs,
the backup, the candidate GIF, and `validation.json`. It stops its own daemon;
evidence is preserved for inspection and is not committed.

Do not run the tapes directly with `vhs`: their required guard and private session are
supplied by the runner. Missing prerequisites or failed isolation stop recording;
the host agent and Docker daemon are never used as a fallback.

The [root README](../../README.md) embeds the overview and focused previews using
relative Markdown image paths and descriptive alt text. GitHub serves them from
the same revision. Actual GitHub rendering can be checked only after the GIFs
and README are published.
