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
