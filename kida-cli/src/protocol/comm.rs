use std::process::ExitCode;

pub struct ResponseResult {
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: ExitCode,
}
