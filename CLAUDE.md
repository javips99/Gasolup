# CLAUDE.md — GasoApp

## Descripción del proyecto
Aplicación web estática para consultar precios de gasolineras cercanas en España.
Sin backend, sin npm, sin bundler. Despliegue directo como archivos estáticos.

## Stack
- HTML5 + CSS3 + JavaScript ES6 vanilla (IIFE modules)
- Leaflet.js v1.9.4 (mapas interactivos)
- API REST MITECO (precios carburantes, sin API key)
- Nominatim OpenStreetMap (geocodificación, sin API key)
- ipapi.co (geolocalización por IP, gratuito hasta 1000 req/día)

## Arquitectura de módulos
Orden de carga obligatorio (scripts en index.html):
```
utils.js → api.js → map.js → ui.js → app.js
```
Cada módulo es un IIFE que expone solo su API pública. Los módulos se comunican
a través de las funciones globales de utils.js (`escaparHTML`, `parsearPrecio`, etc.)
y de los módulos exportados (`MapModule`, `UIModule`).

## Flujo principal
```
app.js:inicializar()
  → _pedirGeolocalizacion()   (GPS nativo)
  → _intentarGeoIP()          (fallback: ipapi.co)
  → _activarFallbackGeo()     (fallback: campo manual + Nominatim)
  → _cargarDatos()
      → api.js:fetchGasolineras()  (MITECO, ~12k estaciones, filtro Haversine en cliente)
      → MapModule.renderizarMarcadores()
      → UIModule.renderizarListado()
```

## Decisiones técnicas importantes

### Por qué se descargan TODAS las estaciones de España
La API MITECO ofrece endpoint por provincia, pero un usuario cerca de un límite
provincial perdería gasolineras del municipio contiguo. Descargar todas (~12k)
y filtrar con Haversine en cliente es O(n) muy rápido y da resultados correctos.
Tiempo de carga: ~2s. Coste: aceptable para este caso de uso.

### Sanitización XSS en el punto de entrada (api.js)
Todos los campos de texto de la API se pasan por `escaparHTML()` (de utils.js)
en `_normalizarGasolinera()`, en el momento de crear el objeto normalizado.
Esto significa que los datos en `_gasolineras[]` ya están sanitizados y pueden
insertarse directamente en template literals de innerHTML.
**Regla:** nunca insertar `eess['CampoTexto']` directamente en el DOM sin pasar
antes por `escaparHTML()`.

### Por qué `_preciosPorCombustible` se precalcula en `renderizarListado()`
El coloreado relativo de precios requiere conocer el rango min/max de todos los
precios del mismo carburante. Calcularlo en cada render de tarjeta sería O(n²).
Se calcula una sola vez y se cachea en el módulo ui.js.

### AbortController en todas las peticiones de red
Tanto la petición a MITECO (20s) como a Nominatim (10s) usan AbortController.
Patrón obligatorio para evitar que una UI en estado de carga quede bloqueada
indefinidamente si el servidor no responde.

### Validación con `navigator.onLine`
Se comprueba antes de lanzar la petición a MITECO para mostrar un mensaje
específico de "sin conexión" en lugar del genérico "no se pudieron cargar los datos".

## Archivos y responsabilidades
| Archivo | Responsabilidad |
|---------|-----------------|
| `utils.js` | Funciones puras: Haversine, formateo, escape XSS, validaciones |
| `api.js` | Fetch MITECO + normalización. Depende de utils.js |
| `map.js` | Leaflet: marcadores, popups, capas. No conoce el DOM del listado |
| `ui.js` | Grid de tarjetas, filtros, skeleton. No hace peticiones de red |
| `app.js` | Orquestador: geo → API → módulos. Registra todos los eventos |

## Comandos para desarrollo
```bash
# Live Server (VS Code) — recomendado
# Clic derecho en index.html → Open with Live Server

# Python
python -m http.server 8000
# → http://localhost:8000

# Node.js
npx serve .
# → http://localhost:3000
```

## Recursos externos
- API MITECO: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help
- Leaflet: https://leafletjs.com/reference.html
- Nominatim: https://nominatim.org/release-docs/latest/api/Search/
- ipapi.co: https://ipapi.co/api/
