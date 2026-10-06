# KIDA-CORE Backup System Specification

## Objetivo

KIDA-CORE debe proporcionar un sistema de backup basado en copia consistente de archivos y directorios.

Cada backup genera un único artefacto comprimido a partir de una o varias rutas origen y lo replica en uno o varios destinos configurados.

KIDA no debe aplicar tratamientos específicos según extensión o tipo de archivo. Bases de datos SQLite, archivos SQL, configuraciones, binarios y cualquier otro fichero deben tratarse como datos ordinarios.

La consistencia debe obtenerse controlando los procesos que pueden modificar los datos durante el backup.

---

## Backup Job

Un `BackupJob` define:

```text
id
name
sources[]
targets[]
compression
lifecycle
schedule?
retention?
```

---

## Sources

`sources` contiene una o varias rutas absolutas de archivos o directorios.

Ejemplo:

```text
/etc/nextcloud
/mnt/storage/nextcloud
/home/user/containers/nextcloud
```

Todas las rutas deben existir antes de iniciar el backup.

Si una ruta requerida no existe, la ejecución falla.

KIDA no debe inspeccionar ni modificar el contenido de los ficheros incluidos.

---

## Consistencia del backup

El backup debe realizarse mientras los procesos responsables de modificar los datos estén detenidos cuando así lo requiera el `BackupJob`.

El flujo debe ser:

```text
estado normal
    ↓
pre-backup operations
    ↓
datos sin modificaciones
    ↓
crear backup
    ↓
post-backup operations
    ↓
estado normal
```

Esto permite copiar de forma consistente:

```text
SQLite
bases de datos almacenadas como ficheros
datos de aplicaciones
Docker volumes
configuraciones
cualquier otro fichero
```

sin introducir lógica específica para cada formato.

---

## Lifecycle Operations

Cada `BackupJob` puede definir operaciones que deben ejecutarse antes y después del backup.

```text
lifecycle:
    pre_backup[]
    post_backup[]
```

### pre_backup

Se ejecutan antes de leer cualquier archivo del backup.

Su finalidad principal es detener servicios o procesos que puedan modificar los datos.

Ejemplo conceptual:

```text
pre_backup:
    stop nextcloud container
```

### post_backup

Se ejecutan después de finalizar el acceso a los datos origen.

Su finalidad principal es restaurar el estado operativo previo.

Ejemplo conceptual:

```text
post_backup:
    start nextcloud container
```

La forma concreta de representar y ejecutar estas operaciones queda fuera de esta especificación hasta definir los comandos disponibles en KIDA-CORE.

---

## Garantía de recuperación

Las operaciones `post_backup` deben ejecutarse aunque falle:

```text
la compresión
la lectura de archivos
la escritura temporal
la copia a destinos
la verificación
```

El comportamiento debe ser equivalente conceptualmente a:

```text
pre_backup

try:
    backup
finally:
    post_backup
```

KIDA no debe dejar intencionadamente detenido un servicio debido a un fallo durante el backup.

Si una operación `post_backup` falla, el error debe registrarse explícitamente.

---

## Fallo de operaciones pre-backup

Si cualquier operación `pre_backup` requerida falla:

```text
→ no iniciar copia
→ ejecutar las operaciones de recuperación necesarias
→ marcar ejecución como FAILED
```

Nunca debe generarse deliberadamente un backup potencialmente inconsistente después de fallar una operación requerida para detener escritores.

---

## Artefacto

Cada ejecución genera un único archivo comprimido.

Formato inicial:

```text
tar + zstd
```

Convención recomendada:

```text
<job-name>-<timestamp>.tar.zst
```

Ejemplo:

```text
nextcloud-2026-10-06T03-00-00.tar.zst
```

El artefacto debe generarse una sola vez.

Después debe copiarse a todos los destinos disponibles.

Cada artefacto debe tener asociado un checksum.

---

## Backup Targets

Cada destino define:

```text
path
required
filesystem_uuid?
```

### Required

```text
required = true
```

Debe completarse correctamente para considerar exitoso el backup.

### Optional

```text
required = false
```

Su ausencia o indisponibilidad no invalida el backup.

Ejemplo:

```text
/mnt/storage/backups
required = true

/mnt/external/backups
required = false
```

---

## Validación de destinos

La existencia del directorio no es suficiente cuando el destino corresponde a otro filesystem.

Si se especifica `filesystem_uuid`, KIDA debe comprobar:

```text
filesystem correcto
filesystem montado
path accesible
permiso de escritura
```

KIDA no debe escribir en el directorio de montaje local si el filesystem esperado no está montado.

---

## Ejecución

Una ejecución debe seguir estrictamente este orden:

```text
1. Validar sources.
2. Resolver y validar targets.
3. Ejecutar pre_backup.
4. Crear artefacto comprimido temporal.
5. Calcular checksum.
6. Finalizar acceso a los sources.
7. Ejecutar post_backup.
8. Copiar artefacto a cada target disponible.
9. Verificar cada copia.
10. Registrar resultado por target.
11. Aplicar retención.
12. Eliminar artefacto temporal.
```

Los servicios deben permanecer detenidos únicamente durante el tiempo necesario para obtener el artefacto consistente.

No deben permanecer detenidos mientras se replica el artefacto hacia distintos destinos.

---

## Resultado por destino

Estados:

```text
OK
FAILED
SKIPPED
UNAVAILABLE
```

### OK

Artefacto copiado y verificado.

### FAILED

Destino disponible, pero copia o verificación fallida.

### SKIPPED

Destino opcional omitido.

### UNAVAILABLE

Destino configurado pero no disponible.

---

## Resultado global

Estados:

```text
SUCCESS
FAILED
```

Reglas:

```text
pre_backup falla
→ FAILED

creación del artefacto falla
→ FAILED

post_backup falla
→ FAILED

algún target required no termina en OK
→ FAILED

todos los targets required terminan en OK
→ SUCCESS

fallo o ausencia de target optional
→ no invalida por sí mismo el backup
```

---

## Backup manual

Cualquier `BackupJob` debe poder ejecutarse manualmente.

La ejecución manual debe utilizar exactamente el mismo lifecycle, validaciones, retención y targets que una ejecución programada.

---

## Scheduling

Un `BackupJob` puede tener un schedule asociado.

Debe permitirse:

```text
crear
modificar
eliminar
activar
desactivar
```

El mecanismo interno de scheduling queda fuera de esta especificación.

---

## Restore Points

Cada backup creado correctamente genera un `RestorePoint`.

Debe almacenar como mínimo:

```text
id
backup_job_id
created_at
artifact_name
checksum
size
target_results[]
```

KIDA debe permitir listar los restore points disponibles.

---

## Eliminación

Debe poder eliminarse un restore point concreto.

La eliminación debe intentarse sobre todas las copias conocidas.

Un fallo sobre un destino no debe ocultar el resultado de los demás.

---

## Retención

Un `BackupJob` puede definir:

```text
max_age
keep_last
protected_restore_points[]
```

### max_age

Elimina restore points que superen la antigüedad configurada.

### keep_last

Conserva siempre como mínimo los últimos `N`.

### protected_restore_points

Impide la eliminación automática de restore points concretos.

Las excepciones tienen prioridad sobre cualquier política automática.

---

## Backups múltiples

Un artefacto puede almacenarse en múltiples destinos:

```text
sources
   ↓
artifact.tar.zst
   ├── disco secundario requerido
   └── disco externo opcional
```

Los destinos son independientes.

La indisponibilidad de un destino opcional no debe bloquear los destinos requeridos.

---

## Ejemplo conceptual: Nextcloud

```text
BackupJob: nextcloud

sources:
    Nextcloud data
    configuración
    datos persistentes necesarios

pre_backup:
    detener contenedor Nextcloud

backup:
    generar nextcloud-<timestamp>.tar.zst

post_backup:
    arrancar contenedor Nextcloud

targets:
    disco secundario     required
    disco USB externo    optional
```

KIDA no necesita conocer qué archivos pertenecen a SQLite, bases de datos, configuración o almacenamiento de Nextcloud.

La responsabilidad del `BackupJob` es garantizar que los procesos que escriben sobre esos datos estén detenidos durante la captura.

---

## Fuera de alcance inicial

No forman parte de esta implementación:

```text
imágenes completas de disco
snapshots de filesystem
incrementales
diferenciales
deduplicación
S3
SSH/SFTP
tratamiento específico por tipo de base de datos
restauración automática
cifrado
```

---

## Principios de diseño

El sistema debe mantener separadas estas responsabilidades:

```text
qué se copia
qué debe detenerse antes
qué debe recuperarse después
dónde se copia
cuándo se copia
cuánto tiempo se conserva
```

El backup debe tratar el conjunto de `sources` como una unidad consistente.

KIDA no debe introducir comportamiento diferente en función del tipo o extensión de los archivos incluidos.
