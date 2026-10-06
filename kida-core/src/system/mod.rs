mod collector_service;
mod model;
mod reboot_service;
mod shutdown_service;
mod system_info_service;

pub use shutdown_service::{ShutdownResult, ShutdownService};

pub use collector_service::SystemCollectorService;
pub use reboot_service::{RebootResult, RebootService};
pub use system_info_service::SystemInfoService;
