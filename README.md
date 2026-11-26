# Lecturas de agua (Marina Ibiza)

PWA para registrar las lecturas diarias de los contadores Botafoc, Centro y Marina Seca.

- Datos en Supabase. Las tablas no son accesibles directamente: la app llama a funciones SQL que validan un token.
- Acceso por enlace: `https://iaelicozzolino-boop.github.io/contadores-de-agua/#t=<token>`
- Los contadores son digitales (pantalla LCD de 7 segmentos). OCR de fotos con Tesseract.js en el móvil: el operario recorta la línea de cifras, se ignora el recuadro rojo y las líneas secundarias, y nunca se guarda sin confirmación.
- Marina Seca (Contazara CZ US): la pantalla muestra `0.114400` y se lee como 114,400 m³; en Ajustes tiene que tener 4 dígitos enteros.
- Diseño igual que el resto de MarinaIbizaApps (Manrope, azul `#1F3A68`).

## Puesta en marcha
1. Supabase > SQL Editor > pegar `supabase/schema.sql` > Run. La última consulta devuelve el token.
2. `config.js` ya apunta al proyecto. Si cambia, editar URL y clave publishable.
3. Activar GitHub Pages en la rama principal.
4. Abrir el enlace con `#t=<token>` una vez en cada móvil; el token queda guardado en el dispositivo.

## Tests
`node tests/lib.test.js` (cálculo de consumo, alertas, totales, parseo).

## Pendiente
Cola sin conexión, ajuste del OCR con fotos reales, enlace desde el hub MarinaIbizaApps.
