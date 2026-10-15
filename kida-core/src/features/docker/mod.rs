#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker capability retained for production integration; covered by tests"
    )
)]
mod diagnostics;
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker capability retained for production integration; covered by tests"
    )
)]
mod lifecycle;
mod model;
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker capability retained for production integration; covered by tests"
    )
)]
mod ownership;
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Docker capability retained for production integration; covered by tests"
    )
)]
mod repository;
#[allow(
    unused_imports,
    reason = "Retain the Docker ownership interface for callers"
)]
pub use ownership::{ManagedProject, RemovalReport, ResourceOutcome};
mod service;

pub use lifecycle::ComposeOptions;
pub use model::{ComposeProject, ComposeService, ComposeVersion};
pub use model::{DockerContainer, DockerContainers, DockerNetwork, DockerPort};
pub use service::DockerService;

#[cfg(test)]
pub(crate) mod tests;

#[cfg(test)]
mod lifecycle_tests;

pub use model::{
    ComposeContainerDiagnostics, ComposeDiagnostics, ContainerDiagnosticError,
    ContainerDiagnostics, ContainerLogs,
};

#[cfg(test)]
mod diagnostics_tests;
