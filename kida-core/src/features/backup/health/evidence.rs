use crate::features::docker::ContainerLogs;

pub const TOTAL_LOG_BYTES: usize = 64 * 1024;
const EXCERPT_BYTES: usize = 16 * 1024;

/// Known literal values only. Publication of arbitrary logs is explicitly opt-in.
pub struct EvidencePolicy {
    secrets: Vec<String>,
    allow_logs: bool,
    remaining: usize,
}

impl EvidencePolicy {
    pub fn new(mut secrets: Vec<String>, allow_logs: bool) -> Self {
        secrets.retain(|secret| !secret.is_empty());
        secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
        secrets.dedup();
        Self {
            secrets,
            allow_logs,
            remaining: TOTAL_LOG_BYTES,
        }
    }

    pub fn text(&self, text: &str) -> String {
        prefix(&self.redact(text), 2048).to_owned()
    }

    fn redact(&self, text: &str) -> String {
        let mut safe = text.to_owned();
        for secret in &self.secrets {
            safe = safe.replace(secret, "[REDACTED]");
        }
        safe
    }

    pub fn logs(&mut self, logs: &ContainerLogs) -> Result<String, &'static str> {
        if !self.allow_logs {
            return Err("logs omitted: safe publication was not authorized");
        }
        if self.remaining == 0 {
            return Err("logs omitted: total evidence limit reached");
        }
        let stdout =
            std::str::from_utf8(&logs.stdout).map_err(|_| "logs omitted: invalid UTF-8")?;
        let stderr =
            std::str::from_utf8(&logs.stderr).map_err(|_| "logs omitted: invalid UTF-8")?;
        // Redact whole input before truncation, including secrets crossing a boundary.
        let safe = self.redact(&format!("stdout:\n{stdout}\nstderr:\n{stderr}"));
        let excerpt = prefix(&safe, self.remaining.min(EXCERPT_BYTES)).to_owned();
        self.remaining -= excerpt.len();
        Ok(excerpt)
    }
}

impl Default for EvidencePolicy {
    fn default() -> Self {
        Self::new(vec![], false)
    }
}

fn prefix(text: &str, limit: usize) -> &str {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
