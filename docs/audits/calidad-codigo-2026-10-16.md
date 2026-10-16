# Tareas pendientes de calidad de código de KIDA

Revisión del listado: 2026-10-16. La depuración inicial parte de `44d9aac`; las tareas completadas posteriormente se retiran tras su validación y revisión independiente.

## Criterio y depuración

Este documento contiene únicamente trabajo pendiente con un beneficio concreto. Las tareas implementadas y sus verificaciones se consultan en el historial Git.

Se han eliminado Q01–Q08, la tarea conjunta Q10/Q11 y Q12–Q13 por estar completadas. Se mantienen los identificadores originales para conservar las referencias de las conversaciones y commits.

Se retira Q09 como tarea independiente: el registro de comandos ya está centralizado en el catálogo de Q01 y la recuperación del lifecycle está cubierta por Q03. Persisten llamadas desde features al ejecutor, pero no se ha identificado un defecto adicional que justifique introducir otra operación compartida o mecanismo de inyección. La dirección de una dependencia, por sí sola, no justifica ampliar esta limpieza.

## Resumen

| ID | Prioridad | Trabajo pendiente | Beneficio |
| --- | --- | --- | --- |
| Q14 | Baja | Explicitar el resolver actual del workspace | Eliminar el aviso sin cambiar la resolución de dependencias |

## Q14. Resolver explícito sin migración

**Evidencia actual.** El [manifiesto raíz](../../Cargo.toml) no declara resolver. Cargo avisa de que el workspace virtual usa `resolver = "1"`, aunque ambos paquetes declaran Rust 2024. El aviso no demuestra un defecto funcional.

**Cambio acotado.** Declarar `resolver = "1"` para expresar la conducta existente. Migrar al resolver 3 o actualizar dependencias queda fuera de esta tarea: no es necesario para eliminar el aviso.

**Aceptación.** Ejecutar tests y build del workspace con `--locked`, comprobar que desaparece el aviso y que `Cargo.lock` no cambia. No modificar versiones, features ni el toolchain del workflow.

## Reglas para las siguientes iteraciones

- Trabajar una tarea cada vez, con sus pruebas relevantes y revisión independiente antes del commit. El orden del resumen mantiene la continuidad del flujo; las tareas no dependen unas de otras.
- Conservar CLI → input → mapper → client → renderer, renderers sin impresión y configuración global inicializada una sola vez.
- Conservar las políticas de cola, exclusión de backups y admisión/persistencia del scheduler, así como los controles de ownership, deadlines y limpieza de procesos Docker.
- Mantener la representación de JSON libre en TOML; no añadir migraciones ni gestionar archivos heredados del administrador.
- No añadir funcionalidades ni abstracciones para satisfacer una preferencia arquitectónica sin un problema concreto. Tras cada cambio aprobado, retirar su tarea de este listado; el historial Git conserva la evidencia.
