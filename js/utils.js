/**
 * utils.js — Funciones utilitarias puras (sin efectos secundarios)
 * Cálculo de distancias, formateo de valores y clasificación de precios.
 */

/**
 * Calcula la distancia entre dos coordenadas geográficas usando la fórmula Haversine.
 *
 * @param {number} lat1 - Latitud del punto origen (grados decimales)
 * @param {number} lon1 - Longitud del punto origen (grados decimales)
 * @param {number} lat2 - Latitud del punto destino (grados decimales)
 * @param {number} lon2 - Longitud del punto destino (grados decimales)
 * @returns {number} Distancia en kilómetros, redondeada a 2 decimales
 *
 * @example
 * calcularDistancia(40.4168, -3.7038, 41.3825, 2.1769) // ~505.12
 */
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radio medio de la Tierra en km
    const toRad = grados => grados * (Math.PI / 180);

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
}

/**
 * Valida que unas coordenadas geográficas están dentro de los rangos válidos.
 * Latitud: [-90, 90] | Longitud: [-180, 180]
 *
 * @param {number} lat - Latitud en grados decimales
 * @param {number} lon - Longitud en grados decimales
 * @returns {boolean} true si las coordenadas son válidas
 *
 * @example
 * validarCoordenadas(40.4168, -3.7038) // true
 * validarCoordenadas(200, 0)           // false
 */
function validarCoordenadas(lat, lon) {
    return (
        typeof lat === 'number' && typeof lon === 'number' &&
        !isNaN(lat) && !isNaN(lon) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180
    );
}

/**
 * Valida el texto introducido por el usuario para buscar una localidad.
 *
 * @param {string} texto - Nombre de la localidad a buscar
 * @returns {{ ok: boolean, error?: string }} Resultado de la validación
 *
 * @example
 * validarLocalidad('Madrid')  // { ok: true }
 * validarLocalidad('')        // { ok: false, error: 'Escribe el nombre de una localidad.' }
 */
function validarLocalidad(texto) {
    const t = String(texto).trim();
    if (!t) return { ok: false, error: 'Escribe el nombre de una localidad.' };
    if (t.length < 2) return { ok: false, error: 'El nombre debe tener al menos 2 caracteres.' };
    if (t.length > 100) return { ok: false, error: 'El nombre es demasiado largo (máx. 100 caracteres).' };
    return { ok: true };
}

/**
 * Determina la clase CSS de color para un precio según su posición relativa
 * dentro del rango de precios disponibles.
 *
 * Divide el rango en tres tercios:
 *   - 0–33 %  → precio--barato (verde)
 *   - 33–66 % → precio--medio  (ámbar)
 *   - 66–100% → precio--caro   (rojo)
 *
 * @param {number|null} precio - Precio a evaluar
 * @param {number[]} todosLosPrecios - Array de todos los precios del mismo carburante
 * @returns {string} Clase CSS del color correspondiente, o '' si el precio es nulo
 *
 * @example
 * colorPrecio(1.45, [1.40, 1.45, 1.55]) // 'precio--medio'
 */
function colorPrecio(precio, todosLosPrecios) {
    if (precio === null || precio === undefined || isNaN(precio)) return '';

    const validos = todosLosPrecios.filter(p => p !== null && p !== undefined && !isNaN(p));
    if (validos.length < 2) return 'precio--medio';

    const min = Math.min(...validos);
    const max = Math.max(...validos);
    const rango = max - min;

    if (rango === 0) return 'precio--medio';

    const posicion = (precio - min) / rango;

    if (posicion <= 0.33) return 'precio--barato';
    if (posicion <= 0.66) return 'precio--medio';
    return 'precio--caro';
}

/**
 * Formatea un precio numérico al formato español de precio por litro.
 *
 * @param {number|null} valor - Precio en euros
 * @returns {string} Precio formateado (ej: "1,539 €/L") o "—" si no disponible
 *
 * @example
 * formatearPrecio(1.539) // '1,539 €/L'
 * formatearPrecio(null)  // '—'
 */
function formatearPrecio(valor) {
    if (valor === null || valor === undefined || isNaN(valor)) return '—';
    return valor.toFixed(3).replace('.', ',') + ' €/L';
}

/**
 * Formatea una distancia en kilómetros a una cadena legible para el usuario.
 * Muestra metros si la distancia es inferior a 1 km.
 *
 * @param {number} km - Distancia en kilómetros
 * @returns {string} Distancia formateada (ej: "2,3 km" o "850 m")
 *
 * @example
 * formatearDistancia(0.85)  // '850 m'
 * formatearDistancia(12.36) // '12,4 km'
 */
function formatearDistancia(km) {
    if (km < 1) {
        return Math.round(km * 1000) + ' m';
    }
    return km.toFixed(1).replace('.', ',') + ' km';
}

/**
 * Escapa entidades HTML de una cadena para prevenir inyección XSS en el DOM.
 * Usar siempre que se inserte texto dinámico (de usuario o de API) en innerHTML.
 *
 * @param {*} valor - Valor a escapar
 * @returns {string} Texto con caracteres HTML escapados
 *
 * @example
 * escaparHTML('<script>alert(1)</script>') // '&lt;script&gt;alert(1)&lt;/script&gt;'
 */
function escaparHTML(valor) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(valor)));
    return div.innerHTML;
}

/**
 * Parsea una cadena de precio en formato español (coma decimal) a número flotante.
 * Devuelve null si la cadena está vacía o no es un número válido.
 *
 * @param {string|undefined} cadena - Precio en formato "1,539"
 * @returns {number|null} Valor numérico o null si no es válido
 *
 * @example
 * parsearPrecio('1,539') // 1.539
 * parsearPrecio('')      // null
 * parsearPrecio(null)    // null
 */
function parsearPrecio(cadena) {
    if (!cadena || String(cadena).trim() === '') return null;
    const num = parseFloat(String(cadena).replace(',', '.'));
    return isNaN(num) ? null : num;
}
