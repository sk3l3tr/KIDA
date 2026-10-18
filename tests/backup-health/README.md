# Backup Health: integración y aceptación

Ejecutar desde la raíz del workspace. Requiere Linux, Rust/Cargo y Python 3 con
biblioteca estándar; no instala paquetes ni modifica `/etc/kida`.

## Integración con Docker simulado

```bash
python3 tests/backup-health/run.py --simulated
```

Compila los ejecutables de tests CORE/CLI con `--locked` y arranca un proceso CORE
exclusivo para cada caso, con configuración, HTTP local y socket Unix temporales.
Usa los handlers, worker, cola, Scheduler, persistencia, backup y restaurador reales.
Solo las respuestas del ejecutable Docker son simuladas. La CLI recorre
`cli → input → mapper → client → renderer` mediante un `KidaClient` con ese socket;
no usa el endpoint predeterminado ni añade opciones públicas.

Comprueba los flujos manual y automático por HTTP, socket y CLI; copia registrada,
datos restaurados y originales intactos; cupo/exclusión/concurrencia; cinco
resultados técnicos; diagnóstico parcial; parada/borrado e informes; retención
con limpieza pendiente y reintento; saturación de cola/schedules; protección del
mantenimiento; reinicio real del proceso fixture sobre la misma persistencia.
TTL y retención reciben tiempo controlado mediante stdin privado del fixture,
sin alterar el reloj ni exponer operaciones administrativas públicas. El timer
no se arranca en este fixture: los ticks se invocan explícitamente para hacer
reproducible la saturación.

`cargo test --workspace --locked` incluye la variante CORE con HTTP/socket y sin
la prueba CLI contra backend vivo. El comando anterior ejecuta también esa
prueba CLI, marcada `ignore` porque necesita el fixture orquestado. El servidor
hijo ignorado solo se ejecuta desde el driver y exige su marcador de entorno.

## Aceptación con Docker real aislado

```bash
python3 tests/backup-health/run.py --real
```

`--real` autoriza crear y detener **un daemon rootless nuevo y desechable**. No
acepta un endpoint externo ni recurre al daemon habitual. Requiere Docker CLI,
Compose, `dockerd-rootless.sh`, rootlesskit, sus utilidades de mapeo UID/GID
(`newuidmap`/`newgidmap`), rangos subordinados y soporte de namespaces/red rootless.
Los requisitos dependen del sistema instalado; el ejecutor no los instala.

El daemon recibe socket Unix, `data-root`, `exec-root`, PID y runtime propios en
un directorio creado por `mkdtemp`, configuración vacía propia y `live-restore`
deshabilitado. Antes de crear recursos se comprueban su ID,
raíz de datos y condición rootless. Los procesos CORE reciben exclusivamente ese
endpoint y verifican su ID. Se descarga `busybox:1.37`; se registran versiones,
identidad de imagen y daemon. Ningún servicio publica puertos de aplicación ni
usa política de reinicio. Los binds apuntan exclusivamente a restauraciones del
fixture. La aceptación falla si el daemon no puede arrancar.

Además de los flujos por transportes/CLI, comprueba datos dentro de un contenedor
y ejecuta delete, expiración y nuevo arranque con recursos ajenos presentes:
contenedor/red/volumen centinela y volumen externo compartido con datos. Comprueba
identidades, contenido y desaparición de recursos propios de los tres tipos.

Un segundo caso copia todas las etiquetas de un contenedor Health a recursos
ajenos. CORE debe preservar tanto los centinelas como sus recursos propios y
mostrar limpieza `ERROR` por procedencia ambigua. El driver elimina únicamente
los tres centinelas que acaba de crear, usando sus identidades exactas, y verifica
que el reintento de mantenimiento completa entonces la limpieza propia.

Los resultados diagnósticos artificiales (`DEGRADED`, etc.) se prueban con el
doble determinista; el daemon real acredita ejecución/restauración/limpieza y
preservación. No se simula un reinicio Docker ni un OOM real para fabricarlos.

## Evidencia y límites

Cada ejecución imprime `Evidence directory: /tmp/kida-e2e-…` y deja `result.json`,
logs CORE, configuración, snapshots e informes para inspección. El modo real
incluye el log de arranque del daemon y, cuando arranca, su versión/ID y la imagen.
Un error devuelve código distinto de cero; solo una ejecución completa imprime
`HEALTH E2E PASS`. Las esperas y subprocesos tienen deadlines. En la salida se
identifica expresamente `simulated` o `real`.

El driver termina solo el grupo de procesos del daemon que ha creado y elimina
sus datos/runtime cuando confirma que ese endpoint ya no responde, conservando
los logs. Si falla la retirada, devuelve error y conserva la evidencia. Nunca usa
`docker system prune`, elimina proyectos por prefijo ni limpia el daemon del
administrador. La evidencia temporal se conserva incluso cuando falla el arranque.

Si faltan requisitos rootless, registrar la aceptación real pendiente en la tarea
11. Una suite simulada aprobada no sustituye la aceptación real ni demuestra
integridad lógica o funcional de una aplicación. Esta prueba usa un proceso CORE
de tests que inicializa los servicios existentes; no ejecuta el `main` de
producción ni valida el instalador.
