/**
 * api.js — Acceso a la API de gasolineras del MITECO
 *
 * API: Ministerio para la Transición Ecológica y el Reto Demográfico
 * Base URL: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/
 * Documentación: https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help
 *
 * La API soporta CORS (Access-Control-Allow-Origin: *), sin API key.
 *
 * Estrategia: se consultan todas las estaciones de España (~12.000) y se
 * filtra por distancia en cliente con Haversine. Esto garantiza que aparezcan
 * gasolineras de provincias vecinas cuando el usuario está cerca de un límite
 * provincial, a costa de ~2s de carga inicial.
 */

const API_BASE = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';
const TIMEOUT_MS = 20000;

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Obtiene las gasolineras cercanas a unas coordenadas dentro de un radio dado.
 *
 * Flujo:
 *   1. Fetch todas las estaciones de España (MITECO)
 *   2. Normalizar y filtrar por distancia ≤ radioKm en cliente
 *   3. Ordenar por distancia
 *
 * @param {number} latitud  - Latitud del usuario en grados decimales
 * @param {number} longitud - Longitud del usuario en grados decimales
 * @param {number} radioKm  - Radio de búsqueda en kilómetros (1–25)
 * @returns {Promise<Object[]>} Array de gasolineras normalizadas, ordenadas por distancia
 * @throws {Error} Si la red no está disponible o la API devuelve un error
 *
 * @example
 * const lista = await fetchGasolineras(40.4168, -3.7038, 5);
 * console.log(lista[0].nombre); // 'REPSOL'
 */
async function fetchGasolineras(latitud, longitud, radioKm) {
    // Se consulta siempre toda España y se filtra por distancia en cliente.
    // Esto garantiza que aparezcan gasolineras de provincias vecinas cuando
    // el usuario está cerca de un límite provincial (caso frecuente en zonas
    // periurbanas). La API devuelve ~12.000 estaciones en ~2s, lo cual es
    // aceptable dado que el filtrado Haversine es O(n) muy rápido en cliente.
    const datos = await _fetchConTimeout(`${API_BASE}/EstacionesTerrestres/`, TIMEOUT_MS);
    return _normalizarRespuesta(datos, latitud, longitud, radioKm);
}

// ── Funciones privadas ───────────────────────────────────────────────────────

/**
 * Realiza fetch con timeout usando AbortController (compatible con todos los browsers).
 *
 * @param {string} url       - URL a solicitar
 * @param {number} timeoutMs - Milisegundos antes de abortar
 * @returns {Promise<Object>} JSON parseado
 * @throws {Error} Si la respuesta HTTP no es 2xx o se supera el timeout
 */
async function _fetchConTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);

    let respuesta;
    try {
        respuesta = await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timerId);
    }

    if (!respuesta.ok) {
        throw new Error(`Error ${respuesta.status} al contactar con la API de gasolineras.`);
    }

    return respuesta.json();
}

/**
 * Transforma la respuesta cruda de la API en el array normalizado interno.
 * Filtra las estaciones fuera del radio indicado.
 *
 * @param {Object} datos     - JSON crudo de la API MITECO
 * @param {number} latOrigen - Latitud del usuario
 * @param {number} lonOrigen - Longitud del usuario
 * @param {number} radioKm   - Radio máximo de búsqueda
 * @returns {Object[]} Gasolineras dentro del radio, ordenadas por distancia
 * @throws {Error} Si la respuesta no tiene el formato esperado
 */
function _normalizarRespuesta(datos, latOrigen, lonOrigen, radioKm) {
    const lista = datos && datos.ListaEESSPrecio;

    if (!Array.isArray(lista)) {
        throw new Error('La API devolvió una respuesta inesperada. Inténtalo más tarde.');
    }

    if (lista.length === 0) return [];

    return lista
        .map(eess => _normalizarGasolinera(eess, latOrigen, lonOrigen))
        .filter(g => g !== null && g.distanciaKm <= radioKm)
        .sort((a, b) => a.distanciaKm - b.distanciaKm);
}

/**
 * Normaliza un objeto individual de estación de servicio de la API MITECO.
 * Usa escaparHTML() de utils.js para sanitizar todos los campos de texto.
 *
 * Notas sobre el formato de la API:
 *   - Coordenadas con coma decimal:  "40,416775" → parseFloat con replace
 *   - Precios con coma decimal:      "1,879"     → parsearPrecio() en utils.js
 *   - El campo de gasoil es "Precio Gasoleo A" (no "Gasoil")
 *
 * @param {Object} eess     - Objeto crudo de la API
 * @param {number} latOrigen
 * @param {number} lonOrigen
 * @returns {Object|null} Gasolinera normalizada o null si las coordenadas son inválidas
 */
function _normalizarGasolinera(eess, latOrigen, lonOrigen) {
    const lat = parseFloat((eess['Latitud'] || '').replace(',', '.'));
    const lon = parseFloat((eess['Longitud (WGS84)'] || '').replace(',', '.'));

    // Usar validarCoordenadas() de utils.js para validar rangos además de NaN
    if (!validarCoordenadas(lat, lon)) return null;

    return {
        id:          String(eess['IDEESS'] || ''),
        nombre:      escaparHTML(eess['Rótulo'] || 'Sin nombre'),
        direccion:   escaparHTML(eess['Dirección'] || ''),
        localidad:   escaparHTML(eess['Localidad'] || ''),
        provincia:   escaparHTML(eess['Provincia'] || ''),
        latitud:     lat,
        longitud:    lon,
        horario:     escaparHTML(eess['Horario'] || 'No disponible'),
        distanciaKm: calcularDistancia(latOrigen, lonOrigen, lat, lon),
        precios: {
            g95:        parsearPrecio(eess['Precio Gasolina 95 E5']),
            g98:        parsearPrecio(eess['Precio Gasolina 98 E5']),
            diesel:     parsearPrecio(eess['Precio Gasoleo A']),       // ← "Gasoleo", no "Gasoil"
            dieselPlus: parsearPrecio(eess['Precio Gasoleo Premium']), // ← "Gasoleo", no "Gasoil"
        },
    };
}
