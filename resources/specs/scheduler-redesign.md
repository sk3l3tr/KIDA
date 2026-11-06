# Rediseño de Scheduler

Estado: especificación para revisión. No autoriza implementar código.

Referencia: `resources/mockups/scheduler-mockup.html`.
Módulo: `kida-console/frontend/src/app/pages/scheduler`.

## 1. Diagnóstico

### Arquitectura actual

- Angular standalone, Ionic, signals, formularios con `ngModel` y transporte ARCA.
- La página compone `SchedulerList` y `SchedulerCreateForm`; `SchedulerFacade` concentra estado, ciclo de vida, consultas y confirmaciones.
- Actualmente listado y formulario aparecen juntos, sin tarjetas resumen, búsqueda, tabla ni inspector.
- Ya existen snapshots congelados para confirmar, exclusión de envíos duplicados, invalidación por sesión/navegación, recuperación de foco y separación entre resultado de escritura y fallo de refresco.

### Reutilización

- `SidePanel`: panel lateral, acciones inferiores, adaptación móvil, foco y movimiento reducido.
- `AppDialog`: confirmaciones mediante ARCA; se conserva según la decisión del usuario.
- System aporta patrones de indicadores y tablas; Docker, inspector y convivencia entre panel y confirmación.
- Botones, controles, iconos y tokens Ionic/KIDA ya disponibles. No hace falta crear un sistema visual compartido ni importar componentes específicos de otros dominios.

### Contrato real

| Capacidad | Soporte y adaptación |
|---|---|
| Consultar | `GET /api/scheduler?origin=USER\|INTERNAL\|ALL`. |
| Crear | `POST /api/scheduler/add`: comando, JSON y regla temporal. |
| Eliminar | `POST /api/scheduler/delete`: ID; solo programaciones `USER`. |
| Puntual | `once.at`, RFC3339 con zona explícita; CORE exige una fecha futura. |
| Intervalo | `interval.seconds`, entero positivo. CORE establece el anclaje al crear; no permite elegirlo ni lo devuelve. |
| Cron | Expresión de cinco campos y zona IANA; validación definitiva en CORE. |
| Datos del listado | ID, origen, comando, parámetros, regla y `next_enqueue_at`; sin historial ni resultados de ejecución. |

Los parámetros admiten objetos, arrays, escalares y `null`. Se conserva la validación actual de números seguros. Crear una programación no acredita que los parámetros del comando vayan a ejecutarse correctamente.

### Adaptaciones del mockup

- Los cuatro indicadores pueden calcularse del listado, sin endpoints nuevos.
- Se elimina el selector de anclaje; se explica que CORE fija el inicio del intervalo.
- La zona visual será la del navegador; cron conservará una entrada IANA libre, con `UTC` inicial.
- «Se retiran tras su intento» se sustituye por «Se retiran tras su admisión en cola»: una cola llena puede provocar reintentos.
- Se eliminan datos de ejemplo, controles demo y supuestos estados de conexión.
- La revisión final de creación será `AppDialog`, conservando un resumen previo dentro del formulario.

## 2. Diseño técnico

- Mantener `/scheduler`, `SchedulerService`, acciones ARCA y contratos HTTP existentes. Sin cambios en CORE, backend, menú o shell.
- Composición: cabecera con «Nueva programación» → cuatro indicadores → inventario con filtros, búsqueda y tabla → información de instantánea.
- Conservar los componentes actuales y añadir únicamente `SchedulerIndicators` y `SchedulerInspector`. El formulario y el inspector reutilizarán `SidePanel`, con apertura mutuamente excluyente.
- `SchedulerFacade` seguirá coordinando consultas, selección, paneles y operaciones. Los componentes presentan datos; los cálculos puros permanecen en utilidades locales.
- Decisión confirmada: consultar `ALL` al entrar, actualizar y completar una escritura. Aplicar origen y búsqueda localmente, con `USER` inicial. Permite contadores coherentes con una sola petición; cambia el filtrado actual por servidor.
- Indicadores y contadores por origen reflejarán toda la instantánea; búsqueda y filtro afectarán únicamente a las filas y al número de resultados. Buscar por comando, ID y parámetros; ordenar por próxima admisión, sin calcular ocurrencias futuras.
- Conservar datos anteriores y su fecha ante errores de refresco. Sin primera lectura válida, mostrar valores desconocidos y error, nunca un vacío aparentemente confirmado.
- Inspector basado en el objeto recibido: identificación, regla, próxima admisión, parámetros y JSON original completo. Sin nueva consulta ni definición reconstruida.
- Mantener snapshots congelados, correlación ARCA, bloqueo de duplicados y ausencia de reintentos automáticos. Al abrir `AppDialog`, suspender la trampa de foco del panel siguiendo Docker.
- Estilos locales con tokens existentes para superficies, acento, tipografía, bordes, radios y sombras. Respetar composición y jerarquía del mockup dentro del tema seleccionado; no copiar su paleta fija.
- Indicadores en cuatro/dos columnas; tabla con desplazamiento horizontal contenido y panel a ancho completo en móvil. Mantener controles de al menos 44 px.

## 3. Historias de usuario

### SCH-01 — Cabecera y composición — Completada

Validación: 116 pruebas y build de desarrollo correctos; revisión independiente sin hallazgos. Verificación visual pendiente. Build de producción bloqueado también en HEAD por presupuesto inicial.

**Objetivo:** establecer la estructura visual del mockup.

**Cambios:** página Scheduler, estilos locales y apertura de `SchedulerCreateForm` en `SidePanel`.

**Dependencias:** ninguna.

**Criterios de aceptación:**

- Cabecera y CTA reconocibles; formulario accesible desde el CTA.
- Sin formulario permanente bajo el listado; shell y menú intactos.
- Comprobación visual en escritorio y móvil.

### SCH-02 — Instantánea y resumen global — Completada

Validación: 118 pruebas y build de desarrollo correctos; revisión independiente sin hallazgos. Verificación visual pendiente. Producción mantiene el bloqueo previo por presupuesto inicial.

**Objetivo:** mostrar información real y coherente.

**Cambios:** `SchedulerFacade`, nuevo `SchedulerIndicators` y utilidades de presentación.

**Dependencias:** SCH-01.

**Criterios de aceptación:**

- Total, recurrentes, puntuales y próxima admisión calculados desde `ALL`; desglose Usuario/Interno.
- Desconocidos antes de cargar y cero solo tras lectura vacía válida.
- Actualización manual y al entrar, sin sondeo.
- Pruebas de cálculos, errores y conservación de datos anteriores.

### SCH-03 — Inventario, filtros y búsqueda

**Objetivo:** reproducir la tabla operativa del mockup.

**Cambios:** `SchedulerList`, estado de filtros y estilos locales.

**Dependencias:** SCH-02.

**Criterios de aceptación:**

- Seis columnas del mockup, ID abreviado con acceso al completo, filtros con contadores y búsqueda local.
- Orden por próxima admisión.
- Diferenciar ausencia de programaciones y ausencia de coincidencias.
- Orígenes desconocidos conservados y sin borrado.
- Pruebas de filtros combinados, orden, textos largos y contenido escapado.

### SCH-04 — Inspector de programación

**Objetivo:** consultar el detalle sin abandonar el inventario.

**Cambios:** nuevo `SchedulerInspector`, selección en fachada y enlace desde la tabla.

**Dependencias:** SCH-03.

**Criterios de aceptación:**

- Panel con identificación, regla, fechas, parámetros y JSON original.
- Internas protegidas; sin peticiones adicionales.
- Cierre y retorno de foco correctos; selección invalidada al abandonar la página o cambiar de sesión.
- Verificación visual del panel y prueba de campos adicionales.

### SCH-05 — Formulario por modalidad

**Objetivo:** trasladar la organización del formulario del mockup conservando validaciones.

**Cambios:** `SchedulerCreateForm`, modelos y utilidades del formulario.

**Dependencias:** SCH-01.

**Criterios de aceptación:**

- Bloques de comando/JSON, modalidad y resumen previo.
- Puntual con segundos y conversión local→UTC existente.
- Intervalo con segundos/minutos/horas/días convertido a segundos mediante multiplicación segura; sin anclaje editable.
- Cron con cinco campos como ayuda y zona IANA libre.
- `AppDialog` confirma el cuerpo congelado.
- Pruebas de unidades, límites, JSON, cambios horarios y cancelación sin envío.

### SCH-06 — Operaciones y estados visibles

**Objetivo:** completar altas y bajas desde la nueva interfaz.

**Cambios:** fachada, acciones del inspector y estado de operación visible desde la página.

**Dependencias:** SCH-04 y SCH-05.

**Criterios de aceptación:**

- Borrar desde tabla o inspector usa la misma confirmación y solo admite `USER`.
- La confirmación advierte que no cancela comandos encolados.
- Alta correcta limpia/cierra el formulario; rechazo conserva el borrador; resultado incierto no provoca reenvío.
- Éxito y fallo posterior de refresco permanecen diferenciados.
- Sin paneles huérfanos ni pérdida de foco tras borrar.

### SCH-07 — Validación visual y regresiones

**Objetivo:** cerrar la fidelidad visual y la compatibilidad.

**Cambios:** pruebas del módulo y ajustes locales de presentación/accesibilidad.

**Dependencias:** SCH-01 a SCH-06.

**Criterios de aceptación:**

- Comparar escritorio y móvil con el mockup.
- Revisar las siete combinaciones de tema, teclado, foco, panel con confirmación superpuesta y movimiento reducido.
- Ejecutar pruebas de Scheduler, rutas, errores compartidos y componentes reutilizados, más compilación de desarrollo y producción.
- Conservar las comprobaciones existentes; revisión final por agente independiente.
- Usar Playwright únicamente para verificar comportamientos visuales/Ionic que las pruebas unitarias no puedan acreditar.

## 4. Riesgos y decisiones pendientes

- Decisión confirmada por el usuario: una lectura `ALL` y filtros locales para reproducir los contadores globales.
- Sin anclaje editable ni historial: son límites del contrato, resueltos mediante las adaptaciones indicadas.
- La convivencia de `SidePanel` y `AppDialog` requiere comprobar foco y cierre en Ionic real durante la implementación.

## Estado de verificación de la exploración

No se implementó código ni se ejecutaron suites durante la exploración. El intento de abrir el mockup con Playwright quedó bloqueado por el protocolo `file:`; la apariencia renderizada permanece sin verificar.
