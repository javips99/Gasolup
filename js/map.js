/**
 * map.js — Módulo de mapa interactivo con Leaflet.js
 *
 * Responsabilidades:
 *   - Inicializar y centrar el mapa
 *   - Renderizar marcadores de gasolineras con popups informativos
 *   - Gestionar el marcador de posición del usuario
 *   - Ofrecer capas de teselas: OSM estándar + Esri satélite
 *
 * Este módulo NO conoce ni el DOM del listado ni la lógica de negocio.
 */
const MapModule = (() => {

    /** @type {L.Map|null} */
    let _mapa = null;

    /** @type {L.Marker|null} */
    let _marcadorUsuario = null;

    /** @type {L.LayerGroup|null} */
    let _capaMarcadores = null;

    /**
     * Icono del marcador de usuario creado una sola vez y reutilizado.
     * @type {L.DivIcon|null}
     */
    let _iconoUsuario = null;

    const TILES = {
        osm: {
            url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            opciones: {
                attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
                maxZoom: 19,
            },
        },
        esri: {
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            opciones: {
                attribution: '© Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
                maxZoom: 18,
            },
        },
    };

    // ── API pública ──────────────────────────────────────────────────────────

    /**
     * Inicializa el mapa centrado en las coordenadas del usuario.
     * Si el mapa ya existe, simplemente lo re-centra y actualiza el marcador.
     *
     * @param {number} lat - Latitud del usuario
     * @param {number} lon - Longitud del usuario
     */
    function inicializar(lat, lon) {
        if (_mapa) {
            _mapa.setView([lat, lon], 13);
            _actualizarMarcadorUsuario(lat, lon);
            return;
        }

        _mapa = L.map('map', { zoomControl: true }).setView([lat, lon], 13);

        const capaOSM  = L.tileLayer(TILES.osm.url, TILES.osm.opciones);
        const capaEsri = L.tileLayer(TILES.esri.url, TILES.esri.opciones);

        capaOSM.addTo(_mapa);

        L.control.layers(
            { 'Mapa estándar': capaOSM, 'Satélite (Esri)': capaEsri },
            {},
            { position: 'topright', collapsed: true }
        ).addTo(_mapa);

        _capaMarcadores = L.layerGroup().addTo(_mapa);

        _actualizarMarcadorUsuario(lat, lon);
    }

    /**
     * Elimina los marcadores anteriores y pinta los de las gasolineras recibidas.
     * colorPrecio() se llama UNA SOLA VEZ por gasolinera y el resultado se
     * reutiliza tanto para el icono como para el popup, evitando cálculos dobles.
     *
     * @param {Object[]} gasolineras    - Array de gasolineras normalizadas
     * @param {string}  carburanteActivo - Clave del carburante: 'g95'|'g98'|'diesel'|'dieselPlus'
     */
    function renderizarMarcadores(gasolineras, carburanteActivo = 'g95') {
        if (!_mapa || !_capaMarcadores) return;

        _capaMarcadores.clearLayers();

        if (gasolineras.length === 0) return;

        // Lista de precios del carburante activo para el coloreado relativo
        const preciosList = gasolineras
            .map(g => g.precios[carburanteActivo])
            .filter(p => p !== null);

        gasolineras.forEach(gasolinera => {
            const precio = gasolinera.precios[carburanteActivo];

            // Calcular clase UNA VEZ → reutilizar en icono Y en popup
            const clase = colorPrecio(precio, preciosList);

            L.marker([gasolinera.latitud, gasolinera.longitud], { icon: _crearIcono(clase) })
                .bindPopup(_crearPopupHTML(gasolinera, clase, preciosList), {
                    maxWidth: 240,
                    className: 'popup-gasolinera',
                })
                .addTo(_capaMarcadores);
        });
    }

    /**
     * Desplaza el mapa con animación a unas coordenadas dadas.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {number} [zoom=13]
     */
    function centrarEn(lat, lon, zoom = 13) {
        if (_mapa) _mapa.flyTo([lat, lon], zoom, { duration: 1.2 });
    }

    // ── Funciones privadas ───────────────────────────────────────────────────

    /**
     * Crea o actualiza el marcador de posición del usuario en el mapa.
     * El DivIcon se crea una sola vez (_iconoUsuario) y se reutiliza.
     *
     * @param {number} lat
     * @param {number} lon
     */
    function _actualizarMarcadorUsuario(lat, lon) {
        if (!_iconoUsuario) {
            _iconoUsuario = L.divIcon({
                className:  '',
                html:       '<div class="marcador-usuario" title="Tu ubicación">📍</div>',
                iconSize:   [32, 32],
                iconAnchor: [16, 32],
            });
        }

        if (_marcadorUsuario) {
            _marcadorUsuario.setLatLng([lat, lon]);
        } else {
            _marcadorUsuario = L.marker([lat, lon], {
                icon:         _iconoUsuario,
                zIndexOffset: 1000,
                title:        'Tu ubicación',
            })
            .addTo(_mapa)
            .bindPopup('<strong>Tu ubicación actual</strong>', { maxWidth: 160 });
        }
    }

    /**
     * Construye un icono Leaflet con el color semafórico del precio.
     *
     * @param {string} clasePrecio - 'precio--barato' | 'precio--medio' | 'precio--caro' | ''
     * @returns {L.DivIcon}
     */
    function _crearIcono(clasePrecio) {
        return L.divIcon({
            className:   '',
            html:        `<div class="marcador-gasolinera ${clasePrecio}" title="Gasolinera">⛽</div>`,
            iconSize:    [28, 28],
            iconAnchor:  [14, 28],
            popupAnchor: [0, -30],
        });
    }

    /**
     * Genera el HTML del popup de una gasolinera para mostrar en el mapa.
     * Recibe la clase de color del carburante activo ya calculada (no la recalcula).
     *
     * @param {Object}   gasolinera      - Gasolinera normalizada
     * @param {string}   claseActivo     - Clase CSS del precio del carburante activo
     * @param {number[]} todosLosPrecios - Precios del carburante activo para el resto de filas
     * @returns {string} HTML del popup
     */
    function _crearPopupHTML(gasolinera, claseActivo, todosLosPrecios) {
        const { nombre, direccion, localidad, horario, precios, distanciaKm } = gasolinera;

        const LABELS = { g95: 'G95', g98: 'G98', diesel: 'Diésel', dieselPlus: 'D+' };

        const filasPrecios = Object.entries(precios)
            .filter(([, valor]) => valor !== null)
            .map(([key, valor]) => {
                const clase = colorPrecio(valor, todosLosPrecios);
                return `<tr>
                    <td>${LABELS[key] || key}</td>
                    <td class="${clase}" style="font-weight:700">${formatearPrecio(valor)}</td>
                </tr>`;
            })
            .join('');

        return `
            <div class="popup">
                <h3 class="popup__nombre">${nombre}</h3>
                <p class="popup__dir">${direccion}<br>${localidad}</p>
                <p class="popup__distancia">📍 ${formatearDistancia(distanciaKm)}</p>
                ${filasPrecios ? `<table class="popup__precios">${filasPrecios}</table>` : ''}
                <p class="popup__horario">🕐 ${horario}</p>
            </div>
        `;
    }

    // ── Interfaz pública del módulo ──────────────────────────────────────────
    return { inicializar, renderizarMarcadores, centrarEn };

})();
