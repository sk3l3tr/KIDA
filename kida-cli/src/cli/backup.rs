use clap::Subcommand;

#[derive(Debug, Subcommand, PartialEq, Eq)]
pub enum BackupCommand {
    List,
}
