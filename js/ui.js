/**
 * ui.js — Módulo de interfaz de usuario
 *
 * Responsabilidades:
 *   - Renderizar el grid de tarjetas de gasolineras
 *   - Aplicar filtros (texto, carburante) y ordenación
 *   - Mostrar skeleton loader durante la carga
 *   - Mostrar estados de error y vacío
 *
 * Este módulo NO hace peticiones a la red ni interactúa con el mapa.
 */
const UIModule = (() => {

    /** Copia del array original para poder reaplicar filtros sin volver a la API */
    let _gasolinerasOriginales = [];

    /**
     * Rangos de precios por carburante calculados una sola vez al recibir datos nuevos.
     * Se reutilizan en cada re-render por filtro/orden, evitando recalcularlos O(n) por render.
     */
    let _preciosPorCombustible = { g95: [], g98: [], diesel: [], dieselPlus: [] };

    // ── Helpers de acceso al DOM ─────────────────────────────────────────────

    function _grid() { return document.getElementById('listado-grid'); }
    function _info() { return document.getElementById('resultado-info'); }

    // ── API pública ──────────────────────────────────────────────────────────

    /**
     * Muestra el skeleton loader en el grid mientras se cargan los datos.
     *
     * @param {number} [cantidad=6] - Número de placeholders a mostrar
     */
    function mostrarSkeleton(cantidad = 6) {
        const grid = _grid();
        const info = _info();
        if (!grid || !info) return;

        info.textContent = cantidad > 0 ? 'Buscando gasolineras cercanas…' : '';
        grid.innerHTML = Array.from({ length: cantidad }, () => `
            <div class="tarjeta tarjeta--skeleton" aria-hidden="true">
                <div class="skeleton skeleton--titulo"></div>
                <div class="skeleton skeleton--texto"></div>
                <div class="skeleton skeleton--texto skeleton--corto"></div>
                <div class="skeleton skeleton--precios"></div>
            </div>
        `).join('');
    }

    /**
     * Renderiza el listado completo de gasolineras en el grid.
     * Precalcula los rangos de precios por carburante para reutilizarlos
     * en renders posteriores (filtros, ordenación) sin coste adicional.
     *
     * @param {Object[]} gasolineras - Array de gasolineras normalizadas
     */
    function renderizarListado(gasolineras) {
        _gasolinerasOriginales = gasolineras;

        // Calcular UNA SOLA VEZ los rangos de precios para toda la sesión de datos
        _preciosPorCombustible = {
            g95:        gasolineras.map(g => g.precios.g95).filter(Boolean),
            g98:        gasolineras.map(g => g.precios.g98).filter(Boolean),
            diesel:     gasolineras.map(g => g.precios.diesel).filter(Boolean),
            dieselPlus: gasolineras.map(g => g.precios.dieselPlus).filter(Boolean),
        };

        _renderizarTarjetas(gasolineras, 'todos');
    }

    /**
     * Lee los filtros activos del DOM y re-renderiza el listado filtrado.
     * Reutiliza _preciosPorCombustible ya calculado — coste O(1) extra.
     */
    function aplicarFiltros() {
        const inputBusqueda     = document.getElementById('input-busqueda');
        const selectCarburante  = document.getElementById('select-carburante');
        const selectOrden       = document.getElementById('select-orden');

        if (!inputBusqueda || !selectCarburante || !selectOrden) return;

        const texto      = inputBusqueda.value.toLowerCase().trim();
        const carburante = selectCarburante.value;
        const criterio   = selectOrden.value;

        let resultado = _gasolinerasOriginales;

        if (texto) {
            resultado = resultado.filter(g =>
                g.nombre.toLowerCase().includes(texto)    ||
                g.direccion.toLowerCase().includes(texto) ||
                g.localidad.toLowerCase().includes(texto)
            );
        }

        if (carburante !== 'todos') {
            resultado = resultado.filter(g => g.precios[carburante] !== null);
        }

        _renderizarTarjetas(ordenarPor(resultado, criterio, carburante), carburante);
    }

    /**
     * Ordena un array de gasolineras por el criterio indicado.
     * No muta el array original — devuelve una copia ordenada.
     *
     * @param {Object[]} gasolineras - Array a ordenar
     * @param {string}   criterio   - 'distancia' | 'precio' | 'nombre'
     * @param {string}   carburante - Carburante activo (para ordenar por precio)
     * @returns {Object[]} Nueva copia ordenada
     *
     * @example
     * const ordenados = ordenarPor(lista, 'precio', 'g95');
     */
    function ordenarPor(gasolineras, criterio, carburante = 'g95') {
        const clave = carburante === 'todos' ? 'g95' : carburante;
        const copia = [...gasolineras];

        switch (criterio) {
            case 'precio':
                return copia.sort((a, b) => {
                    const pa = a.precios[clave] ?? Infinity;
                    const pb = b.precios[clave] ?? Infinity;
                    return pa - pb;
                });
            case 'nombre':
                return copia.sort((a, b) =>
                    a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
                );
            case 'distancia':
            default:
                return copia.sort((a, b) => a.distanciaKm - b.distanciaKm);
        }
    }

    /**
     * Muestra un mensaje de error en el grid.
     *
     * @param {string} mensaje - Descripción del error para el usuario
     */
    function mostrarError(mensaje) {
        const grid = _grid();
        if (!grid) return;
        _limpiarInfo();
        grid.innerHTML = `
            <div class="error-estado" role="alert">
                <span class="error-estado__icono" aria-hidden="true">⚠️</span>
                <p class="error-estado__mensaje">${escaparHTML(mensaje)}</p>
                <p class="error-estado__ayuda">Comprueba tu conexión e inténtalo de nuevo.</p>
            </div>
        `;
    }

    /**
     * Muestra un estado vacío cuando la búsqueda no devuelve resultados.
     */
    function mostrarVacio() {
        const grid = _grid();
        if (!grid) return;
        _limpiarInfo();
        grid.innerHTML = `
            <div class="error-estado">
                <span class="error-estado__icono" aria-hidden="true">🔍</span>
                <p class="error-estado__mensaje">No se encontraron gasolineras</p>
                <p class="error-estado__ayuda">Prueba a ampliar el radio de búsqueda o cambia los filtros.</p>
            </div>
        `;
    }

    // ── Funciones privadas ───────────────────────────────────────────────────

    /**
     * Renderiza el array de gasolineras en el grid del DOM.
     * Usa _preciosPorCombustible ya calculado — sin coste O(n) adicional.
     *
     * @param {Object[]} gasolineras
     */
    function _renderizarTarjetas(gasolineras, filtroCarburante = 'todos') {
        const grid = _grid();
        const info = _info();
        if (!grid || !info) return;

        if (gasolineras.length === 0) {
            mostrarVacio();
            return;
        }

        const n = gasolineras.length;
        info.textContent = `${n} gasolinera${n !== 1 ? 's' : ''} encontrada${n !== 1 ? 's' : ''}`;

        // Precio mínimo para el badge "Más barata"
        const carburanteActivo = filtroCarburante !== 'todos' ? filtroCarburante : 'g95';
        const preciosValidos = gasolineras.map(g => g.precios[carburanteActivo]).filter(p => p !== null);
        const precioMinimo = preciosValidos.length > 0 ? Math.min(...preciosValidos) : null;

        grid.innerHTML = gasolineras
            .map((g, i) => _crearTarjetaHTML(g, i, precioMinimo, carburanteActivo, filtroCarburante))
            .join('');
    }

    /**
     * Genera el HTML de una tarjeta individual de gasolinera.
     * Los rangos de precios se toman del caché del módulo (_preciosPorCombustible).
     *
     * @param {Object} gasolinera
     * @param {number} indice - Posición en el array (para delay de animación CSS)
     * @returns {string} HTML de la tarjeta
     */
    function _crearTarjetaHTML(gasolinera, indice, precioMinimo, carburanteActivo, filtroCarburante) {
        const { nombre, direccion, localidad, horario, precios, distanciaKm, latitud, longitud } = gasolinera;

        const COMBUSTIBLES = [
            { key: 'g95',        label: 'G95' },
            { key: 'g98',        label: 'G98' },
            { key: 'diesel',     label: 'Diésel' },
            { key: 'dieselPlus', label: 'D+' },
        ];

        // Si hay un carburante seleccionado (no "todos"), mostrar solo ese
        const combustiblesVisibles = filtroCarburante !== 'todos'
            ? COMBUSTIBLES.filter(c => c.key === filtroCarburante)
            : COMBUSTIBLES;

        const itemsPrecios = combustiblesVisibles
            .filter(({ key }) => precios[key] !== null)
            .map(({ key, label }) => {
                const clase = colorPrecio(precios[key], _preciosPorCombustible[key]);
                return `
                    <div class="tarjeta__precio-item">
                        <span class="tarjeta__precio-label">${label}</span>
                        <span class="tarjeta__precio-valor ${clase}">${formatearPrecio(precios[key])}</span>
                    </div>
                `;
            })
            .join('');

        const contenidoPrecios = itemsPrecios ||
            '<p class="tarjeta__sin-precio">Sin datos de precio</p>';

        // Badge: más barata del listado actual
        const esMasBarata = precioMinimo !== null && precios[carburanteActivo] === precioMinimo;
        const badgeMasBarata = esMasBarata
            ? '<span class="tarjeta__badge tarjeta__badge--barata">💚 Más barata</span>'
            : '';

        // Badge: abierto / cerrado ahora mismo
        const estado = estaAbierto(horario);
        const badgeEstado = estado === true
            ? '<span class="tarjeta__badge tarjeta__badge--abierto">🟢 Abierto</span>'
            : estado === false
            ? '<span class="tarjeta__badge tarjeta__badge--cerrado">🔴 Cerrado</span>'
            : '';

        const badges = (badgeMasBarata || badgeEstado)
            ? `<div class="tarjeta__badges">${badgeMasBarata}${badgeEstado}</div>`
            : '';

        // Botón Google Maps
        const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitud},${longitud}`;

        return `
            <article class="tarjeta" style="animation-delay:${indice * 40}ms"
                     aria-label="Gasolinera ${nombre}">
                <div class="tarjeta__cabecera">
                    <h2 class="tarjeta__nombre">${nombre}</h2>
                    <span class="tarjeta__distancia">📍 ${formatearDistancia(distanciaKm)}</span>
                </div>
                ${badges}
                <p class="tarjeta__dir">
                    ${direccion}<br>
                    <small>${localidad}</small>
                </p>
                <div class="tarjeta__precios">${contenidoPrecios}</div>
                <div class="tarjeta__footer">
                    <p class="tarjeta__horario">🕐 ${horario}</p>
                    <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
                       class="tarjeta__maps-btn" aria-label="Ver ${nombre} en Google Maps">
                        🗺️ Ver en Maps
                    </a>
                </div>
            </article>
        `;
    }

    /** Limpia el texto del contador de resultados */
    function _limpiarInfo() {
        const info = _info();
        if (info) info.textContent = '';
    }

    // ── Panel lateral del mapa ───────────────────────────────────────────────

    /** Etiquetas legibles por carburante */
    const FUEL_LABELS = { g95: 'G95', g98: 'G98', diesel: 'Diésel A', dieselPlus: 'D+' };

    /**
     * Actualiza los dos paneles laterales del mapa (estadísticas + Top 5).
     * Solo tienen efecto visual a partir de 1100px (CSS los oculta en móvil/tablet).
     *
     * @param {Object[]} gasolineras - Array completo de gasolineras normalizadas
     * @param {string}   carburante  - Clave del carburante activo: 'g95'|'g98'|'diesel'|'dieselPlus'
     */
    function renderizarPanelMapa(gasolineras, carburante = 'g95') {
        _renderizarStats(gasolineras, carburante);
        _renderizarSidebar(gasolineras, carburante);
    }

    /**
     * Rellena el panel izquierdo con 4 tarjetas de estadísticas:
     * nº estaciones, precio medio del carburante activo, más económica, más cercana.
     */
    function _renderizarStats(gasolineras, carburante) {
        const panel = document.getElementById('mapa-stats');
        if (!panel) return;

        if (gasolineras.length === 0) { panel.innerHTML = ''; return; }

        const label = FUEL_LABELS[carburante] || carburante.toUpperCase();
        const precios = gasolineras.map(g => g.precios[carburante]).filter(Boolean);
        const precioMedio = precios.length > 0
            ? (precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(3)
            : null;

        const masEconomica = precios.length > 0
            ? [...gasolineras].filter(g => g.precios[carburante]).sort((a, b) => a.precios[carburante] - b.precios[carburante])[0]
            : null;

        const masCercana = [...gasolineras].sort((a, b) => a.distanciaKm - b.distanciaKm)[0];

        panel.innerHTML = `
            <div class="stat-card">
                <span class="stat-card__icono">⛽</span>
                <span class="stat-card__label">Estaciones</span>
                <span class="stat-card__valor">${gasolineras.length}</span>
            </div>
            <div class="stat-card">
                <span class="stat-card__icono">💰</span>
                <span class="stat-card__label">Precio medio ${label}</span>
                <span class="stat-card__valor">${precioMedio ? precioMedio + ' €' : '—'}</span>
            </div>
            ${masEconomica ? `
            <div class="stat-card">
                <span class="stat-card__icono">💚</span>
                <span class="stat-card__label">Más económica ${label}</span>
                <span class="stat-card__valor">${formatearPrecio(masEconomica.precios[carburante])}</span>
                <span class="stat-card__sub">${escaparHTML(masEconomica.nombre)}</span>
            </div>` : ''}
            <div class="stat-card">
                <span class="stat-card__icono">📍</span>
                <span class="stat-card__label">Más cercana</span>
                <span class="stat-card__valor">${formatearDistancia(masCercana.distanciaKm)}</span>
                <span class="stat-card__sub">${escaparHTML(masCercana.nombre)}</span>
            </div>
        `;
    }

    /**
     * Rellena el panel derecho con el Top 5 más baratas del carburante activo.
     * Al hacer clic en un item, vuela al marcador en el mapa.
     */
    function _renderizarSidebar(gasolineras, carburante) {
        const panel = document.getElementById('mapa-sidebar');
        if (!panel) return;

        if (gasolineras.length === 0) { panel.innerHTML = ''; return; }

        const label = FUEL_LABELS[carburante] || carburante.toUpperCase();

        const top5 = [...gasolineras]
            .filter(g => g.precios[carburante])
            .sort((a, b) => a.precios[carburante] - b.precios[carburante])
            .slice(0, 5);

        if (top5.length === 0) { panel.innerHTML = ''; return; }

        panel.innerHTML = `
            <div class="sidebar-cabecera">
                <img src="solo_icono-transparente.png" alt="" class="sidebar-icono" aria-hidden="true">
                <span class="sidebar-titulo">Top 5 · ${label}</span>
            </div>
            ${top5.map(g => `
                <div class="top5-item"
                     data-lat="${g.latitud}"
                     data-lon="${g.longitud}"
                     title="${escaparHTML(g.nombre)}">
                    <span class="top5-item__nombre">${escaparHTML(g.nombre)}</span>
                    <span class="top5-item__precio">${formatearPrecio(g.precios[carburante])} <small>${label}</small></span>
                    <span class="top5-item__dist">📍 ${formatearDistancia(g.distanciaKm)}</span>
                </div>
            `).join('')}
        `;

        // Clic: cambiar a vista mapa y volar al marcador
        panel.querySelectorAll('.top5-item').forEach(el => {
            el.addEventListener('click', () => {
                document.getElementById('btn-map')?.click();
                MapModule.centrarEn(parseFloat(el.dataset.lat), parseFloat(el.dataset.lon), 15);
            });
        });
    }

    // ── Interfaz pública del módulo ──────────────────────────────────────────
    return { mostrarSkeleton, renderizarListado, aplicarFiltros, ordenarPor, mostrarError, mostrarVacio, renderizarPanelMapa };

})();
