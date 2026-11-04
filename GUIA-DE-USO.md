# Freeflow: guía de uso

Programa de escritorio (Windows y Mac) para analizar datos de citometría de flujo (archivos `.fcs`): graficar, dibujar compuertas, compensar y sacar conteos y porcentajes. Todo funciona en tu equipo, sin internet y sin cuenta.

## Instalar

En Windows hay tres formas (el número es la versión, que también se ve arriba a la derecha dentro del programa):

| Archivo | Para qué |
| --- | --- |
| `Freeflow-Setup-X.Y.Z.exe` | Instalador: pregunta si es para ti o para todos los usuarios, deja elegir la carpeta, crea accesos directos (escritorio y menú Inicio), asocia `.fcs` y `.ffwb` y trae desinstalador (ver "Desinstalar"). |
| `Freeflow-Portable-X.Y.Z.exe` | Un solo archivo, sin instalar: se descomprime en la carpeta temporal en cada arranque y la borra al cerrar. No deja nada en el equipo salvo tus preferencias. |
| `Freeflow-X.Y.Z-win-x64.zip` | Extrae la carpeta donde quieras (un USB, el escritorio) y abre `Freeflow.exe`. Es la opción más segura frente a los avisos de Windows. Trae `LICENSE.txt` y `README-WINDOWS.txt`. |

**Avisos de Windows.** El programa no está firmado con un certificado de editor, y Windows 11 decide por su cuenta si lo deja correr:
- **SmartScreen** puede decir "Windows protegió su PC": pulsa **Más información** y luego **Ejecutar de todos modos**.
- **Control de aplicaciones / Smart App Control** puede bloquear archivos sin firmar que no conoce ("Una directiva de Control de aplicaciones bloqueó este archivo"). El `Freeflow.exe` del zip y el de la copia instalada es el de Electron sin modificar, que Windows reconoce, así que abre siempre. El instalador y el portable son archivos nuevos en cada versión: Windows puede bloquearlos en el primer intento y dejarlos abrir minutos después, sin que cambie el archivo. Si ocurre, usa el **zip** o prueba de nuevo unos minutos después. La solución definitiva es firmar el programa con un certificado de firma de código (por ejemplo *Azure Trusted Signing*, o *SignPath Foundation*, gratis para proyectos de código abierto), o desactivar Smart App Control en *Seguridad de Windows > Control de aplicaciones y navegador* (no se puede volver a activar sin reinstalar Windows).

## Desinstalar

- **Instalado con `Freeflow-Setup`:** *Configuración > Aplicaciones > Aplicaciones instaladas > Freeflow > Desinstalar* (o `Uninstall Freeflow.exe` en la carpeta de instalación). Quita el programa, los accesos directos y la asociación de `.fcs`/`.ffwb`. **No borra tus preferencias** (carpeta `%APPDATA%\Freeflow`) **ni tus archivos** `.ffwb` y `.fcs`.
- **Zip o portable:** cierra Freeflow y borra la carpeta (o el archivo del portable). No hay nada más que quitar.
- **Quitar también las preferencias:** borra `%APPDATA%\Freeflow` (pégalo en la barra del Explorador de archivos).
- **Cambiar de versión:** instala encima de la anterior (el instalador la reemplaza) o usa el zip nuevo en otra carpeta; los Workbench de versiones anteriores abren sin cambios.

## Abrir datos

- **Archivo > Add FCS files…** (varios a la vez).
- **Arrastra** archivos `.fcs` (o un Workbench `.ffwb`) a la ventana.
- **Doble clic** en un `.fcs` o `.ffwb` si lo asocias con Freeflow (Clic derecho > Abrir con).
- Si algún archivo no se puede abrir, aparece un aviso arriba con el nombre y el motivo, y los demás sí se cargan. El aviso se queda hasta que pulses **Dismiss**.
- Si el archivo está en **OneDrive**, déjalo como "Mantener siempre en este dispositivo", o Windows puede no dejarlo leer.

## Graficar

- Elige **X** e **Y** arriba del gráfico. **Plot**: *Pseudocolor* (puntos por densidad) o *Histogram*.
- **T** junto a cada eje abre la escala de **ese** eje (cada uno tiene la suya): Linear, Log, Biexponencial, Arcsinh. Los ejes se ajustan solos a los datos de **todas** tus muestras. Cambiar la escala no mueve los gates respecto a los datos.
- **Contour** y **Zebra** (selector *Plot*): en lugar de puntos, líneas de igual densidad. Cada línea encierra una parte de los eventos: de la más interna (~5 %) a la más externa (~95 %). *Zebra* rellena las bandas entre líneas alternando dos tonos. **Lines** (5, 10, 15 o 20) cambia cuántas líneas; **Outliers** dibuja como puntos los eventos fuera de la línea más externa. Las compuertas se dibujan, editan y cuentan igual que en Pseudocolor, y **All samples** y la exportación a PNG también los usan.
- **Overlays** (botón junto al gráfico): dibuja sobre el gráfico abierto otra población, de esta muestra o de otra, con los mismos ejes. Las **pestañas son los grupos de primer nivel** (*All Samples* y cada grupo); si el grupo elegido tiene **subgrupos**, aparece un selector **Subgrupo** al lado del de población (con *All of …* para el grupo entero y cada subgrupo con su número de muestras). Debajo, las muestras son botones: **pulsar una la superpone** (su color aparece en el botón) y otro clic la quita. **Remove all** quita todas las superposiciones. El selector **Population** elige qué población de ellas se dibuja (por defecto la que tienes abierta). **Overlay all** añade de una vez todas las demás muestras de las que se listan; las flechas ← → cambian de pestaña. En un **histograma** es una curva por superposición, con leyenda; **Normalize to mode** pone cada curva a su propia altura máxima (eje en % del máximo) y **Smooth** suaviza. En un gráfico de **dos parámetros** son puntos de color (hasta 6 000 por superposición). Cada etiqueta con la X se quita. Las superposiciones se guardan con el Workbench y salen en la exportación a PNG.
- **File > Export plot image (PNG)…** guarda el gráfico tal como se ve.

## Compuertas

Herramientas junto al selector de gráfico:

| Herramienta | Cómo |
| --- | --- |
| Flecha | Seleccionar, mover y editar |
| Polígono | Clic en cada punto, doble clic para cerrar (Esc cancela) |
| Rectángulo / Elipse | Arrastrar |
| Cuadrante (+) | Un clic donde se cruzan las líneas: crea 4 poblaciones |
| Rango (histograma) | Arrastrar a lo largo del eje |

**Editar una compuerta ya dibujada** (flecha): arrastra un cuadrito blanco para cambiar el perímetro (esquinas, bordes, vértices del polígono), arrastra por dentro para moverla, o usa las **flechas del teclado** (Shift: pasos más grandes). En un cuadrante, el centro mueve las dos líneas y el extremo de cada línea mueve solo esa. Esc cancela un arrastre. Cada cambio se puede deshacer.

**Árbol de poblaciones** (izquierda): doble clic o F2 para renombrar, Supr para borrar. Columnas: conteo, % del padre, % del total. Clic en una población para ver solo esos eventos y seguir filtrando.

## Poblaciones booleanas (AND, OR, NOT)

El botón **Boolean…** del árbol de poblaciones combina poblaciones de la muestra abierta: **AND** (eventos en todas las elegidas), **OR** (en alguna) y **NOT** (fuera de la elegida). La nueva población cuelga de *All events*, lleva un símbolo (∧ ∨ ¬) y se puede seguir gateando dentro de ella. Si borras una población usada, también se borran las booleanas que la usan. Con *Link gates in group* y *Apply to group* viajan a las demás muestras apuntando a sus propias poblaciones.

## Ver varias gráficas a la vez, y recorrer las muestras

Arriba del gráfico hay tres vistas (**Single plot / All samples / Sheet**) y un interruptor **Smooth / Raw**:

- **Single plot:** el gráfico grande, donde se dibujan y editan las compuertas.
- **All samples:** el mismo gráfico (mismos ejes, misma población, mismas compuertas con su %) para **todas las muestras del grupo**, en miniaturas. Flechas del teclado para pasar de una a otra; doble clic abre una sola.
- **Sheet (hoja):** **varias gráficas distintas de la muestra elegida**, como en una hoja de análisis. **Plots from gates** crea una gráfica por compuerta, cada una sobre su población padre y con sus ejes (la estrategia de gating de un vistazo); **Add plot** añade la que tienes abierta; cada gráfica tiene sus selectores de población, tipo y ejes, y botones para abrirla en grande o quitarla. Al cambiar de muestra (botones ‹ ›, flechas o Re Pág / Av Pág) la hoja muestra **las mismas gráficas con los datos de la nueva muestra**. La hoja se guarda con el Workbench. **Editar compuertas dentro de la hoja:** el lápiz de cada gráfica la abre en un **editor** encima de la hoja, donde se dibujan, mueven y borran compuertas como en Single plot; las miniaturas se actualizan al momento, y los cambios de ejes, tipo o población hechos en el editor son también los de la gráfica de la hoja. Con las flechas o Av Pág el editor pasa a la muestra siguiente.
- **Zoom de las miniaturas** en las dos vistas de miniaturas (*All samples* y *Sheet*): **Ctrl + rueda del ratón** sobre ellas (o el pellizco en un panel táctil) las hace **todas** más grandes o más pequeñas a la vez, como en el Explorador de archivos de Windows; el deslizador **Size** hace lo mismo. Sin Ctrl, la rueda solo desplaza. El tamaño se recuerda.
- **Smooth:** colores por densidad en pseudocolor, curvas suavizadas en histogramas y líneas suaves en contour/zebra. **Raw:** cada evento tal cual: puntos lisos de un solo color, barras sin suavizar y contornos sin alisar. Se recuerda entre sesiones.
- **Recorrer muestras con el teclado:** con el foco en la lista de muestras, **Flecha abajo / arriba** pasa a la siguiente o anterior (y **Inicio / Fin**); en cualquier parte de la ventana, **Av Pág / Re Pág** hacen lo mismo (menos dentro de un campo de texto o selector).

## Cluster Explorer (mapa UMAP o t-SNE)

Modo **Cluster Explorer** (Alt+5). Dibuja los eventos de una población como un mapa en el que las células parecidas quedan juntas, y los agrupa en clústeres.

1. Elige **Samples**: la muestra seleccionada, o **todo el grupo unido en un solo mapa** (concatenación virtual: de cada muestra se toma el mismo número de eventos, repartidos a lo largo del archivo, para que ninguna pese más).
2. Elige la **población** (por ejemplo *Lymphs*) y los **parámetros** (por defecto los de fluorescencia; botones *Markers / All / None*). Cada parámetro se mide en la misma escala que los gráficos.
3. Elige el **método**: *UMAP* (más rápido, hasta 10 000 eventos por muestra) o *t-SNE* (más lento, islas más nítidas, hasta 2 500) y el número de **clústeres**.
4. **Run**. Corre aparte de la ventana (puedes seguir usando el programa) y se puede cancelar.

Resultado: el mapa, coloreable por **clúster**, por **muestra** o por **cada marcador**; una tabla con los eventos y el % de cada clúster y un **mapa de calor** (azul: por debajo del promedio de los clústeres; rojo: por encima); y, si hay varias muestras, una tabla con **qué % de cada muestra cae en cada clúster**, que es la forma rápida de ver qué cambia entre una muestra y la referencia. Un clic en el nombre de un clúster lo resalta en el mapa. **Re-cluster** agrupa el mismo mapa con otro número de clústeres. **Export events (CSV)** guarda cada evento con su posición, clúster y valores; **File > Export plot or chart image** guarda el mapa como PNG. Los clústeres se calculan sobre los parámetros, no sobre el mapa. Los resultados se quedan mientras el programa está abierto, pero no se guardan en el Workbench (los eventos se vuelven a calcular con *Run*).

## Organizar la pantalla

- **Paneles a tu medida:** las barras entre el centro y los paneles de los lados se **arrastran** para hacer el panel izquierdo (grupos, muestras, poblaciones) o el derecho (detalles) más ancho o más angosto; el gráfico del centro se ajusta solo. También se mueven con el **teclado** (enfoca la barra y usa ← →; Mayús para pasos grandes; Inicio / Fin para el mínimo y el máximo). El botoncito de la barra, o doble clic en ella, **pliega el panel entero** y lo vuelve a sacar; el menú **View** también.
- **Secciones:** *Groups*, *Samples* y *Populations* del panel izquierdo tienen una barra entre ellas para **cambiar su altura**, y su título las **pliega**. En el panel derecho se pliegan por bloques: *Sample*, *Group comparison* y *Parameters*.
- **El botón T** (escala de un eje) **abre solo el panel de la derecha** si estaba plegado, para que veas el panel de escala.
- **Todo se recuerda** entre sesiones. **View > Reset the layout** lo deja como al principio.

## Muestras: quitar, marcar varias, ordenar y subagrupar

- **Cambiar el nombre de una muestra:** doble clic sobre su nombre, o **F2** con la muestra enfocada; Enter acepta y Esc cancela. El nombre nuevo se usa en todas partes (tablas, gráficos, etiquetas, orden) y se guarda en el Workbench; el archivo FCS del disco conserva el suyo. Sirve para dejar nombres como 1 WT, 2 KO… y ordenar con *Sort… > Name*.
- **Marcar varias:** Ctrl+clic suma o quita una muestra; Mayús+clic marca el rango (o Mayús+flecha).
- **Supr depende de dónde estés:** dentro de un **grupo o subgrupo**, **Supr** (o la papelera) **saca la muestra de ese grupo** y la deja en el grupo de arriba (o en *All Samples* si el grupo era de primer nivel); sigue en el Workbench y no pregunta nada. En **All Samples**, Supr **quita la muestra del Workbench** (ver abajo). El botón dice qué hará (*Remove sample from the group* / *Remove sample*).
- **Quitar muestras del Workbench:** con *All Samples* mostrado, tecla **Supr**, el botón de la papelera, o **Remove from the Workbench…** del menú de clic derecho. Pregunta antes: quita la muestra y sus compuertas del Workbench, **no toca el archivo FCS** en el disco, y **no se puede deshacer** (por eso se borra el historial de Deshacer).
- **Ordenar:** el selector **Sort…** de *Samples* pone las muestras en el orden elegido: nombre natural (S2 antes que S10), A–Z, Z–A, más o menos eventos, más antiguas o nuevas (fecha del archivo), por grupo, o por el valor de cualquier **palabra clave** del archivo. Las muestras sin ese dato quedan al final. El orden se guarda en el Workbench y es el que siguen las flechas, la galería, las tablas y los gráficos. A mano: **arrastra** una muestra sobre otra (queda antes) o **Alt+↑ / Alt+↓** para subirla o bajarla un lugar. Las muestras nuevas se añaden al final.
- **Subgrupos:** el botón de la flecha en *Groups* (**New subgroup**) crea un grupo dentro del grupo seleccionado. **Arrastra** muestras sobre un grupo para moverlas, o un grupo sobre otro para volverlo su subgrupo (sobre *All Samples* vuelve a ser de primer nivel). Un grupo muestra sus muestras **y las de sus subgrupos**.
- **Compuertas propias por subgrupo:** con *Link gates in group*, las compuertas se comparten solo entre las muestras del **mismo** grupo exacto, así que cada subgrupo tiene las suyas. Para repartir una compuerta del grupo de arriba hacia abajo, selecciónala en una muestra del grupo y pulsa **Apply to group**: llega a todas las muestras del grupo y de sus subgrupos, una vez, y cada subgrupo sigue luego con las suyas.
- Al borrar un grupo, sus muestras y subgrupos **suben un nivel**.
- **Cómo se ven los subgrupos:** el árbol de grupos dibuja **ramas** (líneas verticales y codos, como un árbol de carpetas) para que se vea qué grupo está dentro de cuál; un grupo con subgrupos se **pliega y despliega** (pulsa su flechita, o ← →). En la lista de muestras, cada una lleva una etiqueta con **la ruta de su grupo** (por ejemplo Treated › Low dose) cuando estás viendo un grupo de nivel superior.
- **Aplicar una compuerta a donde quieras:** bajo el árbol de poblaciones, el botón **Apply to…** (y el clic derecho sobre una población > *Apply to…*) ofrece: *All samples*, **cada grupo de los que contienen a la muestra abierta** (el de primer nivel hasta su subgrupo, con el número de muestras a las que llegaría) y *The marked samples*. Hay dos acciones: **Apply the selected gate to** (copia la compuerta elegida, con lo que cuelga de ella) y **Replace the whole gating of** (reemplaza todo el gating de esas muestras por el de la abierta, pidiendo confirmación). Se puede deshacer. Los botones rápidos *Apply to group* y *Resync all* siguen igual (a las muestras de su grupo y subgrupos).

## Menú de clic derecho

Clic derecho (o la tecla de menú / **Mayús+F10** con el elemento enfocado) abre un menú **del mismo tema** que el programa (claro u oscuro), con submenús (se abren al pasar el ratón, o con →; ← los cierra; ↑ ↓ recorren; Esc cierra y devuelve el foco). Actúa sobre la muestra pulsada, o sobre **todas las marcadas** si la pulsada es una de ellas.

- **Sobre una muestra:** *Show* (como gráfico único, el mismo gráfico para todas, en la hoja, Quality control, Metadata, Compensation o Cluster Explorer) · *Overlay … on the open plot* (la superpone/quita en el gráfico abierto) · *Rename…* · *Move to group* (cualquier grupo o subgrupo, *no group*, o *New group from the selection*) · *Gates* (*Copy the gating of … to* las otras marcadas, el resto de su grupo o todas; *Clear the gates*) · *Compensation matrix* (elige una matriz o *None*) · *Export* (estadísticas de esas muestras o de todas, en CSV) · *File* (*Show in folder*, *Copy the file path*) · *Sort the list* · *Remove from its group* · *Remove from the Workbench…*.
- **Sobre un grupo:** *New group*, *New subgroup here*, *Rename…*, *Move into* (otro grupo o primer nivel), *Select its samples*, *Overlay its samples on the open plot*, *Sort its samples*, *Delete the group*.
- **Sobre una población del árbol:** *Show as the plot*, *Overlay on the open plot*, *Same population in all samples*, *Rename…*, *Apply to the group*, *New boolean population…*, *Delete*.
- **En el espacio vacío de la lista de muestras:** *Select all*, *Sort the list*, *Add FCS files…*, *Load a demo sample*.

## Una muestra de referencia y las demás (el caso típico)

1. Abre la muestra base (por ejemplo la *wild type*) y dibuja el gate, por ejemplo un **Rango** sobre el histograma de FL1-H.
2. Cambia a cualquier otra muestra: **el mismo gate ya está ahí**, con **exactamente los mismos umbrales**, y el árbol de poblaciones muestra qué porcentaje de esa muestra cae dentro. Lo que queda fuera son tus *outliers*.
3. Puedes cambiar la escala de un eje (**T**) cuando quieras: **el gate se queda sobre los mismos valores y los mismos eventos**; solo cambia cómo se dibuja.

Cómo funciona por dentro, para que no sorprenda:
- Los gates se guardan en **valores reales de los datos** (por ejemplo "FL1-H entre 1,000 y 100,000"), no en posiciones de la pantalla.
- Un mismo parámetro usa **la misma escala por defecto en todas las muestras** cargadas, así se ven comparables.
- **Link gates in group** (casilla debajo del árbol, o menú *Gating*): mientras esté marcada, un gate que dibujas, mueves, renombras o borras en una muestra se copia solo a las demás muestras de su grupo, y una muestra que añades o mueves a ese grupo toma los gates que ya tiene. Desmárcala si quieres analizar cada muestra por separado; al volver a marcarla pregunta antes de igualar las demás a la muestra en la que estás.
- Cada grupo o subgrupo es su propia "familia": los gates no pasan entre grupos distintos ni entre un grupo y las muestras de fuera (para repartirlos a propósito, usa *Apply to…*).
- Los archivos guardados con una versión anterior se **convierten** al abrirlos (aparece un aviso); guárdalos de nuevo para dejarlos en el formato actual.
- **Groups**: crea grupos con **+**, y mueve una muestra con el selector **Group** del panel derecho.
- **Apply to group** (Alt+G): copia la compuerta seleccionada (y lo que cuelga de ella) a las demás muestras del grupo. **Resync all** (Alt+Shift+G) reemplaza todo el árbol de las otras muestras por el de la actual (pide confirmación).
- Con el enlace desactivado, las copias son independientes: si cambias una, vuelve a aplicar para repartir el cambio.
- En el panel derecho hay una tabla que compara la población elegida entre todas las muestras del grupo.

## Ver todas las muestras a la vez

En **Graphs**, el botón **All samples** (se activa con 2 o más muestras) muestra el mismo gráfico, con los mismos ejes y las mismas compuertas, para cada muestra del grupo, en miniaturas. Cada compuerta lleva su porcentaje. Sirve para comparar de un vistazo la muestra de referencia (WT) con las demás. Doble clic en una miniatura (o el icono de su título) la abre sola en el gráfico grande. **Single plot** vuelve.

## Estadísticas, tablas y gráficos de barras

- **Tables** (barra lateral, Alt+6): una fila por muestra del grupo elegido a la izquierda y una columna por cada combinación *población + estadística*. Estadísticas: conteo, % del padre, % del total, mediana, media, media geométrica, DE, CV % y percentil N de cualquier parámetro. Las columnas se guardan con el Workbench. **Export CSV** lo abre Excel (el separador sigue tu idioma, o lo fijas en Preferences).
- **Charts** (Alt+7): barras de una columna de la tabla, una barra por muestra o la media ± DE por grupo con los puntos de cada muestra. **File > Export plot or chart image** lo guarda como PNG.
- **Reports** (Alt+8): un informe es una lista de bloques en orden: encabezado, texto, la tabla y gráficos de barras (las columnas salen de Tables y el grupo es el elegido a la izquierda). A la derecha se ve la vista previa. **Export report (HTML)** crea una página única que abre cualquier navegador y que se imprime a PDF desde ahí. Los bloques se guardan con el Workbench.
- **Metadata Manager** (Alt+1): tabla con las palabras clave de cada archivo FCS (fecha, equipo, nombre del tubo…), buscador, y selector de grupo por muestra.
- **Quality Control** (Alt+2): eventos por intervalo de tiempo de la muestra elegida (marca en rojo los intervalos con flujo irregular y da el % de eventos afectados) y detectores saturados (eventos en el tope del rango).
- **Preferences** (Alt+9): modo claro/oscuro y formato de números del CSV.

## Compensación

Modo **Compensation** (icono de cuadrícula, Alt+3). Si el archivo trae matriz de derrame (`$SPILLOVER`), aparece sola, pero **no se aplica hasta que pulses** *Apply to this sample* / *Apply to all samples*. Al aplicarla se crean parámetros `Comp-…` que eliges en los ejes. Puedes editar los valores de la matriz o crear una nueva.

## Guardar y exportar resultados

- **Ctrl+S** guarda tu análisis como Workbench (`.ffwb`). Guarda las compuertas, grupos y escalas, y la **ruta** de cada archivo `.fcs`, no los datos. Si mueves un `.fcs`, el Workbench se abre igual, marca esa muestra y conserva las compuertas.
- **File > Export statistics (CSV)…** crea una tabla con muestra, grupo, población, eventos, % del padre y % del total, lista para abrir en Excel (usa `;` y coma decimal si tu Windows está en español).
- El programa avisa antes de cerrar o abrir otro análisis si hay cambios sin guardar.

## Atajos

| | |
| --- | --- |
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | Nuevo / abrir / guardar / guardar como |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| Alt+1 ... Alt+9 | Cambiar de modo (Metadata, QC, Compensación, Gráficos, —, Tablas, Charts, Reportes, Preferencias) |
| Alt+G / Alt+Shift+G | Aplicar al grupo / Resync |
| Supr | Borrar la compuerta seleccionada |
| Av Pág / Re Pág, o flechas en la lista | Muestra siguiente / anterior |
| Botón sol/luna (arriba a la derecha) | Modo oscuro |

## Versión para Mac

**Descarga:** en la página *Releases* del repositorio están los `.dmg` para Mac con chip Apple (`-mac-arm64`, M1 o más nuevo) y para Mac Intel (`-mac-x64`); en *Acerca de este Mac* se ve qué chip tiene. Abre el `.dmg` y sigue los pasos de "Primera vez en el Mac" más abajo.

Para construirlo uno mismo: el programa de Mac **solo se puede construir en un Mac** (lo exige Apple/Electron). Hay dos formas:

**A. En un Mac** (macOS 11 o más nuevo), con Node.js 24 y una copia de este repositorio:

```
npm ci
npm run dist:mac
```

Aparecen en `release/` un `.dmg` y un `.zip`, para Mac con chip Apple (arm64) y para Mac Intel (x64).

**B. Sin Mac, con GitHub:** el archivo `.github/workflows/build.yml` construye el programa de Mac **y** el de Windows en máquinas de GitHub. En el Mac, además, ejecuta las pruebas unitarias y de interfaz y **arranca el programa una vez** (el paso *Start the program on a Mac and drive it once* dice si abrió bien). En la pestaña *Actions* pulsa *Run workflow* y descarga el resultado desde *Artifacts*.

**Primera vez en el Mac.** El programa no está firmado con una cuenta de desarrollador de Apple, así que macOS lo bloquea la primera vez:
1. Abre el `.dmg` y arrastra Freeflow a *Aplicaciones*.
2. Clic derecho (o Control+clic) sobre Freeflow > **Abrir** > **Abrir**.
3. Si dice que "está dañado", ejecuta una vez en la Terminal: `xattr -cr /Applications/Freeflow.app`

La configuración usa firma "ad hoc" (`identity: "-"`): sin ella, un Mac con chip Apple (M1 o más nuevo) dice que el programa "está dañado" aunque la construcción haya salido bien.

**Desinstalar:** arrastra Freeflow de *Aplicaciones* a la Papelera. Las preferencias están en `~/Library/Application Support/Freeflow`.

**Teclado en Mac:** ⌘ (Comando) en lugar de Ctrl (⌘S, ⌘O, ⌘N, ⌘Z…), ⌥ (Opción) en lugar de Alt (⌥G aplica al grupo, ⌥3 y ⌥4 cambian de modo), y la tecla **⌫** (la que en el Mac se llama "delete") hace lo que **Supr** en Windows. Re Pág / Av Pág son Fn+↑ / Fn+↓. El pellizco en el trackpad hace el zoom de las miniaturas; el clic derecho es Control+clic o el clic con dos dedos. Hay menú de la aplicación de macOS (acerca de, ocultar, salir, copiar y pegar), y abrir un `.fcs` o `.ffwb` desde el Finder lo abre en Freeflow.

**Estado:** la configuración de empaquetado, los atajos y la apertura de archivos para Mac están preparados, pero la versión de Mac **todavía no se ha probado en un equipo real**.

## Seguridad y privacidad

El programa trabaja solo en tu equipo y **no usa la red** (se comprobó en el código y con el programa abierto: ninguna conexión externa). Detalles y cómo repetir la comprobación en SEGURIDAD.md.

## Límites que conviene conocer

- Probado con archivos de un **CytoFLEX** (FCS 3.0) y con datos sintéticos de hasta 2 millones de eventos (cargar y graficar 1.5 millones tarda unos 5 segundos).
- La compensación se comprobó con matrices conocidas y con matrices identidad; **no se ha comparado con otro programa** con una matriz real.
- La barra lateral solo muestra los modos que funcionan. **Todavía no existen:** FlowSOM y otros algoritmos de clústeres además de k-means, usar el mapa UMAP/t-SNE como ejes para dibujar compuertas, la concatenación virtual dentro de los gráficos normales (solo existe en el Cluster Explorer), booleanas con más de un nivel de padres, y la versión de Mac probada.
- No lee los archivos de otros programas (por ejemplo `.wsp`).
