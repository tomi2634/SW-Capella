# Contexto del proyecto SW-Capella

## Resumen
SW-Capella es un sistema local de gestión para el Estudio Contable Capella, orientado a administración de clientes, cobros, recibos PDF y seguimiento de deuda. Está pensado para ejecutarse en una sola PC Windows dentro de una red local, sin autenticación de usuarios ni servicios en la nube.

La aplicación está dividida en dos partes principales:
- Backend en Node.js con Express.
- Frontend en React.

El sistema usa archivos Excel como base de datos persistente y guarda los recibos PDF en carpetas del disco.

## Estructura del repositorio
La carpeta relevante del proyecto es SW-Capella-Codigo, con esta organización principal:
- backend/ para la API y la lógica de negocio.
- frontend/ para la interfaz web.
- data/ para los archivos Excel.
- backups/ para backups ZIP de los datos.
- Trabajos Estudio Capella/ para los PDFs de recibos y carpetas por cliente.
- iniciar.bat como script de arranque del sistema completo.

## Stack técnico
- Backend: Node.js, Express, ExcelJS, PDFKit, CORS, Body Parser, Archiver, UUID.
- Frontend: React 18, Axios, date-fns, React Scripts.
- Persistencia: Excel xlsx y sistema de archivos.

## Cómo se ejecuta
El sistema se inicia normalmente con iniciar.bat, que levanta backend y frontend por separado.

Comandos relevantes:
- Backend: cd backend y npm start.
- Frontend: cd frontend y npm start.
- Build frontend: npm run build.
- Rebuild del historial: node rebuild-historial.js.

Puertos:
- Backend: 5000.
- Frontend: 3000 en desarrollo.

## Modelo de datos
La aplicación no usa base de datos tradicional. La información vive en tres archivos Excel dentro de data/:

- clientes.xlsx: contiene clientes, honorarios, tipo de trabajo, interés mensual, fecha de creación, deuda total, próxima facturación y honorarios programados por mes.
- pagos.xlsx: contiene pagos registrados, monto, tipo de pago, detalles, cheques, estado activo/anulado y metadatos del recibo.
- historial.xlsx: contiene el historial de facturación por cliente y mes.

### Idea clave del modelo
La deuda no se guarda como un valor manual fijo. Se recalcula dinámicamente a partir de:
- fecha de creación del cliente,
- honorario mensual o único,
- honorarios programados por mes,
- pagos activos,
- estado de anulación de pagos.

## Tipos de cliente
Hay dos tipos de trabajo:
- honorarios: cliente con facturación mensual.
- particular: trabajo único con monto fijo.

Los clientes particulares no usan la lógica de interés mensual ni el ciclo mensual de facturación.

## Lógica contable principal
El corazón del sistema está en backend/excelManager.js.

Reglas importantes:
- Para honorarios mensuales, la deuda se calcula mes a mes desde la fecha de creación hasta el mes anterior al actual.
- El mes en curso no se considera adeudado hasta que termine.
- Los pagos anulados no cuentan para reducir deuda.
- Puede existir un honorario programado distinto para un mes específico.
- Se puede cargar deuda anterior para meses pasados.
- Si un cliente tiene interés mensual activo, se aplica el porcentaje al honorario mensual base.

Para clientes particulares:
- se toma un honorario único,
- se resta lo pagado,
- la deuda queda como saldo del trabajo único.

## Backend
El backend expone la API REST y maneja toda la lógica de negocio, el acceso a Excel, la generación de PDFs, los backups y la estructura de carpetas del sistema.

Archivos clave:
- backend/server.js: rutas HTTP, arranque del servidor, backups, manejo de recibos y sincronización.
- backend/excelManager.js: lectura/escritura de Excel, cálculo de deuda, historial, pagos y resumen.
- backend/pdfGenerator.js: generación de recibos PDF.

### Endpoints principales
Clientes:
- GET /api/clientes: lista todos los clientes.
- GET /api/clientes/:id: devuelve un cliente.
- POST /api/clientes: crea un cliente.
- PUT /api/clientes/:id: actualiza un cliente.
- DELETE /api/clientes/:id: elimina un cliente y sus datos asociados.

Honorarios y deuda:
- GET /api/honorarios-config: devuelve información de configuración.
- PUT /api/clientes/:id/honorario: actualiza el honorario base.
- PUT /api/clientes/:id/honorario-programado: programa un honorario para un mes MM-YYYY.
- PUT /api/clientes/:id/deuda-anterior: carga deuda anterior para un mes MM-YYYY.

Pagos:
- POST /api/pagos: registra un pago y recalcula la deuda.
- GET /api/pagos: lista pagos.
- GET /api/pagos/cliente/:clienteId: lista pagos de un cliente.

Historial:
- GET /api/historial: historial completo.
- GET /api/historial/cliente/:clienteId: historial de un cliente.
- POST /api/historial: agrega una entrada manual al historial.

Resumen:
- GET /api/resumen: métricas generales del estudio.

Recibos PDF:
- POST /api/generar-recibo: genera y guarda un recibo PDF.
- GET /api/recibos: lista y filtra recibos guardados.
- GET /api/recibos/descargar: descarga un recibo específico.
- POST /api/recibos/anular: anula un recibo y el pago asociado.
- POST /api/recibos/abrir-carpeta: abre la carpeta del cliente en la PC servidor.

Sincronización y admin:
- GET /api/sync/:lastSync: endpoint para polling de cambios.
- POST /api/admin/reiniciar: reinicia todos los datos.
- POST /api/admin/backup-zip: crea backup ZIP de data/.
- POST /api/admin/recalcular/:clienteId: recalcula deuda de un cliente.
- GET /api/admin/debug/:clienteId: devuelve datos de diagnóstico de un cliente.
- POST /api/admin/test/envejecer/:clienteId/:diasAtras: utilidad de prueba.
- GET /api/health: healthcheck.

## Frontend
El frontend es una SPA con tres pestañas principales.

Archivos clave:
- frontend/src/App.js: layout general, navegación y polling cada 5 segundos.
- frontend/src/components/ResumenTab.js: tablero de resumen.
- frontend/src/components/ClientesTab.js: gestión de clientes.
- frontend/src/components/PagosTab.js: carga de pagos y gestión de recibos.

### Flujo visual
Pantallas principales:
- Resumen: muestra total de clientes, total adeudado, clientes con deuda y clientes al día.
- Clientes: crear, editar, eliminar, ver historial y programar honorarios.
- Registrar Pago: buscar cliente, registrar pago, generar recibo y consultar/anular recibos.

### Comportamiento importante del frontend
- Hace polling cada 5 segundos para refrescar datos.
- Toma la URL base de la API desde REACT_APP_API_BASE_URL o usa el host actual con puerto 5000.
- Permite buscar clientes por nombre o DNI/CUIT.
- Soporta pagos con efectivo, transferencia, cheque y combinaciones.
- Permite varios cheques en un mismo pago.
- Permite descargar una copia local del recibo y abrir la carpeta del cliente en el servidor.

## Recibos y archivos en disco
Los PDFs se guardan dentro de Trabajos Estudio Capella/, separados por tipo de trabajo:
- Honorarios Estudio Capella/
- Trabajos Particulares Estudio Capella/

También existen archivos de soporte como:
- _contador_recibos.json para numeración de recibos.
- _indice_carpetas_particulares.json para resolver carpetas de clientes particulares.

Cuando un recibo se anula, el sistema intenta marcarlo en el nombre del archivo y sincronizar ese estado con el pago asociado.

## Backups
Al iniciar el servidor se intenta crear un backup ZIP de la carpeta data/ si aún no existe uno para el día actual.

Los backups se guardan en backups/ y existe una retención configurada por variable de entorno:
- BACKUP_RETENTION_MAX_FILES, por defecto 10.

## Casos de uso principales
1. Crear un cliente con nombre, DNI/CUIT y honorario.
2. Si es mensual, definir opcionalmente interés mensual y honorarios programados por mes.
3. Registrar pagos cuando el cliente abona.
4. Generar automáticamente el recibo PDF.
5. Consultar historial y resumen general.
6. Anular recibos o pagos si hubo un error.
7. Crear backups del archivo data/.

## Detalles prácticos para una IA que trabaje sobre este proyecto
- No asumir base de datos SQL: todo se apoya en Excel y filesystem.
- No romper la lógica de deuda dinámica, porque es central para el sistema.
- Tener cuidado con pagos anulados: deben excluirse de los cálculos.
- Mantener compatibilidad con la estructura de carpetas de recibos y con Windows.
- Si se cambia una ruta o un campo de Excel, revisar también el frontend y la reconstrucción del historial.

## Archivos de referencia rápida
- [CLAUDE.md](CLAUDE.md)
- [SW-Capella-Codigo/backend/server.js](SW-Capella-Codigo/backend/server.js)
- [SW-Capella-Codigo/backend/excelManager.js](SW-Capella-Codigo/backend/excelManager.js)
- [SW-Capella-Codigo/backend/pdfGenerator.js](SW-Capella-Codigo/backend/pdfGenerator.js)
- [SW-Capella-Codigo/frontend/src/App.js](SW-Capella-Codigo/frontend/src/App.js)
- [SW-Capella-Codigo/frontend/src/components/ClientesTab.js](SW-Capella-Codigo/frontend/src/components/ClientesTab.js)
- [SW-Capella-Codigo/frontend/src/components/PagosTab.js](SW-Capella-Codigo/frontend/src/components/PagosTab.js)
- [SW-Capella-Codigo/frontend/src/components/ResumenTab.js](SW-Capella-Codigo/frontend/src/components/ResumenTab.js)

## Estado general
El proyecto ya está armado y funcional como sistema local. La documentación más cercana al comportamiento esperado está en CLAUDE.md y en el propio código del backend/frontend.