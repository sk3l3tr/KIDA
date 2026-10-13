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
