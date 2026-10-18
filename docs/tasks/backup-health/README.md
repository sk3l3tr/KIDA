# Backup Health 0.0.4 · Guía de implementación

Fuente: especificación técnica del 16/10/2026 y decisiones acordadas durante su desglose. El índice distingue documentación, implementación y validación; las tareas pendientes no acreditan funcionalidad disponible.

Cada tarea corresponde a un agente y entrega un resultado acotado con pruebas propias. Leer primero [los contratos comunes](contratos.md). No hace falta repetir la auditoría ni reconstruir Docker, Scheduler, cola o worker.

## Seguimiento

| ID | Tarea | Estado | Implementación | Validación |
| --- | --- | --- | --- | --- |
| 01 | [Configuración y definiciones](01-config-definiciones.md) | Completa | [Configuración](../../../kida-core/src/infrastructure/conf/backup_health.rs), [cargador y tipos](../../../kida-core/src/features/backup/health/), commit `4b5b174` | [Pruebas y resultados](01-config-definiciones.md#validación-realizada) |
| 02 | [Catálogo de artefactos](02-catalogo-artefactos.md) | Completa | [Catálogo](../../../kida-core/src/features/backup/artifacts.rs), [replicación](../../../kida-core/src/features/backup/service.rs), commit `530f465` | [Pruebas y revisión](02-catalogo-artefactos.md#validación-y-revisión) |
| 03 | [Restauración segura](03-restauracion-segura.md) | Completa | [Extractor](../../../kida-core/src/features/backup/health/restore.rs), commit `4d23978` | [Pruebas y revisión](03-restauracion-segura.md#validación-y-revisión) |
| 04 | [Compose para Health](04-compose-health.md) | Completa | [Adaptador](../../../kida-core/src/features/backup/health/compose.rs), commit `80c1307` | [Pruebas y revisión](04-compose-health.md#validación-y-revisión) |
| 05 | [Diagnóstico](05-diagnostico.md) | Completa | [Evaluador](../../../kida-core/src/features/backup/health/diagnosis.rs), [evidencias](../../../kida-core/src/features/backup/health/evidence.rs), commit `3ad5cea` | [Pruebas y revisión](05-diagnostico.md#validación-y-revisión) |
| 06 | [Historial e informes](06-historial-informes.md) | Completa | [Repositorio](../../../kida-core/src/features/backup/health/history.rs), [informe](../../../kida-core/src/features/backup/health/report.rs), commit `e6269a2` | [Pruebas y revisión](06-historial-informes.md#validación-y-revisión) |
| 07 | [Ciclo de vida](07-ciclo-vida.md) | Completa | [Servicio](../../../kida-core/src/features/backup/health/service.rs), commit `2a93f35` | [Pruebas y revisión](07-ciclo-vida.md#implementación-y-revisión) |
| 08 | [Mantenimiento](08-mantenimiento.md) | Completa | [Mantenimiento](../../../kida-core/src/features/backup/health/maintenance.rs), commit `75ed0e9` | [Pruebas y revisión](08-mantenimiento.md#implementación-y-revisión) |
| 09 | [Protocolo y cola](09-protocolo.md) | Completa | [Handlers](../../../kida-core/src/exec/commands/backup/health.rs), commit `df6c64e` | [Pruebas y revisión](09-protocolo.md#implementación-y-revisión) |
| 10 | [CLI](10-cli.md) | Pendiente | — | — |
| 11 | [Integración y E2E](11-integracion-e2e.md) | Pendiente | — | — |

Estados: **Pendiente**, **En curso**, **Implementada**, **Verificada**, **Completa**, **Bloqueada**. Al implementar, enlazar archivos; al verificar, registrar comandos, resultados y revisión. Después del commit de implementación, marcar **Completa** y registrar su hash en el índice y en la tarea. Una tarea bloqueada debe identificar el impedimento. No marcar verificada solo porque compila ni confundir documentación terminada con funcionalidad terminada.

## Forma de trabajo

Las tareas 01–10 pueden desarrollarse y probarse por separado contra los contratos acordados, usando fixtures o dobles locales de prueba. Eso no significa que sus cambios compilen o funcionen juntos antes de integrar. No introducir interfaces de producción duplicadas ni un framework de mocks para simular independencia.

Cada tarea posee las interfaces indicadas en su documento; las otras las consumen. La 01 materializa los tipos compartidos de `contratos.md`; los demás bloques pueden preparar sus pruebas y componentes sin esperar a que se integre. Los cambios de contrato se actualizan aquí antes de modificar consumidores. La 11 depende de los componentes reales y cierra su integración, sin absorber funcionalidades pendientes.

## Cobertura de aceptación de la especificación

| Criterio | Tareas responsables |
| --- | --- |
| 1. Copia real y Compose sin modificar originales | 01, 02, 03, 04, 07, 11 |
| 2. Concurrencia entre definiciones y exclusión por definición | 07, 11 |
| 3. Modos asíncronos y TTL | 07, 08, 09, 10, 11 |
| 4. Cinco resultados y ausencia de healthchecks | 04, 05, 11 |
| 5. Limpieza exclusivamente de recursos propios | 03, 04, 07, 08, 11 |
| 6. Cierre y limpieza al arrancar KIDA | 06, 08, 11 |
| 7. Historial e informe incluso tras fallos | 05, 06, 07, 08, 11 |
| 8. Retención y jobs protegidos | 06, 08, 09, 11 |
| 9. Transportes y saturación de cola | 07, 08, 09, 10, 11 |
| 10. E2E Docker aislado y recursos ajenos intactos | 11 |

El resultado de la revisión documental se registra en [revision.md](revision.md).
