use std::process::{Command, Stdio};

#[test]
fn local_input_errors_exit_one_without_stdout_or_transport_error() {
    for args in [
        vec!["--name", "daily"],
        vec!["-f", "/missing/kida-input.toml"],
        vec!["--file", "file", "--name", "daily"],
        vec![],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_kida-cli"))
            .args(["backup", "config", "create"])
            .args(&args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{args:?}");
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(!error.is_empty());
        assert!(!error.contains("agent is not running"));
        assert!(!error.contains("Unable to communicate"));
    }
}

#[test]
fn scheduler_local_errors_have_no_stdout_or_transport_errors() {
    for args in [
        vec![],
        vec!["--command", "x"],
        vec!["-f", "/missing/schedule.toml"],
        vec!["--file", "file", "--seconds", "1"],
        vec!["--command", "x", "--params", "{", "--seconds", "1"],
        vec![
            "--command",
            "x",
            "--params",
            "null",
            "--at",
            "future",
            "--seconds",
            "1",
        ],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_kida-cli"))
            .args(["scheduler", "add"])
            .args(&args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{args:?}");
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(!error.is_empty());
        assert!(!error.contains("agent is not running"));
        assert!(!error.contains("Unable to communicate"));
    }
}

#[test]
fn health_errors_preserve_usage_and_input_exit_codes_without_transport() {
    for (args, exit_code) in [
        (vec!["create"], 2),
        (vec!["create", "--file", "x"], 2),
        (vec!["run"], 2),
        (vec!["get"], 2),
        (vec!["report", "get"], 2),
        (vec!["list", "--json"], 2),
        (vec!["create", "--file", "x", "--mode", "bad"], 1),
        (vec!["create", "--file", "", "--mode", "manual"], 1),
        (vec!["run", "--file", " "], 1),
        (vec!["get", "--run-id", "bad"], 1),
        (vec!["report", "delete", "--run-id", "bad"], 1),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_kida-cli"))
            .args(["backup", "health"])
            .args(&args)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(exit_code), "{args:?}");
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(!error.is_empty());
        for unexpected in [
            "agent is not running",
            "Unable to communicate",
            "Permission denied",
            "interactive terminal",
        ] {
            assert!(!error.contains(unexpected), "{error}");
        }
    }
}
