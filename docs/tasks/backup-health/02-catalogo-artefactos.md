# 02 · Catálogo de artefactos

**Objetivo:** identificar y verificar una copia concreta sin escanear ni incorporar backups anteriores.

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
