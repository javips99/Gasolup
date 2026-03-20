/**
 * app.js — Orquestador principal de GasoApp
 *
 * Flujo:
 *   1. DOM listo → pedir geolocalización
 *   2a. GPS aceptado → coordenadas → cargarDatos()
 *   2b. GPS denegado → mostrar campo localidad → Nominatim → cargarDatos()
 *   3. cargarDatos() llama a fetchGasolineras() (api.js)
 *   4. Entrega resultados a MapModule y UIModule en paralelo
 *   5. Escucha eventos: toggle vista, slider radio, filtros
 */
const App = (() => {

    const RADIO_DEFECTO_KM = 5;
    const NOMINATIM_URL    = 'https://nominatim.openstreetmap.org/search';

    /** @type {{ lat: number, lon: number } | null} */
    let _coordenadasUsuario = null;
    let _radioActual        = RADIO_DEFECTO_KM;
    let _gasolineras        = [];
    let _cargando           = false;

    // ── Punto de entrada ────────────────────────────────────────────────────

    /**
     * Inicializa la aplicación. Se llama una vez al cargar el DOM.
     */
    function inicializar() {
        _registrarEventos();
        _pedirGeolocalizacion();
    }

    // ── Geolocalización ──────────────────────────────────────────────────────

    /**
     * Solicita la geolocalización del dispositivo.
     * Si no está disponible o es rechazada, activa el campo de búsqueda manual.
     */
    // Bounding box aproximado de España peninsular + islas
    const BBOX_ESPANA = { latMin: 27.6, latMax: 43.8, lonMin: -18.2, lonMax: 4.6 };

    function _dentroDeEspana(lat, lon) {
        return lat >= BBOX_ESPANA.latMin && lat <= BBOX_ESPANA.latMax &&
               lon >= BBOX_ESPANA.lonMin && lon <= BBOX_ESPANA.lonMax;
    }

    function _pedirGeolocalizacion() {
        if (!navigator.geolocation) {
            _intentarGeoIP();
            return;
        }

        navigator.geolocation.getCurrentPosition(
            posicion => {
                const lat = posicion.coords.latitude;
                const lon = posicion.coords.longitude;

                if (_dentroDeEspana(lat, lon)) {
                    _coordenadasUsuario = { lat, lon };
                    _cargarDatos();
                } else {
                    // GPS fuera de España (VPN u otra causa) → intentar por IP
                    console.warn('[GasoApp] GPS fuera de España, intentando geolocalización por IP…');
                    _intentarGeoIP();
                }
            },
            error => {
                console.warn('[GasoApp] GPS denegado o no disponible:', error.message);
                _intentarGeoIP();
            },
            { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
        );
    }

    /**
     * Segundo intento: geolocalización basada en IP usando ipapi.co (gratuito, sin key).
     * Si devuelve coordenadas en España, arranca la búsqueda automáticamente.
     * Si falla o devuelve coordenadas fuera de España, muestra el campo manual.
     */
    async function _intentarGeoIP() {
        _mostrarToast('Detectando ubicación por IP…', 'info');
        try {
            const respuesta = await fetch('https://ipapi.co/json/');
            if (!respuesta.ok) throw new Error('ipapi no disponible');

            const datos = await respuesta.json();
            const lat = parseFloat(datos.latitude);
            const lon = parseFloat(datos.longitude);

            if (_dentroDeEspana(lat, lon)) {
                console.log('[GasoApp] Ubicación por IP:', datos.city, lat, lon);
                _mostrarToast(`Ubicación detectada: ${datos.city}`, 'ok');
                _coordenadasUsuario = { lat, lon };
                _cargarDatos();
            } else {
                throw new Error('IP geolocation también fuera de España');
            }
        } catch (error) {
            console.warn('[GasoApp] Geolocalización por IP fallida:', error.message);
            UIModule.mostrarVacio();
            _activarFallbackGeo();
            _mostrarToast('No se pudo detectar tu ubicación. Escribe tu localidad.', 'warn');
        }
    }

    /**
     * Muestra el campo de búsqueda por localidad cuando la geo no está disponible.
     *
     * @param {string} [mensaje] - Mensaje adicional a registrar en consola
     */
    function _activarFallbackGeo(mensaje) {
        if (mensaje) console.info('[GasoApp]', mensaje);
        document.getElementById('geo-fallback').classList.remove('hidden');
        UIModule.mostrarSkeleton(0);
        document.getElementById('resultado-info').textContent =
            'Introduce tu localidad para buscar gasolineras.';
    }

    /**
     * Geocodifica una localidad con Nominatim (OpenStreetMap) y lanza la carga.
     * Restringe la búsqueda a España (countrycodes=es).
     *
     * @param {string} localidad - Nombre de ciudad o municipio
     */
    async function _geocodificarLocalidad(localidad) {
        const texto = localidad.trim();
        if (!texto) return;

        UIModule.mostrarSkeleton(6);

        const params = new URLSearchParams({
            q:            texto,
            countrycodes: 'es',
            limit:        '1',
            format:       'json',
        });

        try {
            const respuesta = await fetch(`${NOMINATIM_URL}?${params}`, {
                headers: { 'Accept-Language': 'es' },
            });

            if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

            const resultados = await respuesta.json();

            if (!Array.isArray(resultados) || resultados.length === 0) {
                UIModule.mostrarError(`No se encontró "${escaparHTML(texto)}" en España. Prueba con otra localidad.`);
                return;
            }

            _coordenadasUsuario = {
                lat: parseFloat(resultados[0].lat),
                lon: parseFloat(resultados[0].lon),
            };

            _cargarDatos();

        } catch (error) {
            console.error('[GasoApp] Error geocodificando localidad:', error);
            UIModule.mostrarError('No se pudo buscar la localidad. Comprueba tu conexión.');
        }
    }

    // ── Carga de datos ───────────────────────────────────────────────────────

    /**
     * Orquesta la carga completa:
     *   fetchGasolineras → MapModule.renderizarMarcadores → UIModule.renderizarListado
     *
     * Tiene un guard _cargando para evitar peticiones simultáneas.
     */
    async function _cargarDatos() {
        if (_cargando || !_coordenadasUsuario) return;

        _cargando = true;
        _mostrarToast('Buscando gasolineras…', 'info');
        UIModule.mostrarSkeleton(6);
        MapModule.inicializar(_coordenadasUsuario.lat, _coordenadasUsuario.lon);

        console.log('[GasoApp] Iniciando búsqueda en coordenadas:', _coordenadasUsuario, 'radio:', _radioActual, 'km');

        try {
            _gasolineras = await fetchGasolineras(
                _coordenadasUsuario.lat,
                _coordenadasUsuario.lon,
                _radioActual
            );

            console.log('[GasoApp] Gasolineras recibidas:', _gasolineras.length);

            const carburanteActivo = _getCarburanteActivo();
            MapModule.renderizarMarcadores(_gasolineras, carburanteActivo);
            UIModule.renderizarListado(_gasolineras);

            if (_gasolineras.length > 0) {
                _mostrarToast(`${_gasolineras.length} gasolineras encontradas`, 'ok');
            } else {
                _mostrarToast('Sin resultados. Amplía el radio o cambia la localidad.', 'warn');
                // Mostrar campo manual por si la ubicación automática es incorrecta
                _activarFallbackGeo();
            }

        } catch (error) {
            console.error('[GasoApp] Error cargando gasolineras:', error);
            _mostrarToast('Error: ' + (error.message || 'No se pudieron cargar los datos'), 'error');
            UIModule.mostrarError(error.message || 'No se pudieron cargar los datos. Inténtalo de nuevo.');
        } finally {
            _cargando = false;
        }
    }

    // ── Eventos ──────────────────────────────────────────────────────────────

    /**
     * Registra todos los event listeners de la interfaz.
     * Se llama una única vez durante la inicialización.
     */
    function _registrarEventos() {

        // Helper interno: asocia un listener solo si el elemento existe en el DOM
        function _on(id, evento, handler) {
            const el = document.getElementById(id);
            if (el) el.addEventListener(evento, handler);
        }

        // Toggle vista mapa / listado
        _on('btn-map',  'click', () => _cambiarVista('mapa'));
        _on('btn-list', 'click', () => _cambiarVista('listado'));

        // Slider de radio de búsqueda
        const slider     = document.getElementById('slider-radio');
        const radioValor = document.getElementById('radio-valor');

        if (slider && radioValor) {
            slider.addEventListener('input', () => {
                radioValor.textContent = slider.value;
                slider.setAttribute('aria-valuenow', slider.value);
            });
            // Solo relanza la búsqueda cuando el usuario suelta el slider
            slider.addEventListener('change', () => {
                _radioActual = parseInt(slider.value, 10);
                _cargarDatos();
            });
        }

        // Campo de búsqueda por localidad (fallback geo)
        _on('btn-buscar-localidad', 'click', () => {
            const input = document.getElementById('input-localidad');
            if (input) _geocodificarLocalidad(input.value);
        });

        _on('input-localidad', 'keydown', e => {
            if (e.key === 'Enter') _geocodificarLocalidad(e.target.value);
        });

        // Filtros del listado
        _on('input-busqueda',    'input',  () => UIModule.aplicarFiltros());
        _on('select-orden',      'change', () => UIModule.aplicarFiltros());
        _on('select-carburante', 'change', () => {
            UIModule.aplicarFiltros();
            MapModule.renderizarMarcadores(_gasolineras, _getCarburanteActivo());
        });

        // Botón compartir
        _on('btn-share', 'click', _compartir);
    }

    /**
     * Comparte la app usando Web Share API si está disponible,
     * o abre WhatsApp Web como alternativa.
     */
    async function _compartir() {
        const url     = location.href.split('?')[0]; // URL limpia sin parámetros
        const titulo  = 'GasoApp — Gasolineras cercanas';
        const texto   = '¡Encuentra las gasolineras más baratas cerca de ti! 🚗⛽';

        if (navigator.share) {
            try {
                await navigator.share({ title: titulo, text: texto, url });
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.warn('[GasoApp] Web Share falló, abriendo WhatsApp:', err.message);
                    _abrirWhatsApp(texto, url);
                }
            }
        } else {
            _abrirWhatsApp(texto, url);
        }
    }

    /**
     * Abre WhatsApp Web con un mensaje predefinido + URL de la app.
     *
     * @param {string} texto
     * @param {string} url
     */
    function _abrirWhatsApp(texto, url) {
        const mensaje = encodeURIComponent(`${texto}\n${url}`);
        window.open(`https://wa.me/?text=${mensaje}`, '_blank', 'noopener,noreferrer');
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Cambia entre la vista de mapa y la vista de listado.
     *
     * @param {'mapa'|'listado'} vista
     */
    function _cambiarVista(vista) {
        const btnMap       = document.getElementById('btn-map');
        const btnList      = document.getElementById('btn-list');
        const vistaMapa    = document.getElementById('vista-mapa');
        const vistaListado = document.getElementById('vista-listado');

        const esMapa = vista === 'mapa';

        vistaMapa.classList.toggle('hidden', !esMapa);
        vistaListado.classList.toggle('hidden', esMapa);

        btnMap.classList.toggle('toggle-view__btn--active', esMapa);
        btnList.classList.toggle('toggle-view__btn--active', !esMapa);

        btnMap.setAttribute('aria-pressed', esMapa ? 'true' : 'false');
        btnList.setAttribute('aria-pressed', esMapa ? 'false' : 'true');
    }

    /**
     * Devuelve el carburante activo en el selector, o 'g95' como valor por defecto.
     *
     * @returns {string}
     */
    function _getCarburanteActivo() {
        const val = document.getElementById('select-carburante').value;
        return val === 'todos' ? 'g95' : val;
    }

    /**
     * Muestra un toast de notificación flotante visible desde cualquier vista.
     * Se oculta automáticamente tras 4 segundos.
     *
     * @param {string} mensaje
     * @param {'info'|'ok'|'warn'|'error'} tipo
     */
    function _mostrarToast(mensaje, tipo = 'info') {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            document.body.appendChild(toast);
        }

        toast.textContent = mensaje;
        toast.className = `toast toast--${tipo} toast--visible`;

        // Los toasts de carga ('info') se mantienen hasta ser reemplazados.
        // El resto se ocultan automáticamente tras 4 segundos.
        clearTimeout(toast._timer);
        if (tipo !== 'info') {
            toast._timer = setTimeout(() => {
                toast.classList.remove('toast--visible');
            }, 4000);
        }
    }

    // ── Interfaz pública del módulo ──────────────────────────────────────────
    return { inicializar };

})();

// ── Arranque ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.inicializar());
