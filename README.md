<div align="center">

```
887    d8P  8888888 8888888b.        d8888
887   d8P     888   888  "Y88b      d88888
887  d8P      888   888    888     d88P888
887d88K       888   888    888    d88P 888
8888887b      888   888    888   d88P  888
887  Y88b     888   888    888  d88P   888
887   Y88b    888   888  .d88P d8888888888
887    Y88b 8888888 8888888P" d88P     888
```

### Simplify your home server operations

Manage Docker, backups, scheduled tasks and system operations from a single tool.

![GitHub Release](https://img.shields.io/github/v/release/OWNER/REPO)
![License](https://img.shields.io/github/license/OWNER/REPO)
![Platform](https://img.shields.io/badge/platform-Linux-blue)
![Built with Rust](https://img.shields.io/badge/built_with-Rust-red)

</div>

---

## .✦ ݁˖ Why KIDA

Managing servers shouldn't mean juggling scripts, cron jobs, and endless commands.**KIDA brings Docker, backups, scheduled tasks, and system operations together in one self-hosted agent.** Control your infrastructure from the terminal or integrate it with your own tools.

> Less manual work. More control. Your infrastructure, your rules.

## .✦ ݁˖ Capabilities

**One agent. Everything you need to manage your servers.**

|     | Capability                    | What it does                                                                 |
| --- | ----------------------------- | ---------------------------------------------------------------------------- |
| 🐳  | **Docker Management**         | List, start, stop, restart, and remove containers.                           |
| 💾  | **Backup Management**         | Configure, manage, and execute backup jobs.                                  |
| 🕒  | **Task Scheduling**           | Automate recurring operations with scheduled jobs.                           |
| 🖥️  | **System Control**            | Monitor system health, inspect hardware, reboot, and shut down.              |
| 🔌  | **CLI & HTTP**                | Manage your servers from the terminal or integrate KIDA with your own tools. |
| 🏠  | **Self-Hosted & Lightweight** | A native Rust agent running on your infrastructure, under your control.      |

## .✦ ݁˖ KIDA in action

<div align="center">

Define your sources and destinations, register the job, and run it on demand.
![KIDA creating a backup job from TOML and queuing its execution](resources/assets/backup-run.gif)

\>< >< >< ><

Backup Health restores a saved backup into a separate environment.
![KIDA restoring isolated data, checking its health and cleaning up the environment](resources/assets/backup-health.gif)

\>< >< >< ><

Add a schedule and inspect when it will next submit work.
![KIDA adding a daily backup schedule and displaying its rule and next enqueue time](resources/assets/scheduler.gif)

\>< >< >< ><

Inspect your containers, restart a servicxe, and queue a backup from the same CLI.
![KIDA listing containers, restarting a demo container, and queuing a backup](resources/assets/demo.gif)

</div>

## .✦ ݁˖ Documentation

Everything you need to get the most out of KIDA.

- 📖 **[Documentation](./docs/)** — Installation, configuration, and usage guides.
- 💻 **[CLI Reference](./docs/cli.md)** — Commands, parameters, and examples.
- 🔌 **[API Reference](./docs/api.md)** — Protocols and integrations.

## .✦ ݁˖ License

See the [LICENSE](./LICENSE) file for licensing terms.
