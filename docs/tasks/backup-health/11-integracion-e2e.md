# 11 · Integración y aceptación E2E

**Objetivo:** demostrar los diez criterios de aceptación con componentes reales y distinguir simulación de Docker real.

## Trabajo

- Integrar los bloques 01–10 siguiendo [contratos](contratos.md); esta es la dependencia final explícita. Corregir problemas de conexión, devolviendo comportamientos faltantes a su tarea propietaria.
- Probar flujos manual/automático por HTTP, socket y CLI; crear un backup real registrado, restaurarlo y comprobar sus datos y servicios sin modificar originales.
- Verificar concurrencia entre definiciones, exclusión/cupo, resultados diagnósticos, TTL, parada, borrado, reinicio de KIDA, informes parciales, retención y protección de jobs.
- Saturar la cola con schedules pendientes y comprobar que, al recuperar capacidad, se admiten sin pérdida por saturación. Distinguir esto de garantías de exactamente una ejecución ante caída del proceso, que no se añaden.
- Preparar un E2E Docker opt-in contra daemon aislado y desechable. Crear recursos propios y centinelas ajenos, incluidos volúmenes externos/compartidos y etiquetas copiadas; comprobar identidad/contenido antes y después de delete, TTL y nuevo arranque.
- Añadir instrucciones reproducibles, requisitos y evidencia de ejecución real. Nunca usar el daemon habitual del administrador como entorno de limpieza de aceptación.

## Validación y cierre

Ejecutar las pruebas focalizadas y después `cargo test --workspace`, `cargo fmt --all -- --check` y `cargo clippy --workspace --all-targets --locked -- -D warnings`. No debilitar pruebas existentes ni confundir checks simulados con aceptación de un daemon real.

Registrar comandos, resultados y criterios 1–10 en el índice. Cierra cuando todos pasan, incluido E2E aislado real; si ese entorno no está disponible, dejar la aceptación real pendiente o bloqueada con motivo, sin marcarla verificada. No quedan cubiertas por esta prueba la integridad lógica ni funcional de la aplicación.

## Implementación y revisión

Estado: **Implementada; aceptación Docker real pendiente**. Commit de pruebas:
`84c5119` (`0.0.4 > test(backup): add health integration and isolated E2E acceptance`).
No se marca completa ni se acredita aceptación real. Fecha: 18/10/2026.

- [Ejecutor e instrucciones](../../../tests/backup-health/README.md): modos
  `--simulated` y `--real`, sin endpoint de daemon externo ni fallback al habitual;
  daemon rootless temporal con socket/datos/runtime/configuración propios,
  verificación de identidad y retirada acotada a su proceso y almacenamiento.
- [Fixture CORE](../../../kida-core/src/exec/health_e2e_tests.rs): configuración y
  servicios reales en proceso hijo, HTTP/socket temporales, worker con barrera de
  pruebas y controles privados por stdin para mantenimiento/ticks. No modifica el
  protocolo, flags, configuración pública ni comportamiento de producción.
- [Pipeline CLI contra CORE](../../../kida-cli/src/health_e2e_tests.rs): diez
  operaciones Health mediante parsing, input, mapper, cliente y renderer reales.
  El driver ejecuta esta prueba ignorada con socket temporal explícito; la suite
  normal ejecuta la integración CORE sin depender de construir tests CLI anidados.
- Backup registrado y restauración reales en ambos modos. Solo Docker es un doble
  en la integración automatizada. El proceso fixture inicializa los servicios,
  pero no ejecuta el `main` de producción ni valida el instalador o integridad
  funcional de aplicaciones. No se han modificado ni debilitado pruebas previas.

Revisión independiente: agente `review_health_e2e`, solo lectura, aprobada tras
corregir tres hallazgos: las etiquetas copiadas deben producir preservación y
limpieza `ERROR`, la espera del contenido centinela debe admitir el archivo aún
no creado y la ausencia de recursos propios debe comprobar los tres tipos.
Segunda revisión aprobada; revisión adicional del teardown sin nuevos hallazgos.
Revisión propia del diff: cambios de producción limitados a registrar módulos
`cfg(test)`, sin dependencias nuevas ni lógica de dominio duplicada.

## Matriz de criterios

Las comprobaciones nombradas corresponden a funciones del
[driver](../../../tests/backup-health/run.py). «Docker simulado» no acredita
comportamiento de un daemon real. La columna real describe cobertura preparada,
no ejecución aprobada.

| Criterio | Integración aprobada | Aceptación Docker real |
| --- | --- | --- |
| 1. Copia/restauración sin modificar originales | `flows`: backup real registrado, comparación de bytes de origen/artefacto y datos restaurados; Compose con doble Docker | Preparada: además lee datos desde un contenedor; pendiente |
| 2. Concurrencia/exclusión por definición | `concurrency_and_time`: admisiones simultáneas, entornos distintos, duplicado rechazado y un entorno sigue activo tras borrar el otro | Mismo escenario preparado; pendiente |
| 3. Asincronía/modos/TTL | `flows`, pipeline CLI y `concurrency_and_time`: IDs distintos, parciales, manual/automático, cupo y expiración con tiempo suministrado | Mismos escenarios preparados; pendiente |
| 4. Cinco resultados y ausencia de checks | `technical_results`: FAILED/UNHEALTHY/UNKNOWN/DEGRADED/HEALTHY; UNKNOWN sin healthcheck, usando observaciones Docker simuladas | HEALTHY con healthcheck de datos preparado; pendiente. No se fabrica OOM/reinicio real para producir DEGRADED |
| 5. Limpieza exclusivamente propia | Limpieza y reintento con doble; pruebas previas de propiedad permanecen intactas | `real_preservation`: centinelas, volumen compartido/externo, etiquetas copiadas y comprobación de IDs/contenido en delete/TTL/reinicio; pendiente |
| 6. Cierre al arrancar sin reanudación | `restart_and_retention`: mata/recrea el proceso CORE, conserva persistencia, marca interrupción y limpia | Mismo escenario y centinelas preparados; pendiente |
| 7. Historial/informes ante fallos | `flows`, `technical_results`, `cleanup_failure`: parciales, Markdown, borrado voluntario y no reconstrucción tras reinicio | Flujos e informes preparados; pendiente |
| 8. Retención/jobs protegidos | `cleanup_failure`, `restart_and_retention`, `protections`: conserva historial necesario para limpieza, reintenta y poda después; jobs internos no duplicados/protegidos | Mantenimiento/retención/protección preparados; pendiente |
| 9. Transportes/saturación | `flows`, pipeline CLI, `saturation`: HTTP/socket/CLI, cola y slots llenos, schedules pendientes admitidos al liberar capacidad sin duplicación en ese escenario | Mismos escenarios preparados; pendiente |
| 10. Daemon aislado y recursos ajenos intactos | No acreditable con el doble Docker | Ejecutor opt-in preparado y revisado; arranque bloqueado por falta de `newuidmap` |

Los clocks controlados invocan funciones existentes de mantenimiento y los ticks
existentes de Scheduler; no esperan horas ni alteran el reloj del host. El timer
no se inicia en el fixture. La saturación no añade garantías de exactamente una
entrega ante caída del proceso.

## Validación realizada

- `cargo test --workspace --locked`: **271 aprobadas**, 0 fallos (69 CLI, 3 pruebas
  de binario CLI, 199 CORE); 18 ignoradas entre fixtures, auxiliares y aceptación
  opt-in. Incluye `exec::health_e2e::simulated_transports_and_lifecycle`.
- `python3 tests/backup-health/run.py --simulated`: **HEALTH E2E PASS (simulated)**,
  incluido el pipeline CLI contra el CORE vivo. Evidencia final local:
  `/tmp/kida-e2e-301j3hfj/result.json`, logs y `case/evidence/` con snapshots e
  informes conservados fuera de la retención de datos del fixture.
- `cargo fmt --all -- --check`: correcto.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: correcto.
- `PYTHONPYCACHEPREFIX=/tmp/kida-e2e-pycache python3 -m py_compile tests/backup-health/run.py tests/backup-health/fake_docker.py`: correcto.
- `git diff --check` y `git diff --cached --check`: correctos, incluidos archivos nuevos.

Las pruebas de sockets se ejecutaron fuera del sandbox, que devuelve
`Operation not permitted` al crearlos.

## Aceptación real pendiente

Se ejecutó `python3 tests/backup-health/run.py --real` fuera del sandbox. El daemon
rootless no pudo arrancar: `failed to setup UID/GID map` porque
`newuidmap` no está en `PATH`. Salida 1; `passed: false`. El ejecutor confirmó el
endpoint dedicado detenido y conservó logs. No llegó a descargar la imagen ni
crear recursos de aceptación; no usó el daemon habitual ni instaló paquetes.

Evidencia local: `/tmp/kida-e2e-16um46t3/result.json` y
`/tmp/kida-e2e-16um46t3/daemon/daemon.log`. Estas rutas son evidencia temporal de
esta máquina, no artefactos versionados ni una garantía de disponibilidad futura.

Para terminar: disponer de los requisitos rootless descritos en la guía, repetir
el comando real y corregir cualquier fallo demostrado por esa ejecución. Solo
entonces registrar daemon/imagen/versiones/resultados, revisar los hallazgos y
marcar esta tarea **Completa**. El éxito simulado no sustituye ese paso.
