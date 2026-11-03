# Seguridad y privacidad de Freeflow

Revisado en la versión 0.11.1. Esto describe lo que se comprobó, cómo repetirlo y lo que **no** se puede afirmar.

## Qué hace el programa con tus datos

- **Todo ocurre en tu equipo.** Los archivos FCS se leen del disco, se analizan en memoria y los resultados (Workbench `.ffwb`, CSV, PNG, HTML) se guardan solo donde tú eliges en el cuadro de diálogo.
- **No hay red.** El código de la aplicación (`src/`) no contiene ninguna llamada de red (`fetch`, `XMLHttpRequest`, `WebSocket`, `http`, `https`, `net`, balizas), ni una sola dirección `http(s)://`, ni telemetría, ni actualizaciones automáticas, ni cuentas ni inicio de sesión. Comprobación en una ejecución real: el programa abierto 25 segundos no tenía **ninguna conexión TCP externa ni puntos UDP**.
- **No se envía nada a nadie**, y el programa no lee nada que no le des: no recorre carpetas, no mira otros programas, no toca el portapapeles salvo cuando pulsas *Copy the file path*.
- **Lo único que se guarda sin preguntar** son preferencias en el almacenamiento local de la ventana: tema, formato de números del CSV, tamaño de miniaturas y medidas de los paneles. No contienen datos de muestras.

## Cómo está protegida la ventana

- El código de la página no tiene acceso a Node.js (`nodeIntegration: false`), está aislado (`contextIsolation: true`) y corre en el **sandbox** del sistema (`sandbox: true`). Solo puede llamar a unas pocas funciones nombradas del puente (`src/preload/index.ts`): abrir y guardar archivos con los cuadros de diálogo del sistema, y mostrar un archivo en su carpeta.
- **Política de seguridad de contenido (CSP)** en la versión empaquetada: solo se carga código del propio programa (`script-src 'self'`); nada de scripts externos ni en línea.
- La ventana **no puede abrir otras ventanas ni ir a otra página** (se rechaza), y **no concede ningún permiso** (cámara, micrófono, ubicación, notificaciones…).
- El informe en HTML se muestra en un marco aislado (`sandbox`), y todo texto escrito por una persona o proveniente de un archivo se escapa antes de ponerse en el informe.

## Qué contiene el paquete que se distribuye

`app.asar` solo tiene: `out/main/index.js`, `out/preload/index.js`, `out/renderer/*` (la página y su hoja de estilos, y dos scripts) y `package.json`. El `Freeflow.exe` de Windows es **el mismo archivo que `electron.exe`**, sin tocar (misma huella SHA256 que la distribución oficial de Electron). Las dependencias que se incorporan al programa son React, zustand, lucide-react y umap-js, todas de código abierto.

## Qué hay en el repositorio

- Ningún dato de muestras, ni archivos FCS reales (las pruebas generan datos sintéticos).
- Ninguna contraseña, clave, token ni dirección personal (se buscaron cadenas como correo, nombre de usuario, rutas de usuario, `secret`, `token`, `password`, claves privadas).
- El flujo de GitHub (`.github/workflows/build.yml`) **no usa secretos**: solo construye y sube los programas como artefactos.
- Ningún código, imagen, icono ni archivo de otro programa comercial: el icono lo genera `scripts/make-icon.mjs` y el diseño y los textos son propios. El proyecto se publica con licencia **MIT** (LICENSE; avisos de las librerías incluidas en THIRD-PARTY-NOTICES.md).

## Vulnerabilidades conocidas de las dependencias

`npm audit` da **15 avisos de gravedad moderada y ninguno alto ni crítico**. Todos están en las herramientas que construyen el instalador (`electron-builder` y sus dependencias `minimatch`, `glob`, `rimraf`, `ejs`…), que **no forman parte del programa instalado**. Ninguna librería que va dentro del programa tiene avisos. Se pueden revisar con `npm audit` y actualizar `electron-builder` cuando salga una versión corregida.

## Lo que no se puede afirmar

- El programa está **sin firmar** (no hay certificado de editor): Windows y macOS pueden advertirlo o bloquearlo por eso, no por contener nada dañino. Quien baje los instaladores no puede verificar quién los hizo. Firmarlo requiere un certificado de pago.
- **Chromium y Electron** (el motor que hay debajo) son software de terceros muy auditado; no se revisó su código. No se observó tráfico de red, pero esa es una comprobación puntual, no una garantía.
- La versión de **Mac** no se ha podido ejecutar ni revisar en una máquina real.
- Esta revisión la hicieron los propios autores del programa; para un uso crítico conviene una revisión independiente.

## Cómo repetirlo

```
# red y direcciones en el código (no debe salir nada)
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|https?://" src
# dependencias
npm audit
# conexiones de la aplicación abierta (en PowerShell)
Get-NetTCPConnection -OwningProcess (Get-Process Freeflow).Id | ? { $_.RemoteAddress -notin '127.0.0.1','::1','0.0.0.0','::' }
```