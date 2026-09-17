# Runbook: pasar los datos reales del estudio a SQLite

Documento operativo para ejecutar **una sola vez** en la PC del Estudio Capella.

Está versionado en la rama `main`, así que en la PC del estudio lo tenés disponible después de
`git pull` en `docs/runbook-cutover-sqlite.md`. Igual conviene tenerlo impreso o en el celular:
si algo sale mal a mitad del Paso 5, no querés depender de la misma máquina para leer cómo volver atrás.

**Tiempo estimado:** 30 a 45 minutos, sin apuro.
**Momento recomendado:** un día de poco movimiento, con el estudio cerrado o sin nadie cargando pagos.
**Regla de oro:** si algo no sale como dice este documento, **parás**. No improvisás sobre contabilidad real.

---

## Antes de empezar: qué vas a hacer y por qué es seguro

Vas a convertir los tres archivos Excel (`clientes.xlsx`, `pagos.xlsx`, `historial.xlsx`) en una
sola base SQLite (`capella.db`).

Lo que hace segura esta operación:

- **Los `.xlsx` no se tocan.** El script los abre en modo lectura y nunca los modifica ni los borra.
  Si algo sale mal, siguen ahí exactamente como estaban.
- **Se hace un backup ZIP automático** antes de escribir nada.
- **Hay 7 chequeos de verificación** que comparan la contabilidad vieja contra la nueva, al centavo.
  Si uno solo falla, el script te avisa y no deberías usar esa base.
- **La vuelta atrás son dos comandos** y está al final de este documento. Existe una rama
  `pre-migracion-sqlite` que apunta al último estado con Excel, así que volver no requiere
  recordar ningún número de commit.

Lo que **no** se toca en ningún momento: los recibos PDF en `Trabajos Estudio Capella/`,
`_contador_recibos.json` y `_indice_carpetas_particulares.json`. La numeración de recibos sigue
donde estaba.

---

## Paso 0 — Verificar la versión de Node

En la PC del estudio, abrí una terminal (PowerShell) y corré:

```
node --version
```

| Resultado | Qué hacer |
|---|---|
| `v24.x` o superior | Nada. Seguí al Paso 1. |
| `v23.4` a `v23.x` | Nada. Seguí al Paso 1. |
| `v22.5` a `v23.3` | Probablemente funcione igual, pero puede necesitar un flag. Ver la nota de abajo. |
| `v22.4` o inferior | **Pará.** Hay que actualizar Node antes de seguir. Bajalo de nodejs.org e instalá la versión LTS. |

**Nota sobre el flag:** `node:sqlite` llegó en Node 22.5 detrás de `--experimental-sqlite`, y se
habilitó sin flag a partir de 23.4. Pero en las versiones recientes de la línea 22 ya viene
habilitado — lo probamos en Node 22.22.2 y funciona sin flag.

Para saber con certeza cuál es tu caso, corré:

```
node -e "require('node:sqlite'); console.log('SQLite disponible sin flag')"
```

- Si imprime el mensaje: no hay que hacer nada.
- Si tira un error: editá `iniciar.bat` y cambiá `node server.js` por
  `node --experimental-sqlite server.js`. Recomendación: mejor actualizar Node a la 24 y no
  quedar atado a un flag experimental.

---

## Paso 1 — Cerrar el sistema

**Esto no es opcional.** Si el sistema está corriendo mientras migrás, puede escribir en los
Excel a mitad de la lectura y dejarte una base inconsistente.

1. Cerrá la aplicación en todas las computadoras de la red que la tengan abierta en el navegador.
2. Cerrá las ventanas de `iniciar.bat` (las dos: backend y frontend).
3. Verificá que no quede ningún Node corriendo:

```
Get-Process node -ErrorAction SilentlyContinue
```

Si aparece alguno, cerralo:

```
Stop-Process -Name node -Force
```

4. Confirmá que ningún `.xlsx` esté abierto en Excel. Si alguien lo tiene abierto, Excel lo bloquea
   y la lectura falla.

---

## Paso 2 — Backup manual, además del automático

El script hace su propio backup, pero este lo hacés vos y lo guardás **fuera de la PC**.
Es la red de seguridad de la red de seguridad.

1. Andá a la carpeta del sistema (donde está `SW-Capella-Codigo`).
2. Copiá **la carpeta `data/` entera** a un pendrive o a otra carpeta fuera del proyecto.
3. Copiá también la carpeta `Trabajos Estudio Capella/` — son los recibos PDF. El script no los
   toca, pero si vas a hacer una copia, hacela completa.
4. Anotá en un papel el **total adeudado** que muestra hoy la pestaña General del sistema, y la
   **cantidad de clientes**. Lo vas a comparar después. Este número escrito a mano es tu control
   independiente: no depende de ningún script.

> Anotá acá antes de seguir:
> Total adeudado: _______________
> Cantidad de clientes: _______________
> Clientes con deuda: _______________
> Fecha y hora: _______________

---

## Paso 3 — Traer el código nuevo

El código nuevo ya está mergeado en la rama principal (`main`). No hace falta ninguna rama especial.

**Si la PC del estudio tiene el proyecto clonado con git:**

```
cd "ruta\al\proyecto"
git checkout main
git pull origin main
```

Confirmá que trajo la migración:

```
git log --oneline -1
```

Tiene que mostrar `Mergear la migracion de Excel a SQLite` o algo posterior. Si muestra un commit
más viejo, el `pull` no trajo nada: revisá la conexión y volvé a intentar.

**Si en la PC del estudio copiás los archivos a mano:**

Copiá desde tu máquina estos archivos a `SW-Capella-Codigo\backend\` de la PC del estudio:

- `db.js` (nuevo)
- `mappers.js` (nuevo)
- `migrar-a-sqlite.js` (nuevo)
- `bench-pagos.js` (nuevo)
- `test-migracion.js` (nuevo)
- `legacy\excelManagerXlsx.js` (nuevo, va en una subcarpeta `legacy`)
- `excelManager.js` (reemplaza al existente)
- `rebuild-historial.js` (reemplaza al existente)
- `server.js` (reemplaza al existente)

**Antes de reemplazar**, guardá una copia de los tres archivos viejos (`excelManager.js`,
`rebuild-historial.js`, `server.js`) en una carpeta aparte. Es tu vuelta atrás si no usás git.

**Dependencias:** no hay ninguna nueva. Si `backend\node_modules` ya existe, no hace falta hacer
nada. Si no existe:

```
cd SW-Capella-Codigo\backend
npm install
```

---

## Paso 4 — Probar que el código funciona, antes de tocar los datos

```
cd SW-Capella-Codigo\backend
node test-migracion.js
```

**Tiene que terminar en `40/40 pruebas pasaron`.**

Si da menos de 40, o aparece alguna línea que empieza con `FALLA`: **pará acá**. El código no está
bien instalado o falta algún archivo. No sigas al Paso 5. Los datos todavía no se tocaron, así que
no hay nada que revertir: volvé a copiar los archivos y probá de nuevo.

---

## Paso 5 — Correr la migración

Este es el único paso que escribe algo nuevo.

```
cd SW-Capella-Codigo\backend
node migrar-a-sqlite.js
```

Lo que va a hacer, en orden:

1. Crear un ZIP en `backups\pre-migracion-<fecha>.zip` con toda la carpeta `data/`.
2. Leer los tres `.xlsx` y escribir `data\capella.db`.
3. Correr los 7 chequeos de verificación.
4. Guardar el informe en `data\migracion-verificacion.txt`.

Si ya existe un `capella.db`, el script se niega a continuar. Es a propósito: no quiere pisar una
base sin que se lo pidas. Solo si estás seguro, se fuerza con `node migrar-a-sqlite.js --force`.

---

## Paso 6 — Leer el informe de verificación

Esta es la parte importante. Abrí `data\migracion-verificacion.txt` y leelo entero.

### Si termina con `RESULTADO: migración verificada.`

Todos los chequeos dieron OK. La contabilidad nueva coincide con la vieja al centavo. Seguí al Paso 7.

Antes, un control con tus propios ojos: fijate que la cantidad de clientes y pagos del encabezado
coincida con lo que anotaste en el Paso 2.

### Si termina con `RESULTADO: MIGRACIÓN FALLIDA`

**No uses esa base.** Buscá las líneas que empiezan con `FALLA` y mirá cuál de los 7 chequeos falló:

| Chequeo que falla | Qué significa |
|---|---|
| **1. Cantidad de clientes / pagos / historial** | Se perdieron filas al migrar. Grave. |
| **1b. Pagos sin cliente existente** | Hay pagos que apuntan a un cliente que ya no existe. Ver abajo. |
| **2. Pagos por estado** | Algún pago cambió de activo a anulado o al revés. Grave. |
| **3. Suma de montos** | Los totales de dinero no coinciden. Grave. |
| **4. Deuda de un cliente** | La deuda calculada difiere. Es el chequeo más importante. Grave. |
| **5. Recibo del pago** | Se perdió el vínculo entre un pago y su PDF. Anular ese recibo no funcionaría. |
| **6. honorariosProgramados** | Se perdió un honorario histórico. Afecta el cálculo de meses viejos. |
| **7. Mes de inicio** | Una fecha de alta se interpretó distinto. Cambia desde qué mes se adeuda. |

**El caso más probable y menos grave es el 1b (pagos huérfanos):** pagos cuyo cliente fue borrado
en algún momento. El informe lista cada uno con su id, su cliente y su monto. Decidí vos si esos
pagos importan. Si no importan, no hay nada que hacer: el script simplemente no los migra y te lo
informa. Si importan, avisame y vemos.

**Para cualquier otro chequeo en FALLA: pará y avisame.** Mandame el archivo
`data\migracion-verificacion.txt`. Los `.xlsx` siguen intactos, así que no hay urgencia ni riesgo
de perder nada.

---

## Paso 7 — Arrancar y probar a mano

Arrancá el sistema con `iniciar.bat` como siempre.

Probá estas cinco cosas, en este orden. Son las que cubren todo lo que se migró:

1. **Pestaña General.** ¿El total adeudado y la cantidad de clientes coinciden con lo que anotaste
   en el Paso 2? Si no coinciden, pará y avisame.

2. **Pestaña Clientes.** Entrá al historial de dos o tres clientes que conozcas bien.
   ¿Los meses y los montos son los de siempre?

3. **Registrar un pago de prueba.** Elegí un cliente, cargá un pago chico y generá el recibo.
   Tiene que ser **instantáneo** — ese es todo el punto de esta migración. Si tarda segundos,
   algo salió mal.

4. **Anular ese recibo de prueba.** El archivo PDF tiene que renombrarse con el prefijo
   `[ANULADO]`, y la deuda del cliente tiene que volver a su valor anterior.

5. **Editar un cliente.** Cambiale el teléfono a alguno, guardá, y recargá la página para
   confirmar que quedó.

Si las cinco salen bien, la migración está hecha.

---

## Paso 8 — Los días siguientes

- **No borres los `.xlsx` ni los ZIP de backup.** Dejalos como están al menos **un mes**.
  No molestan y son tu seguro.
- Los backups diarios siguen funcionando igual, pero ahora comprimen la base SQLite.
  Confirmá al día siguiente que apareció un ZIP nuevo en `backups\`.
- Si en algún momento el sistema no arranca o algo se ve raro, la vuelta atrás de abajo sigue
  siendo válida mientras los `.xlsx` estén ahí.

---

## Vuelta atrás

Si en cualquier momento querés volver al sistema anterior:

**Si usaste git:**

Existe una rama `pre-migracion-sqlite` que apunta al último estado con Excel, justo antes de la
migración. Volver es cambiarse a ella:

```
cd "ruta\al\proyecto"
git checkout pre-migracion-sqlite
del SW-Capella-Codigo\data\capella.db
```

Para confirmar que volviste bien, `SW-Capella-Codigo\backend\` **no** debe tener `db.js` ni
`mappers.js`. Si los tiene, seguís en `main`.

Cuando quieras volver a la versión nueva: `git checkout main`.

**Si copiaste los archivos a mano:**

1. Restaurá `excelManager.js`, `rebuild-historial.js` y `server.js` desde la copia que guardaste
   en el Paso 3.
2. Borrá `data\capella.db`.
3. Borrá los archivos nuevos (`db.js`, `mappers.js`, `migrar-a-sqlite.js`, `bench-pagos.js`,
   `test-migracion.js`, la carpeta `legacy`). No es estrictamente necesario, pero deja todo limpio.

Después arrancá con `iniciar.bat`. Vuelve a funcionar como antes, lento pero correcto, con los
`.xlsx` exactamente donde estaban.

**No hace falta restaurar ningún backup.** Los Excel nunca se modificaron.

---

## Resumen para tener a mano

```
0. node --version                          -> 23.4+ ideal; probar node:sqlite
1. Cerrar la app en todas las PC           -> Stop-Process -Name node -Force
2. Copiar data/ a un pendrive              -> anotar total adeudado y cant. clientes
3. git checkout main && git pull  (o copiar)-> guardar copia de los 3 archivos viejos
4. node test-migracion.js                  -> DEBE dar 40/40
5. node migrar-a-sqlite.js                 -> crea capella.db
6. Leer data/migracion-verificacion.txt    -> DEBE decir "migracion verificada"
7. iniciar.bat + las 5 pruebas a mano      -> pago, recibo, anulacion, edicion
8. No borrar los .xlsx por un mes
```
