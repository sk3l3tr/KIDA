# Spec: operaciones Docker en KIDA Console

## Objetivo y alcance

Completar `/docker` con las ocho operaciones existentes. Solo frontal y documentación;
sin dependencias nuevas, cambios de backend, CORE, CLI o vendor. Angular 22,
Ionic 8.8.19 y ARCA 3.2.7, autenticación, navegación y siete combinaciones de tema
se conservan. Verificación exclusivamente con API simulada.

Dos secciones en una página: Contenedores y Compose. Arrancar directamente;
confirmar parar, reiniciar y eliminar mediante `.console-dialog`.

## Contratos

Base: `environment.apiBaseUrl + '/docker'`.

| Operación           | Método y ruta                                     | Entrada                       |
| ------------------- | ------------------------------------------------- | ----------------------------- |
| Listar contenedores | GET `/containers`                                 | Ninguna                       |
| Versión de Compose  | GET `/compose/version`                            | Ninguna                       |
| Listar proyectos    | GET `/compose/projects`                           | Ninguna                       |
| Inspeccionar        | GET `/compose/projects/inspect?project={project}` | `encodeURIComponent(project)` |
| Arrancar            | POST `/containers/start`                          | `{container: id}`             |
| Parar               | POST `/containers/stop`                           | `{container: id}`             |
| Reiniciar           | POST `/containers/restart`                        | `{container: id}`             |
| Eliminar            | POST `/containers/delete`                         | `{container: id}`             |

Proyectos es un array raíz. Conservar campos adicionales, ceros, nulos y estados
futuros. Cada objeto de contenedor incluye ID, nombre, imagen, actividad, estado,
salud, fechas, salida, reinicios, política, puertos y redes. Mostrar detalles
desplegables reutilizables y JSON interpretado; advertir de precisión limitada
para números que no sean enteros seguros de JavaScript. No prometer JSON original
exacto. Interpolar datos remotos exclusivamente como texto.

## Comportamiento

- Carga al entrar y actualización manual, sin sondeo. Estados de carga, vacío,
  error y datos anteriores desactualizados independientes para contenedores,
  versión, proyectos e inspección. Conservar última lectura ante fallos;
  nunca mostrar un fallo inicial como vacío.
- Mostrar totales de la API, proyectos y servicios, también sin nombre. Una
  selección de proyecto, sin inspecciones simultáneas en el mismo canal.
  Limpiar selección y detalle si desaparece de una lectura correcta.
  Los proyectos observados no prueban propiedad KIDA.
- Acciones solo en listado principal, con ID completo; CORE decide validez,
  sin deducir permisos por actividad, estado o Compose. Sin cambios optimistas.
- Una sola escritura. Bloquear acciones durante inventario, confirmación,
  escritura y actualización posterior. Confirmación con instantánea de acción,
  nombre e ID, advertencia irreversible al eliminar. Cancelar/Escape no envían;
  foco inicial, recorrido de teclado y restauración al disparador o cabecera
  si desaparece. Mantener temas y adaptación móvil con diálogo abierto.
- Tras éxito, mostrar acción solicitada y respuesta CORE `{container,status,...}`;
  actualizar contenedores y proyectos y después inspeccionar selección si existe.
  Separar fallo de actualización del resultado de escritura.
- Resultado incierto: conservar aviso, marcar inventarios desactualizados y
  bloquear acciones hasta lectura correcta de contenedores. Nunca reenviar.
- Al salir o cambiar sesión, cerrar diálogo, limpiar datos y suscripciones,
  ignorar resultados tardíos. Comprobar generación, identidad y proyecto.

## Arquitectura

Modelos, ocho acciones `DOCKER_*_REQUEST/RESPONSE/ERROR` con `useLoader: false`,
servicio tipado, presentación y página encapsulados en `pages/docker`.
Exclusivamente `ArcaRequestService`, `classifyCoreFailure`, `ThemeIdentity`
y ciclo de entrada/salida/sesión de Scheduler. Usar `inject`, signals,
observables, plantillas Angular, `ion-content`, `.console-layout`, `.panel`
y tokens Ionic/KIDA, textos en español.

## Verificación y entrega

Pruebas junto al módulo: ocho contratos HTTP/ARCA, cuerpos, CSRF, codificación,
nulos/futuros, fallos, desactualización, precisión, instantánea, cancelación,
doble clic, desaparición, caducidad, resultados tardíos, canal ocupado e incertidumbre.
Script Playwright siguiendo Scheduler, usando instalaciones existentes e
interceptando toda API antes de navegar. Verificar ocho operaciones, texto seguro,
foco/teclado, navegación, desbordamiento, escritorio/móvil y siete combinaciones
de tema, incluido cambio con diálogo abierto. Evidencias en `/tmp`.

Con Node de `.nvmrc`: `pnpm exec ng test --watch=false`,
`pnpm exec ng build --configuration production`, `pnpm exec ng serve --port 4227`.
Respetar presupuestos sin aumentarlos. Revisar diff y archivos nuevos mediante
agente independiente, corregir hallazgos y repetir validaciones afectadas.
Actualizar README. No Docker real, commit, push ni despliegue.

La solicitud de implementación aprueba esta especificación. Flujo:
explore → resolver nuevas ambigüedades materiales → plan → execute → review.
