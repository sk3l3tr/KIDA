# 02 · Catálogo de artefactos

**Objetivo:** identificar y verificar una copia concreta sin escanear ni incorporar backups anteriores.

**Estado:** Verificada con OK explícito del agente revisor. Las tareas 03–11 siguen pendientes.

## Trabajo

- Registrar metadatos mínimos de cada copia nueva al terminar su replicación, con destinos verificados, usando persistencia atómica existente y el contrato del catálogo.
- Incluir el UUID en el nombre nuevo y publicar destinos sin sobrescritura; conservar inmutables las versiones registradas aunque coincida la marca temporal.
- Resolver backup por ID/nombre y versión por `latest` o ID registrado. Fijar una identidad y checksum antes de devolver el resultado.
- Elegir un destino disponible y válido de esa misma copia; devolver errores observables ante registro ausente/corrupto, destino no disponible o checksum incorrecto.
- Mantener los errores actuales de destinos requeridos y de lifecycle de `backup.run`; registrar éxitos parciales no cambia su resultado.

## Frontera

Posee escritura/lectura del catálogo y resolución. Devuelve el artefacto resuelto descrito en [contratos](contratos.md). Consume `BackupJob`, replicación y SHA-256 actuales. No extrae, ejecuta Compose ni aplica la retención de informes al catálogo. No hay compatibilidad, importación ni migración histórica.

## Pruebas y cierre

Probar dos versiones creadas con la misma marca temporal, colisión de destino, desempate de `latest`, selección explícita, múltiples destinos y fallback entre réplicas de una misma copia. Cubrir checksum erróneo, archivos ausentes, registro corrupto y fallo de escritura de metadatos. Un fallo no debe presentar una copia no registrada como disponible.

Cierra cuando un backup nuevo deja un registro resoluble y ninguna selección devuelve una identidad distinta de la solicitada. Actualizar el índice con pruebas y cambios.

## Implementación

- `artifacts::ArtifactRepository` registra metadatos inmutables con destinos absolutos y resuelve `latest`/UUID comprobando tamaño y SHA-256. `BackupService::resolve_artifact` resuelve referencias por ID/nombre mediante la búsqueda no ambigua compartida con Health.
- `backup.run` añade UUID al nombre y publica copias verificadas sin sobrescritura. Los registros JSON reutilizan la escritura atómica técnica, ampliada con creación exclusiva. No se añaden dependencias ni comandos públicos.
- Éxitos parciales quedan registrados sin ocultar fallos requeridos. Un fallo de catálogo impide declarar éxito y conserva los archivos copiados; si coexisten errores, el requerido sigue siendo la causa principal. Los temporales propios se retiran al terminar.
- La publicación utiliza enlaces duros en el mismo directorio; los sistemas de archivos de targets y catálogo deben permitirlos. No se importa ni migra historial anterior.

## Validación y revisión

Con `CARGO_TARGET_DIR=/tmp/kida-health-target`:

- `cargo test -p kida-core --locked features::backup`: 44 correctas y un subproceso ignorado que se ejecuta desde sus pruebas padre.
- `cargo test -p kida-core --locked infrastructure::storage`: 7 correctas.
- `cargo test --workspace --locked --quiet`: 210 correctas, 13 ignoradas existentes, cero fallos; ejecutado con permiso para sockets locales.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` y `cargo fmt --all -- --check`: correctos.
- Casos cubiertos: misma marca temporal, colisiones concurrentes de catálogo, destinos existentes y symlinks preservados, tamaño/hash incorrectos, fallback entre réplicas, ausencia de fallback a otra versión, metadatos corruptos, ausencia de escrituras al consultar y fallos combinados de replicación/registro. Los tests de lifecycle y limpieza existentes se conservan.

Revisión independiente: agente `review_task02`. Revisó el código y la documentación completos, confirmó las seis pruebas del catálogo y `git diff --check`, y no encontró defectos accionables ni desviaciones de alcance. Dio OK explícito para commit; los únicos cambios posteriores son esta constancia y el estado del índice.
