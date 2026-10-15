# Changelog

## 0.0.4 — CLI input refactoring

- Encapsulate `PreparedCommand` behind a private representation constructed by
  `input::prepare`. Remove direct Clap-to-request `From` conversions; internal
  domain mappers return errors when commands requiring preparation reach them.
  Request construction and serialization remain in the mapper.
- Share file, parameter, and wizard mode execution between backup creation and
  scheduler creation, including the interactive-terminal requirement. Incomplete
  flags still fail locally without opening the wizard or contacting CORE.
- Build backup configuration DTOs directly from flags, applying indexed
  assignments to typed targets and lifecycle commands. Preserve defaults, literal
  paths and whitespace, arbitrary JSON parameters, and contextual errors.
  Explicit JSON `null` in backup schedule metadata still means no metadata.
- Add `fields::ask_validated` and use it for `powercicle` wake times and seconds.
  It delegates reading to `ask`, retries validator failures, and immediately
  propagates cancellation and input/output errors.

Command syntax, request payloads, and exit codes remain unchanged. No dependencies,
CORE changes, or protocol changes are introduced.

Validation covers mode equivalence, indexed assignments, defaults and JSON `null`,
direct-mapping rejection, wizard retries and cancellation, write failures, local
errors, and UNIX socket requests. Checks: `cargo fmt -p kida-cli --check`,
`cargo test -p kida-cli`, `cargo clippy -p kida-cli --all-targets`, and
`git diff --check`, using `CARGO_TARGET_DIR=/tmp/kida-cli-target` for builds.
Socket tests require an environment that permits binding UNIX sockets.
