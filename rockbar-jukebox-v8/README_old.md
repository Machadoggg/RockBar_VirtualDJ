# Rockbar Jukebox

App web para que los clientes del bar, desde su celular y conectados al WiFi
del local, elijan una cancion de video de una lista y la agreguen al Automix
de VirtualDJ Pro. Incluye un limite de pedidos por dispositivo para evitar
abusos, y un panel simple para el DJ.

Como funciona en resumen:

1. Esta app corre como un servidor Node.js en LA MISMA PC donde esta
   VirtualDJ (o en otra PC de la misma red, ver nota al final).
2. El cliente escanea un codigo QR. Antes de ver la lista, le pide un
   nombre/apodo y le sugiere seguir al bar en Instagram (a cambio de un
   credito extra).
3. Ve la lista de canciones (leida directo de tu carpeta de videos) y toca
   "Agregar". Si esa cancion ya esta en el Automix DE VIRTUALDJ AHORA MISMO
   (se consulta en vivo), el boton dice "En lista" en vez de "Agregar", y
   vuelve a decir "Agregar" solo cuando esa cancion ya sono y salio de la
   lista.
4. La app le pide a VirtualDJ (via su "Network Control Plugin" oficial) que
   busque esa cancion en el browser y la agregue al Automix.
5. Cada celular tiene 2 pedidos "gratis" cada 2 horas (configurable). Si se
   quedan sin cupo, pueden ganar creditos extra siguiendo al bar en
   Instagram o jugando a la ruleta (con un tiempo de espera entre partidas
   para que no se puedan juntar creditos infinitos).

---

## 1. Requisitos

- Windows, con VirtualDJ **2023 o mas nuevo**, licencia **Pro** (vos tenes
  2026 Pro, cumple).
- [Node.js](https://nodejs.org/) 18 o mas nuevo instalado en esa misma PC
  (bajar el instalador "LTS" y darle Next-Next-Finish).
- Todos los videos de las canciones en UNA carpeta, con nombres de archivo
  con el formato `Titulo - Artista.ext` (ej: `Highway to Hell - AC-DC.mp4`).
  Esto ya coincide con como los tenes organizados.

## 2. Activar el Network Control Plugin en VirtualDJ

Este es el plugin oficial de VirtualDJ que permite controlarlo por red. Es
lo que usa esta app para agregar canciones al Automix.

1. Abri VirtualDJ.
2. Anda a **Config -> Extensions -> Effects -> Other**.
3. Instala el plugin **"Network Control"** (queda instalado, pero todavia
   no esta activo).
4. Arriba del mezclador central, donde estan las pestañas
   **AUDIO | Video | Scratch | MAESTRO**, hace clic en **MAESTRO** (es la
   misma zona donde en la pestaña AUDIO ves los efectos Flanger/Reverb/
   Wahwah de cada deck, pero para el canal Master).
5. Ahi vas a ver un desplegable de **Efectos Master**. Hace clic en la
   flechita para abrir la lista de plugins instalados, buscá
   **"Network Control"** y hace clic en el nombre para activarlo.
6. Al activarse aparece un icono de rueda dentada (⚙) al lado del nombre.
   Apretalo para abrir su configuracion.
7. Anota el **puerto** que te muestra (por defecto suele ser algo como
   `8093`). Opcionalmente poné una contraseña ("bearer token") para que
   nadie mas en la red pueda mandarle comandos a tu VirtualDJ.

   *(Si tu version de VirtualDJ muestra otros nombres o ubicaciones,
   la referencia oficial es: Manual de VirtualDJ, seccion "Mixer -> Master",
   apartado "Master Effects".)*

## 3. Instalar la app

1. Copia toda esta carpeta `rockbar-jukebox` a la PC del VirtualDJ (por
   ejemplo en `C:\rockbar-jukebox`).
2. Copia el archivo `.env.example` y renombra la copia a `.env`.
3. Abri `.env` con el Bloc de notas y completa:
   - `VIDEOS_FOLDER`: la ruta completa de la carpeta con los videos.
   - `VDJ_PORT`: el puerto que anotaste del Network Control Plugin.
   - `VDJ_BEARER`: la contraseña que le pusiste al plugin (si le pusiste
     alguna; si no, dejalo vacio).
   - `REQUESTS_PER_WINDOW` / `REQUEST_WINDOW_MINUTES`: cuantas canciones
     "gratis" puede pedir un mismo celular y cada cuanto se renueva ese
     cupo (por defecto 2 cada 120 minutos).
   - `INSTAGRAM_HANDLE` / `INSTAGRAM_URL`: el usuario y link de Instagram
     del bar (ver seccion "Nombre, Instagram y creditos" mas abajo).
   - `BAR_NAME`: el nombre de tu bar, para que aparezca en la pagina.
   - `PUBLIC_URL`: la dejamos para el paso 4.

## 4. Averiguar la IP de la PC y completar PUBLIC_URL

1. En la PC del VirtualDJ, abri el Simbolo del sistema (cmd) y escribi:

   ```
   ipconfig
   ```

2. Buscá la "Direccion IPv4" de la red WiFi/Ethernet del bar. Va a ser algo
   como `192.168.1.50`.
3. En `.env`, completá:

   ```
   PUBLIC_URL=http://192.168.1.50:3000
   ```

   (cambiando la IP por la tuya, y dejando el puerto 3000 salvo que hayas
   cambiado `PORT` en el mismo archivo).

## 5. Abrir el puerto en el Firewall de Windows

Para que los celulares conectados al WiFi puedan llegar a la app, hay que
permitir el puerto en el firewall. Con permisos de administrador, corre en
PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Rockbar Jukebox" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

(cambiá `3000` si usaste otro puerto).

## 6. Arrancar la app

Doble click en **`start.bat`**. La primera vez va a instalar las
dependencias (tarda un minuto), despues arranca el servidor. Dejá esa
ventana abierta mientras el bar esta atendiendo.

Para confirmar que anda, desde un celular conectado al WiFi del bar, entra a
la URL que pusiste en `PUBLIC_URL` (ej `http://192.168.1.50:3000`). Deberias
ver la lista de canciones.

## 7. Generar e imprimir el codigo QR

Con la app instalada (paso 6 ya hecho al menos una vez), corre:

```
npm run qr
```

Esto crea `qr-para-imprimir.png` en la carpeta del proyecto. Imprimilo y
pegalo en las mesas/barra. También podes ver el mismo QR entrando a
`http://<IP-DE-LA-PC>:3000/admin` desde cualquier navegador.

## 8. Panel del DJ / encargado

Entra a `http://<IP-DE-LA-PC>:3000/admin` desde la PC o el celular del
encargado. Te pide un token: es el valor de `ADMIN_TOKEN` en tu `.env`
(cambialo por algo que solo ustedes conozcan). Ahi podes ver cuantos
pedidos hizo cada celular esta noche, resetear a uno en particular, o
resetear todos (por ejemplo, al empezar una noche nueva si queres arrancar
de cero antes de la hora automatica de reinicio).

El contador se reinicia solo todos los dias a la hora que pongas en
`NIGHT_RESET_HOUR` del `.env` (por defecto las 6 AM), para que una noche que
pasa la medianoche cuente como una sola noche.

## 9. Nombre, Instagram, creditos y el boton "En lista"

**Nombre obligatorio.** La primera vez que alguien entra cada noche, le pide
un nombre/apodo antes de dejarlo ver la lista de canciones (se puede
desactivar con `NICKNAME_REQUIRED=false` en el `.env`). Ese nombre es el que
va a ver en la columna "Nombre" del panel `/admin`.

**Sugerencia de Instagram.** En esa misma pantalla de bienvenida (y tambien
con un boton en el encabezado de la app despues) se le sugiere seguir la
cuenta configurada en `INSTAGRAM_HANDLE` / `INSTAGRAM_URL`. Si toca "Ya te
sigo, sumar credito", gana `CREDITS_PER_INSTAGRAM` creditos (una sola vez
por noche).

⚠️ **Importante — esto es "a confianza":** Instagram no ofrece ninguna forma
de que una pagina web comun verifique de verdad si alguien sigue una cuenta
(eso requeriria que el usuario inicie sesion con su cuenta de Instagram via
una integracion oficial de Meta, con revision de la app incluida — mucho mas
alla del alcance de esta app). El credito se otorga apenas tocan el boton,
sin verificacion real. Es el mismo mecanismo que usan la mayoria de los
"segui y gana" de bares/eventos.

**Limite base + creditos.** Cada celular tiene `REQUESTS_PER_WINDOW`
pedidos gratis cada `REQUEST_WINDOW_MINUTES` minutos (por defecto: 2 cada
120 min), que se van renovando solos con el tiempo. Si se quedan sin cupo
gratis, pueden seguir pidiendo canciones gastando los creditos que hayan
ganado (1 pedido = 1 credito). Los creditos se ganan:
- Siguiendo Instagram (`CREDITS_PER_INSTAGRAM`, una vez por noche).
- Jugando, boton "🎮 Juegos" (`CREDITS_PER_GAME` por partida, con un
  tiempo de espera de `GAME_COOLDOWN_MINUTES` minutos entre partidas —
  esto es lo que evita que alguien junte creditos infinitos jugando en
  bucle).

**El boton "🎮 Juegos" abre un menu con 3 juegos:** Ruleta de creditos,
Duck Hunt (tocar un pato que se mueve, 3 veces antes de que se acabe el
tiempo) y Trivia Rock (una pregunta de cultura rockera al azar). Los 3
suman credito por participar (no hace falta ganar/acertar), y **comparten
el mismo cooldown**: jugar cualquiera de los 3 cuenta como "la partida" de
ese rato — no se puede sacar credito de mas jugando varios juegos seguidos.
Si querés agregar mas juegos al menu mas adelante, se define en
`public/index.html` (bloque `#gameHubView`) y `public/app.js` (buscá
`GAME_VIEWS`), y solo tienen que terminar llamando a la misma funcion
`claimGameCredit()` para respetar el cooldown compartido.

**Boton "En lista".** El boton muestra "En lista ✓" mientras esa cancion
este REALMENTE en el Automix de VirtualDJ en este momento — es una consulta
en vivo (`file_count 'automix'` + `get_filepath 'automix' N`, uno de los
pocos comandos de VDJscript que sí permiten leer el contenido del Automix
desde afuera, confirmados a mano contra una instancia real). Se cachea por
`AUTOMIX_CACHE_TTL_MS` (8 segundos, fijo en `server.js`) para no golpear a
VirtualDJ en cada refresco de cada celular. Esto tiene una consecuencia
importante:

⚠️ **Necesita que la opcion "Auto remove played" del Automix este activada
en VirtualDJ.** Si esta apagada, las canciones que ya sonaron se quedan
igual dentro de la lista del Automix (aunque VirtualDJ las marque como ya
reproducidas), y como la app lee esa misma lista, el boton se va a quedar
en "En lista" hasta que el DJ las saque a mano. Con "Auto remove played"
activado (la config habitual para este uso), en cuanto una cancion termina
de sonar VirtualDJ la saca solo de la lista, y el boton en la app vuelve a
"Agregar" automaticamente en el siguiente refresco (hasta 8 segundos
despues, mas el intervalo de refresco del celular).

Si el DJ agrega canciones a mano desde VirtualDJ (no via la app), tambien
van a aparecer como "En lista" — es la lista real del Automix, no importa
quien haya agregado cada cancion.

Si VirtualDJ esta cerrado o el plugin no responde en el momento de
consultar, la app sigue mostrando el ultimo estado que pudo leer (en vez de
romperse), y lo reintenta solo en la siguiente consulta.

Todo esto (nombre, creditos) se reinicia junto con el resto a la
hora configurada en `NIGHT_RESET_HOUR`.

---

## Probar y ajustar la integracion con VirtualDJ (IMPORTANTE)

La forma en que VirtualDJ agrega una cancion al Automix por script es:
1. Navegar a la carpeta correcta.
2. Buscar/seleccionar la cancion en el browser de VirtualDJ.
3. Ejecutar el comando `playlist_add`.

**Importante:** VDJscript no tiene forma de "esperar" dentro de un mismo
comando. Si le mandas los 3 pasos juntos en un solo script, VirtualDJ puede
ejecutar `playlist_add` antes de que la busqueda termine de mover la
seleccion — y termina agregando al Automix la cancion que haya quedado
seleccionada de ANTES, no la que pediste (por ejemplo, siempre la misma
cancion, sin importar cual elijas en el celular).

Por eso esta app manda los pasos como llamadas SEPARADAS a VirtualDJ, con
una pausa real entre cada una. Se configuran en `.env` como
`VDJ_SELECT_SCRIPT` (pasos separados por `||`) y `VDJ_STEP_DELAY_MS`
(pausa en milisegundos entre cada paso):

```
VDJ_SELECT_SCRIPT=browser_gotofolder "{folder}" || search "{query}" || playlist_add & search ""
VDJ_STEP_DELAY_MS=400
```

Es decir: entra a tu carpeta de videos, esperá 400ms, busca el nombre exacto
del archivo (sin extension), esperá otros 400ms, agrega el resultado
seleccionado al Automix, y limpia la busqueda.

**Antes de abrir al publico, probalo vos mismo:** entra a la pagina desde tu
celular, pedí 3 o 4 canciones DISTINTAS seguidas, y confirma en VirtualDJ
que:

- Cada pedido agrego la cancion CORRECTA al Automix (no siempre la misma).
- Se agrego al final de la lista de Automix (asi funciona por defecto; si
  preferis que se agregue justo despues de la que esta sonando, cambia
  `playlist_add` por `automix_add_next` en el `.env`).

**Si sigue agregando siempre la misma cancion o la incorrecta:** subi
`VDJ_STEP_DELAY_MS` (por ejemplo a 700 u 800) y reiniciá la app — tu PC
puede tardar un poco mas en refrescar la lista filtrada. Si el buscador de
VirtualDJ no indexa el nombre de archivo tal cual sino los tags de
Titulo/Artista, probá cambiar `{query}` para que use eso en vez del nombre
de archivo completo, o pedile ayuda a soporte de VirtualDJ / su comunidad
(foro oficial) mencionando el "Network Control Plugin" y el verbo
`playlist_add`.

## Notas de seguridad

- El "Network Control Plugin" con contraseña vacia permite que cualquiera en
  la red WiFi mande comandos arbitrarios a tu VirtualDJ. Se recomienda
  ponerle una contraseña (bearer token) y copiarla en `VDJ_BEARER`.
- El panel `/admin` no tiene un login sofisticado, es solo un token simple.
  No lo compartas mas alla del personal del bar.
- Los datos de pedidos se guardan en `data/requests.json` dentro de la
  carpeta del proyecto (nada se manda a internet).

## Preguntas frecuentes

**¿Puede correr en otra PC, no la del VirtualDJ?**
Si, siempre que este en la misma red WiFi y VirtualDJ tenga el puerto del
Network Control Plugin accesible desde esa PC (cambiando `VDJ_HOST` en
`.env` por la IP de la PC del VirtualDJ, y abriendo tambien ese puerto en el
firewall de la PC del VirtualDJ).

**¿Que pasa si dos personas piden la misma cancion?**
En cuanto la primera persona la pide con exito, el boton cambia a
"En lista ✓" para TODOS (ver seccion 9) mientras siga en el Automix real de
VirtualDJ — evita que se acumule 5 veces la misma cancion. Apenas esa
cancion termina de sonar y VirtualDJ la saca de la lista (con "Auto remove
played" activado), vuelve a estar disponible para pedirse de nuevo.

**¿Como cambio cuantas canciones puede pedir cada uno?**
Editando `REQUESTS_PER_WINDOW` (cuantas) y `REQUEST_WINDOW_MINUTES` (cada
cuanto se renueva) en `.env` y reiniciando la app. Los creditos por
Instagram/juego se ajustan con `CREDITS_PER_INSTAGRAM`, `CREDITS_PER_GAME`
y `GAME_COOLDOWN_MINUTES`.
