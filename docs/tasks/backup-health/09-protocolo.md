# 09 · Protocolo y ejecución asíncrona

**Objetivo:** exponer Health mediante los transportes existentes y conectar su trabajo con la cola actual.

## Trabajo

- Registrar las operaciones y parámetros de [contratos](contratos.md), incluido `backup.health.run`, respetando `CommandRequest/CommandResponse`.
- Implementar handlers finos de validación/adaptación hacia 07 y 06; devolver errores y datos coherentes con el protocolo actual, distinguiendo `run_id` e identificador de cola.
- Conectar admisión/reserva de 07 con encolado y ejecución por worker. El consumidor ejecuta el trabajo admitido sin volver al encolado público. Una ejecución programada no espera un segundo permiso ocupado por sí misma.
- Conectar las dos acciones internas de 08 con origen/dispatch protegido; impedir su invocación pública y su creación como jobs de usuario. No debilitar la protección administrativa del Scheduler.
- Añadir al sobre privado de cola el contexto fiable mínimo de una entrada `INTERNAL`, establecido por el servicio Scheduler y conservado por el worker. Hoy ese origen no viaja en la cola; no confiar en campos de `CommandRequest` ni parámetros enviados por clientes.
- Mantener HTTP y socket sobre la misma lógica, sin introducir transportes ni rediseñar cola/worker.

## Frontera

Posee catálogo, handlers y cableado de ejecución. 07 mantiene exclusión, cupo y transiciones; 08 mantiene políticas de mantenimiento. Los tests pueden usar un servicio de prueba con el mismo contrato, sin crear capas de producción adicionales.

## Pruebas y cierre

Probar todos los comandos, parámetros inválidos, run inexistente, admisión rechazada, cola llena/cerrada y respuesta inmediata con `run_id`. Verificar ejecución única, ausencia de reencolado recursivo, ejecución programada con worker de capacidad uno y rechazo de acciones internas por canales públicos, incluso con un origen interno falsificado en parámetros.

Cierra cuando handlers y rutas pueden conectar los componentes reales sin lógica de restauración en el transporte. Actualizar el índice.
