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

### Simplifica la gestión de tu servidor doméstico

Gestiona Docker, backups, tareas programadas y operaciones del sistema desde una sola herramienta.

![Platform](https://img.shields.io/badge/platform-Linux-blue)
![Built with Rust](https://img.shields.io/badge/built_with-Rust-red)

</div>

---

## .✦ ݁˖ Por qué KIDA

Gestionar servidores no debería exigir combinar scripts, cron y comandos sin fin. **KIDA reúne Docker, backups, tareas programadas y operaciones del sistema en un agente autoalojado.** Controla tu infraestructura desde la terminal o intégrala con tus herramientas.

> Menos trabajo manual. Más control. Tu infraestructura, tus reglas.

## .✦ ݁˖ Capacidades

**Un agente para gestionar tus servidores.**

|     | Capacidad                  | Qué permite hacer                                                             |
| --- | -------------------------- | ----------------------------------------------------------------------------- |
| 🐳  | **Gestión de Docker**      | Listar, iniciar, detener, reiniciar y eliminar contenedores.                  |
| 💾  | **Gestión de backups**     | Configurar, gestionar y ejecutar backups.                                     |
| 🕒  | **Programación de tareas** | Automatizar operaciones recurrentes.                                          |
| 🖥️  | **Control del sistema**    | Consultar salud y hardware, reiniciar y apagar.                               |
| 🔌  | **CLI & HTTP**             | Utilizar CLI mediante Unix socket o enviar JSON directamente por HTTP/socket. |
| 🏠  | **Autoalojado y ligero**   | Agente nativo en Rust que funciona en tu infraestructura, bajo tu control.    |

## .✦ ݁˖ KIDA en acción

<div align="center">

Define orígenes y destinos, registra la configuración y ejecuta el backup cuando lo necesites.
![KIDA creando una configuración de backup desde TOML y encolando su ejecución](resources/assets/backup-run.gif)

\>< >< >< ><

Backup Health restaura un backup guardado en un entorno independiente.
![KIDA restaurando datos aislados, comprobando su salud y limpiando el entorno](resources/assets/backup-health.gif)

\>< >< >< ><

Añade una programación y consulta cuándo intentará encolar trabajo.
![KIDA programando un backup diario y mostrando su regla y próximo intento de encolado](resources/assets/scheduler.gif)

\>< >< >< ><

Consulta contenedores, reinicia un servicio y encola un backup desde la misma CLI.
![KIDA listando contenedores, reiniciando uno de ejemplo y encolando un backup](resources/assets/demo.gif)

</div>

## .✦ ݁˖ Documentación

[English](README.md) · [Toda la documentación](resources/docs/index.md)

Empieza por la [instalación](resources/docs/es/001-installation.md) y la
[guía de uso general](resources/docs/es/002-usage-overview.md).

## .✦ ݁˖ Licencia

Este repositorio no incluye actualmente un archivo de licencia ni condiciones de licencia en los manifiestos de sus paquetes.
