# 07 · Ciclo de vida y admisión

**Objetivo:** coordinar ejecuciones automáticas/manuales con estados y límites coherentes.

## Trabajo

- Implementar el servicio de `create/start/run/get/list/stop/delete`, separando estado operativo y resultado técnico. `run` reutiliza creación/arranque automático.
- Poseer admisión, exclusión por definición, cupo global de entornos y rollback ante fallo de cola/persistencia. Devolver `run_id` sin esperar restauración/diagnóstico.
- Coordinar artefacto, restauración, Compose, diagnóstico y persistencia por sus contratos. No implementar esas capacidades dentro de esta tarea.
- Automático: capturar antes de limpiar y cerrar informe después del intento. Manual: permitir consulta, TTL desde admisión, parada con datos conservados y eliminación posterior; impedir reinicio de `STOPPED`.
- Serializar conflictos del mismo run, cancelar trabajo pendiente tras stop/delete y conservar errores/evidencias. Fallos de parada no liberan capacidad mientras haya recursos activos o inciertos.

## Frontera

Posee coordinación de dominio y reserva de capacidad, no handlers ni el runner del worker. 09 conecta su admisión con la cola; el trabajo admitido tiene una vía de ejecución que no readmite ni reencola. Validar con dobles locales de los componentes documentados en [contratos](contratos.md).

## Pruebas y cierre

Probar dos definiciones simultáneas, dos arranques de la misma definición, cupo ocupado por manuales y liberación confirmada. Cubrir cola llena/cerrada, persistencia fallida, fallos de cada fase, cancelación, stop/delete durante STARTING y delete repetido. Comprobar que una ejecución detenida no bloquea otra y que get no renueva TTL.

Cierra cuando la máquina de estados y los límites se sostienen bajo concurrencia sin locks globales alrededor de I/O. Actualizar el índice.
