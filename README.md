# Lecturas de agua (Marina Ibiza)

PWA para registrar las lecturas diarias de los contadores Botafoc, Centro y Marina Seca.

- Datos en Supabase. Las tablas no son accesibles directamente: la app llama a funciones SQL que validan un token.
- Acceso por enlace: `https://iaelicozzolino-boop.github.io/contadores-de-agua/#t=<token>`
- OCR de fotos con Tesseract.js en el móvil. Nunca se guarda sin confirmación.
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
