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
