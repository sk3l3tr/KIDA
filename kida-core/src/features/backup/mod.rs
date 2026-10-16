pub mod error;
#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "Health definition loading and shared contracts await lifecycle integration"
    )
)]
pub mod health;
pub mod model;
pub mod repository;
pub mod service;

#[cfg(test)]
pub(crate) mod tests;
