# 06 · Historial e informes

**Objetivo:** conservar trazabilidad consultable después de eliminar Docker.

## Trabajo

- Persistir JSON de ejecución y Markdown por `run_id`, usando los tipos compartidos y escrituras atómicas existentes por archivo.
- Proporcionar guardar/consultar/listar ejecuciones y listar/obtener/eliminar informes. La eliminación individual del Markdown conserva el historial y deja constancia para no recrearlo por conciliación.
- Generar el informe con evidencias capturadas antes del borrado y resultado del intento de limpieza; incluir la advertencia de validación funcional por el administrador.
- Conciliar cierres parciales entre JSON y Markdown con los datos estructurados, sin asumir transacciones entre archivos ni sobrescribir registros corruptos silenciosamente.

## Frontera

Posee representación persistente, repositorios de dominio, renderizado Markdown y conciliación. Consume instantáneas de ejecución/evidencias/limpieza mediante fixtures. 07 ordena cierres y 08 invoca conciliación/retención. No añade políticas de backup a `Storage<T>`, llama Docker ni decide cuándo caduca un run. Ver [contratos](contratos.md).

## Pruebas y cierre

Probar roundtrip y listado; cierre exitoso y fallido; error entre las dos escrituras; reconstrucción posterior; historial corrupto; informe eliminado voluntariamente y ausencia de secretos conocidos. Verificar informe definitivo solo tras conocer el intento de limpieza.

Cierra cuando una ejecución fallida deja información recuperable y borrar su informe no borra ni altera indebidamente el historial. Actualizar el índice.

## Implementación

`health::history::ExecutionRepository` proporciona `save/get/list`, `finish`, `report_list/get/delete` y `reconcile`. Usa JSON por ejecución y Markdown separado. `HealthHistoryRecord` añade al snapshot plano `record_version`, `restore_provenance` y `report_status` (`PENDING`, `READY`, `DELETED`). No necesita un índice adicional ni importa registros antiguos.

`save` conserva estados parciales sin informe definitivo. `finish` exige ejecución cerrada (`STOPPED`/`ERROR`), fecha final e intento de limpieza (`COMPLETED`/`ERROR`); guarda primero el JSON y después genera Markdown. Un fallo del segundo paso deja los datos para reconstruirlo. La conciliación repara informes ausentes/desactualizados y reintenta borrados, sin reescribir documentos ya coincidentes; informa registros corruptos y continúa con los otros. No sobrescribe un JSON corrupto ni sigue symlinks de historial.

El borrado de informe guarda primero `DELETED`; conserva el historial, fecha final y procedencia, y no se revierte al volver a cerrar o conciliar. La procedencia del directorio restaurado se conserva al actualizar y no puede reemplazarse por otra identidad. 07 debe serializar operaciones conflictivas por run y 08 invocará conciliación y retención; este bloque no decide caducidad, cambia recursos ni inicia servicios.

La persistencia reutiliza `EvidencePolicy`: redacción de motivos/logs con valores conocidos y límites por ejecución; logs omitidos por defecto. La política no se persiste. El informe presenta copia concreta, tiempos/duración, Compose, servicios/imágenes, resultados, anomalías/evidencias, recursos y limpieza, con advertencia de validación funcional. Escapa metadatos Markdown y usa un delimitador de código más largo que los presentes en cada log.

## Validación y revisión

Pruebas focalizadas: roundtrip/procedencia/listados y consultas sin crear directorios, orden cronológico estable, cierre exitoso/fallido y pendiente de limpieza, error entre escrituras y recuperación tras reinicio, informe ausente/desactualizado, historial corrupto, borrado con fallo de unlink y marca persistente, IDs/versión/fechas inválidos, identidad de directorio inmutable, symlink de historial preservado y límites/redacción de logs.

- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test -p kida-core --locked health::history`: 10 correctas.
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo test --workspace --locked --quiet`: 241 correctas, 14 ignoradas existentes; fuera del sandbox para permitir sockets.
- `CARGO_TARGET_DIR=/tmp/kida-health-target cargo clippy --workspace --all-targets --locked -- -D warnings`, formato y comprobaciones de diff: correctos. Sin dependencias nuevas ni cambios en `Cargo.lock`.
- Revisión independiente de `review_task06`: diez pruebas ejecutadas, diff y documentación revisados; sin defectos accionables. También se prueba que el motivo de omisión de logs respete el límite de descripción de 2 KiB.

Estado: **Completa**. Commit de implementación: `e6269a2`.
