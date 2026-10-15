mod lifecycle;
mod model;
mod ownership;
mod repository;
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
