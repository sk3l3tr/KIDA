
# Repository Guidelines

## Project Structure

KIDA is a Rust 2024 workspace:

- `kida-core/`: Server agent. `features/` contains backup, Docker, scheduler and system services; `exec/` handles commands and workers; `infrastructure/` provides configuration, storage and transports.
- `kida-cli/`: CLI client following `cli → input → mapper → client → renderer`.
- Tests live alongside modules (`tests.rs`, `*_tests.rs`) and in `kida-cli/tests/`. Backup fixtures live in `tests/fixtures/` and `testdata/backup/`.
- `.forgejo/workflows/release.yml` handles releases; `install.sh` installs binaries.

## Build & Validation

Run from the workspace root:

- `cargo build --workspace`
- `cargo test --workspace`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets`
- `cargo build --release --locked` for release validation.

Run checks relevant to the changes. Expand validation only when necessary.

## Engineering Principles

- Apply Pareto (80/20): prioritize essential functionality and the smallest effective solution.
- Write concise, clean, functional and human-readable code.
- Prefer simple, explicit, idiomatic Rust over clever syntax, complex abstractions or advanced language/library features.
- Use advanced constructs only when their benefits clearly justify the complexity.
- Follow existing architecture, naming conventions and patterns.
- Keep functions focused and control flow straightforward.
- Reuse existing dependencies; avoid unnecessary layers, boilerplate and speculative extensibility.
- Preserve correctness, security and maintainability. Never sacrifice them for brevity.

## Architecture Rules

- CLI handles input, flags, mapping and presentation; CORE handles execution through protocol requests.
- Renderers return output; the CLI entry point controls printing and exit codes.
- Initialize CORE configuration once before runtime services. Configuration changes require restart.
- CORE uses `/etc/kida/kida.toml`; default endpoints are `127.0.0.1:8989` and `/tmp/kida.sock`.

## Development Workflow

- Work autonomously within the requested scope.
- Preserve compatibility and unrelated local changes.
- Add focused tests for changed behavior and relevant failure cases.
- Avoid unrelated refactoring and unnecessary dependencies.
- Update documentation when public interfaces or configuration change.
- Never commit credentials or generated artifacts.
- Follow commit format: `version > type(scope): description`.
- Keep responses brief. Summarize changes, validation and unresolved issues.
- Before completion, review the diff for duplicated logic, unnecessary complexity and unrelated changes.
- Never remove, weaken or bypass tests or validation checks to make a change pass. Report unresolved failures.
