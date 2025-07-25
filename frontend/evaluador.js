// ============================================================================
// EVALUADOR.JS - VERSIÓN FINAL ORGANIZADA Y COMENTADA
// Este archivo contiene toda la lógica del panel de evaluación de CreditoSys.
// ============================================================================

'use strict';

// --- 1. CONFIGURACIÓN GLOBAL Y ESTADO ---

/**
 * @typedef {object} Solicitud
 * @property {number} id
 * @property {string} client_username
 * @property {number} amount
 * @property {string} application_date
 * @property {string} status
 * @property {number} term_months
 * @property {string} purpose
 * @property {number} credit_score
 * @property {object} [prediccion]
 * @property {object} [analisis_perfil]
 * @property {array} [sugerencias_ia]
 * @property {number} [creditos_anteriores]
 */

/**
 * Objeto global para almacenar el estado de la aplicación.
 * @type {{
 * solicitudesPendientes: Solicitud[],
 * paginaActual: number,
 * solicitudesPorPagina: number,
 * filtroBusqueda: string,
 * solicitudActiva: Solicitud | null
 * }}
 */
const G = {
    solicitudesPendientes: [],
    paginaActual: 1,
    solicitudesPorPagina: 5,
    filtroBusqueda: '',
    solicitudActiva: null
};

let clusterChartInstance = null; // Instancia del gráfico para poder destruirla y redibujarla

// --- 2. COMUNICACIÓN CON LA API ---

/**
 * Función centralizada para realizar llamadas fetch a la API con autenticación.
 * @param {string} url - El endpoint de la API al que se va a llamar.
 * @param {object} [options={}] - Opciones adicionales para la llamada fetch.
 * @returns {Promise<object|null>} - La respuesta de la API en formato JSON o null si hay un error.
 */
async function fetchAPI(url, options = {}) {
    const user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!user || !user.access_token) {
        showNotification('Sesión no válida. Por favor, inicie sesión de nuevo.', 'error');
        return null;
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });
        if (!response.ok) {
            console.error(`Error en API (${url}): ${response.status} ${response.statusText}`);
            return response; // Devolvemos la respuesta completa para manejar el error
        }
        return response.json();
    } catch (error) {
        console.error(`Error de red o conexión para ${url}:`, error);
        return null;
    }
}

/**
 * Función específica para realizar llamadas PATCH a la API.
 * @param {string} url - El endpoint de la API.
 * @param {object} data - El cuerpo de la solicitud a enviar.
 * @returns {Promise<Response|null>} - La respuesta de la API.
 */
async function patchAPI(url, data) {
    return await fetchAPI(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
    });
}

/**
 * Carga las estadísticas del evaluador desde la API y actualiza el dashboard.
 */
async function cargarEstadisticasEvaluador() {
    const data = await fetchAPI('/api/applications/evaluator-stats/');
    if (!data || typeof data.ok === 'boolean') return;

    document.querySelector('.stat-card:nth-child(1) .stat-number').textContent = data.pendientes ?? '-';
    document.querySelector('.stat-card:nth-child(2) .stat-number').textContent = data.evaluadas_hoy ?? '-';
    document.querySelector('.stat-card:nth-child(3) .stat-number').textContent = `${data.tasa_aprobacion ?? '-'}%`;
    document.querySelector('.stat-card:nth-child(4) .stat-number').textContent = `${data.tiempo_promedio ?? '-'} min`;
}

/**
 * Carga todas las solicitudes pendientes y en revisión desde la API.
 */
async function cargarSolicitudesPendientes() {
    const tablaBody = document.querySelector('#pendientes .table tbody');
    if (tablaBody) tablaBody.innerHTML = '<tr><td colspan="7" class="text-center">Cargando solicitudes...</td></tr>';

    const [pendientes, enRevision] = await Promise.all([
        fetchAPI('/api/applications/?status=pendiente'),
        fetchAPI('/api/applications/?status=en_revision')
    ]);

    if (!pendientes || !enRevision) {
        tablaBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger"><strong>Error de Conexión.</strong> No se pudieron cargar las solicitudes.</td></tr>';
        return;
    }

    const arrPendiente = pendientes.results || pendientes || [];
    const arrRevision = enRevision.results || enRevision || [];
    
    G.solicitudesPendientes = [...arrPendiente, ...arrRevision];
    renderSolicitudesPaginadas();
}

/**
 * Carga los reportes del evaluador para la pestaña de reportes.
 */
async function cargarReportesEvaluacion() {
    const data = await fetchAPI('/api/applications/evaluator-stats/');
    if (!data) return;

    document.getElementById('reporteEvaluacionesMes').textContent = data.evaluadas_mes ?? '-';
    document.getElementById('reporteAprobaciones').textContent = data.aprobaciones ?? '-';
    document.getElementById('reporteTasaAprobacion').textContent = `${data.tasa_aprobacion ?? '-'}%`;
}

// --- 3. RENDERIZADO Y ACTUALIZACIÓN DE LA UI ---

/**
 * Renderiza la tabla de solicitudes pendientes con paginación y filtro.
 */
function renderSolicitudesPaginadas() {
    const tablaBody = document.querySelector('#pendientes .table tbody');
    if (!tablaBody) return;

    const filtradas = G.solicitudesPendientes.filter(s => {
        if (!G.filtroBusqueda) return true;
        const texto = `${s.id} ${s.client_username || ''} ${s.amount}`.toLowerCase();
        return texto.includes(G.filtroBusqueda.toLowerCase());
    });

    if (!filtradas.length) {
        tablaBody.innerHTML = '<tr><td colspan="7" class="text-center">No hay solicitudes pendientes que coincidan.</td></tr>';
        renderPaginacion(0, 0);
        return;
    }

    const totalPaginas = Math.ceil(filtradas.length / G.solicitudesPorPagina);
    if (G.paginaActual > totalPaginas) G.paginaActual = 1;
    const inicio = (G.paginaActual - 1) * G.solicitudesPorPagina;
    const pagina = filtradas.slice(inicio, inicio + G.solicitudesPorPagina);
    
    tablaBody.innerHTML = pagina.map(s => {
        const estado = s.status === 'pendiente' ? 'DOCUMENTOS SUBIDOS' : 'EN VALIDACIÓN';
        const prioridad = calcularPrioridad(s);
        const accion = `<button class='btn btn-primary btn-sm' onclick='iniciarEvaluacion(${s.id})'><i class="fas fa-play"></i> Evaluar</button>`;
        return `
            <tr>
                <td>#${s.id.toString().padStart(3, '0')}</td>
                <td>${s.client_username || '-'}</td>
                <td>S/ ${Number(s.amount).toLocaleString('es-PE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>${new Date(s.application_date).toLocaleDateString()}</td>
                <td><span class='badge status-${s.status}'>${estado}</span></td>
                <td><span class='badge' style='background:${prioridad.color};color:white;'>${prioridad.texto}</span></td>
                <td>${accion}</td>
            </tr>`;
    }).join('');
    renderPaginacion(filtradas.length, totalPaginas);
}

/**
 * Dibuja los controles de paginación debajo de la tabla.
 * @param {number} total - El número total de items.
 * @param {number} totalPaginas - El número total de páginas.
 */
function renderPaginacion(total, totalPaginas) {
    const pagDiv = document.getElementById('paginacionSolicitudes');
    if (!pagDiv) return;
    if (totalPaginas <= 1) { pagDiv.innerHTML = ''; return; }
    
    let html = `<button class='btn btn-outline btn-sm' ${G.paginaActual === 1 ? 'disabled' : ''} onclick='cambiarPagina(${G.paginaActual - 1})'>&lt;</button>`;
    for (let i = 1; i <= totalPaginas; i++) {
        html += `<button class='btn ${i === G.paginaActual ? 'btn-primary' : 'btn-outline'} btn-sm' onclick='cambiarPagina(${i})'>${i}</button>`;
    }
    html += `<button class='btn btn-outline btn-sm' ${G.paginaActual === totalPaginas ? 'disabled' : ''} onclick='cambiarPagina(${G.paginaActual + 1})'>&gt;</button>`;
    pagDiv.innerHTML = html;
}

// --- 4. LÓGICA DE NEGOCIO Y ALGORITMOS DE IA ---

function calcularPrioridad(solicitud) {
    const monto = Number(solicitud.amount);
    if (monto >= 50000) return { texto: 'ALTA', color: '#ff6b6b' };
    if (monto >= 20000) return { texto: 'MEDIA', color: '#ffa726' };
    return { texto: 'BAJA', color: '#4caf50' };
}

 /**
 * Simula un algoritmo de predicción de riesgo.
 * @param {Solicitud} s - El objeto de la solicitud.
 * @returns {{probabilidad: number, clasificacion: string}}
 */
function predecirRiesgo(s) {
    const score = s.credit_score || 500;
    const monto = Number(s.amount) || 0;
    const plazo = s.term_months || 12;

    const ingresos = monto * 0.3 || 1;
    const deudas = monto * 0.1;
    const ratio = (deudas + (monto / plazo)) / ingresos;
    
    let prob = 5;
    if (ratio > 0.45) prob += 25;
    if (score < 600) prob += 25;
    else if (score < 700) prob += 10;

    const probabilidad = Math.min(prob, 95);
    let clasificacion = 'Bajo';
    if (probabilidad > 60) clasificacion = 'Alto';
    else if (probabilidad > 30) clasificacion = 'Medio';
    
    return { probabilidad: Math.round(probabilidad), clasificacion };
}

/**
 * Simula un algoritmo de clustering para perfilar al cliente.
 * @param {Solicitud} s - El objeto de la solicitud.
 * @returns {{perfil: string, recomendacion: string}}
 */
function analizarPerfilCliente(s) {
    const score = s.credit_score || 500;
    s.creditos_anteriores = Math.max(0, Math.floor((score - 400) / 100)); // Simula y añade al objeto
    
    let perfil = 'Emprendedor';
    let recomendacion = 'Cliente con potencial, requiere análisis de capacidad de pago.';
    if (score > 750 && s.creditos_anteriores > 3) {
        perfil = 'Consolidado';
        recomendacion = 'Cliente fiable con excelente historial.';
    } else if (score < 620 && s.creditos_anteriores < 1) {
        perfil = 'Joven Profesional';
        recomendacion = 'Historial limitado. Evaluar garantías.';
    }
    return { perfil, recomendacion };
}

// REEMPLAZA ESTA FUNCIÓN EN TU evaluador.js

/**
 * Simula un algoritmo de reglas de asociación (Apriori) para generar sugerencias.
 * ESTA VERSIÓN TIENE MÁS REGLAS PARA MOSTRAR RESULTADOS EN MÁS CASOS.
 * @param {Solicitud} s - El objeto de la solicitud.
 * @returns {Array<{tipo: string, texto: string}>}
 */
function generarSugerenciasIA(s) {
    const sugerencias = [];
    const proposito = s.purpose || '';
    const score = s.credit_score || 500;
    const monto = Number(s.amount) || 0;

    // Regla 1: Préstamos para negocio con score bajo (la que ya teníamos)
    if (proposito.toLowerCase().includes('negocio') && score < 650) {
        sugerencias.push({ tipo: 'alerta', texto: 'Patrón: Negocios con score bajo presentan mayor riesgo.' });
    }

    // Regla 2: Clientes excelentes (la que ya teníamos)
    if (s.prediccion.clasificacion === 'Bajo' && score > 750) {
        sugerencias.push({ tipo: 'exito', texto: 'Perfil de muy bajo riesgo con alta probabilidad de pago.' });
    }

    // --- NUEVAS REGLAS AÑADIDAS ---

    // Regla 3: Alerta general para cualquier solicitud de Riesgo Medio
    if (s.prediccion.clasificacion === 'Medio') {
        sugerencias.push({ tipo: 'alerta', texto: 'Sugerencia: Verificar consistencia de ingresos declarados para perfiles de riesgo medio.' });
    }

    // Regla 4: Alerta para montos muy altos
    if (monto > 100000) {
        sugerencias.push({ tipo: 'alerta', texto: 'Alerta: Monto solicitado es considerablemente alto. Requiere doble verificación de capacidad de pago.' });
    }
    
    return sugerencias;
}

/**
 * Dibuja el gráfico de dispersión en la sección de validación.
 * @param {Solicitud} s - El objeto de la solicitud.
 */
function renderizarGraficoCluster(s) {
    const ctx = document.getElementById('clusterChart')?.getContext('2d');
    if (!ctx) return;
    if (clusterChartInstance) clusterChartInstance.destroy();
    
    const data = {
        JP: Array.from({length:20},()=>({x:Math.random()*2e4+5e3,y:550+Math.random()*100})),
        EM: Array.from({length:20},()=>({x:Math.random()*6e4+2e4,y:600+Math.random()*150})),
        CO: Array.from({length:20},()=>({x:Math.random()*2e5+8e4,y:750+Math.random()*150}))
    };
    
    clusterChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {data:data.JP,backgroundColor:'rgba(23,162,184,0.5)'},
                {data:data.EM,backgroundColor:'rgba(40,167,69,0.5)'},
                {data:data.CO,backgroundColor:'rgba(0,123,255,0.5)'},
                {
                    label:'Cliente Actual',
                    data:[{x:Number(s.amount)||0,y:s.credit_score||500}],
                    backgroundColor:'rgba(255,193,7,1)',
                    pointStyle:'star', radius:12, borderColor:'black', borderWidth:2
                }
            ]
        },
        options: { responsive:true,maintainAspectRatio:false,scales:{x:{title:{display:true,text:'Monto (S/)'}},y:{title:{display:true,text:'Score Crediticio'}}},plugins:{legend:{display:false}}}
    });
}

/**
 * Calcula el score final basado en los puntajes base y las ponderaciones de los sliders.
 */
function updateScoring() {
    const pesos = {
        historial: parseInt(document.getElementById('pesoHistorial').value),
        ingresos: parseInt(document.getElementById('pesoIngresos').value),
        activos: parseInt(document.getElementById('pesoActivos').value),
        comportamiento: parseInt(document.getElementById('pesoComportamiento').value)
    };
    const totalPeso = Object.values(pesos).reduce((sum, val) => sum + val, 0);
    
    const puntajes = {
        historial: parseInt(document.getElementById('puntajeHistorial').textContent),
        ingresos: parseInt(document.getElementById('puntajeIngresos').textContent),
        activos: parseInt(document.getElementById('puntajeActivos').textContent),
        comportamiento: parseInt(document.getElementById('puntajeComportamiento').textContent)
    };

    let scoreFinal = 0;
    if (totalPeso > 0) {
        Object.keys(pesos).forEach(key => {
            const porcentaje = Math.round((pesos[key] / totalPeso) * 100);
            document.getElementById(`peso${key.charAt(0).toUpperCase() + key.slice(1)}Value`).textContent = `${porcentaje}%`;
            scoreFinal += puntajes[key] * (pesos[key] / totalPeso);
        });
    }
    scoreFinal = Math.round(scoreFinal);
    
    let clasificacion = 'Deficiente', color = '#dc3545';
    if (scoreFinal >= 80) { clasificacion = 'Excelente'; color = '#28a745'; }
    else if (scoreFinal >= 70) { clasificacion = 'Bueno'; color = '#007bff'; }
    else if (scoreFinal >= 60) { clasificacion = 'Regular'; color = '#ffc107'; }
    
    document.getElementById('scoreCalculado').textContent = scoreFinal;
    document.getElementById('clasificacionScore').textContent = clasificacion;
    document.getElementById('barraScore').style.width = `${scoreFinal}%`;
    document.getElementById('barraScore').style.backgroundColor = color;
    document.getElementById('scoring-circle').style.borderColor = color;
}

// --- 5. FLUJO DE TRABAJO PRINCIPAL ---



// REEMPLAZA ESTA FUNCIÓN EN TU evaluador.js

/**
 * Inicia el proceso de evaluación para una solicitud específica.
 * @param {number} id - El ID de la solicitud a evaluar.
 */
window.iniciarEvaluacion = async function(id) {
    showNotification('Analizando solicitud #' + id, 'info');
    const s = G.solicitudesPendientes.find(sol => sol.id == id);
    if (!s) return showNotification('Error: Solicitud no encontrada.', 'error');
    G.solicitudActiva = s;

    s.prediccion = predecirRiesgo(s);
    s.analisis_perfil = analizarPerfilCliente(s);
    s.sugerencias_ia = generarSugerenciasIA(s);
    
    // ... (El resto del código que llena los paneles de perfil y riesgo se mantiene igual) ...
    document.getElementById('val-solicitud-id').textContent = `#${s.id}`;
    document.getElementById('val-info-cliente').innerHTML = `<p><strong>Cliente:</strong> ${s.client_username??""}</p><p><strong>Monto:</strong> S/ ${Number(s.amount).toLocaleString('es-PE')}</p><p><strong>Plazo:</strong> ${s.term_months??""} meses</p><p><strong>Propósito:</strong> ${s.purpose??""}</p>`;
    const { perfil, recomendacion } = s.analisis_perfil;
    const colores = { 'Emprendedor': '#28a745', 'Consolidado': '#007bff', 'Joven Profesional': '#17a2b8' };
    document.getElementById('val-perfil-badge').innerHTML = `<span class="badge" style="background-color:${colores[perfil]};color:white;font-size:1.2rem;">${perfil}</span>`;
    document.getElementById('val-score-hist').textContent = s.credit_score ?? 'N/A';
    document.getElementById('val-creditos-ant').textContent = s.creditos_anteriores ?? 'N/A';
    document.getElementById('val-recomendacion').textContent = recomendacion;
    document.getElementById('panel-perfil-ia').style.borderColor = colores[perfil];
    const { probabilidad, clasificacion } = s.prediccion;
    document.getElementById('pred-probabilidad').textContent = `${probabilidad}%`;
    document.getElementById('pred-clasificacion').textContent = `Riesgo ${clasificacion}`;
    const sugerenciasContainer = document.getElementById('panel-sugerencias-ia');
    sugerenciasContainer.innerHTML = (s.sugerencias_ia.length > 0)
        ? s.sugerencias_ia.map(sug => `<div class="alert-item-visual"><h5><i class="fas ${sug.tipo === 'alerta' ? 'fa-exclamation-triangle text-warning' : 'fa-check-circle text-success'}"></i> ${sug.texto}</h5></div>`).join('')
        : '<div class="alert-item-visual"><p>No hay sugerencias automáticas.</p></div>';

    // --- CÓDIGO DE DOCUMENTOS MODIFICADO ---
    const docsDiv = document.getElementById('val-documentos-container');

    const nombreCompleto = (s.client_username || 'Usuario Desconocido').replace(/[0-9]/g, '').replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
    const partesNombre = nombreCompleto.split(' ');
    const nombres = partesNombre.length > 1 ? partesNombre[0] : '';
    const apellidos = partesNombre.length > 1 ? partesNombre.slice(1).join(' ') : partesNombre[0];
    const dni = s.client_dni || '00000000';
    const fechaSolicitud = new Date(s.application_date).toLocaleDateString('es-PE');

    // Ahora solo generamos la tarjeta DNI
    docsDiv.innerHTML = `
        <div class="card mb-2 dni-card" style="border-left: 4px solid #0d6efd; font-family: 'Lucida Console', Monaco, monospace;">
            <div class="card-body">
                <p style="text-align:center; font-weight:bold; margin:0; font-size: 0.8em; letter-spacing: 2px;">REPÚBLICA DEL PERÚ</p>
                <div style="display:flex; align-items:center; gap:15px; margin-top:10px;">
                    <div class="dni-photo" style="font-size: 4.5em; color: #d3d3d3; text-align:center;">
                        <i class="fas fa-user-circle"></i>
                    </div>
                    <div class="dni-info" style="font-size: 0.85em; line-height: 1.5;">
                        <strong style="display:block; font-size: 0.8em;">APELLIDOS</strong>
                        <span style="display:block; margin-bottom:5px; font-weight:600;">${apellidos.toUpperCase() || 'N/A'}</span>
                        <strong style="display:block; font-size: 0.8em;">NOMBRES</strong>
                        <span style="display:block; margin-bottom:5px; font-weight:600;">${nombres.toUpperCase() || 'N/A'}</span>
                        <strong style="display:block; font-size: 0.8em;">DNI / FECHA SOLICITUD</strong>
                        <span>${dni} / ${fechaSolicitud}</span>
                    </div>
                </div>
            </div>
        </div>
        `;
    
    // Renderizar el gráfico y mostrar la sección
    renderizarGraficoCluster(s);
    showSection('validacion');
};
/**
 * Navega a la sección de Scoring y la prepara con los datos de la solicitud activa.
 */
// PEGA ESTA FUNCIÓN COMPLETA EN TU SECCIÓN 5

/**
 * FUNCIÓN CLAVE FALTANTE: Calcula el score en tiempo real cuando mueves los sliders.
 */
function updateScoring() {
    // 1. Obtener pesos de los sliders
    const pesos = {
        historial: parseInt(document.getElementById('pesoHistorial').value),
        ingresos: parseInt(document.getElementById('pesoIngresos').value),
        activos: parseInt(document.getElementById('pesoActivos').value),
        comportamiento: parseInt(document.getElementById('pesoComportamiento').value)
    };
    const totalPeso = Object.values(pesos).reduce((sum, val) => sum + val, 0);
    
    // 2. Obtener puntajes base que ya se cargaron en pantalla
    const puntajes = {
        historial: parseInt(document.getElementById('puntajeHistorial').textContent),
        ingresos: parseInt(document.getElementById('puntajeIngresos').textContent),
        activos: parseInt(document.getElementById('puntajeActivos').textContent),
        comportamiento: parseInt(document.getElementById('puntajeComportamiento').textContent)
    };

    // 3. Calcular el score final ponderado
    let scoreFinal = 0;
    if (totalPeso > 0) {
        Object.keys(pesos).forEach(key => {
            const porcentaje = Math.round((pesos[key] / totalPeso) * 100);
            document.getElementById(`peso${key.charAt(0).toUpperCase() + key.slice(1)}Value`).textContent = `${porcentaje}%`;
            scoreFinal += puntajes[key] * (pesos[key] / totalPeso);
        });
    }
    scoreFinal = Math.round(scoreFinal);
    
    // 4. Determinar clasificación y color
    let clasificacion = 'Deficiente', color = '#dc3545';
    if (scoreFinal >= 80) { clasificacion = 'Excelente'; color = '#28a745'; }
    else if (scoreFinal >= 70) { clasificacion = 'Bueno'; color = '#007bff'; }
    else if (scoreFinal >= 60) { clasificacion = 'Regular'; color = '#ffc107'; }
    
    // 5. Actualizar la UI del score
    document.getElementById('scoreCalculado').textContent = scoreFinal;
    document.getElementById('clasificacionScore').textContent = clasificacion;
    document.getElementById('barraScore').style.width = `${scoreFinal}%`;
    document.getElementById('barraScore').style.backgroundColor = color;
    document.getElementById('scoring-circle').style.borderColor = color;
}
// REEMPLAZA ESTAS DOS FUNCIONES EN TU evaluador.js

/**
 * Aprueba una solicitud desde la pantalla de Scoring si el score es suficiente.
 * Guarda el estado en el backend y actualiza la UI.
 */
/**
 * Aprueba la solicitud activa, la actualiza en el backend y regresa a la lista de pendientes.
 * Se activa con el botón "Aprobar".
 */
/**
 * Aprueba una solicitud desde la pantalla de Scoring si el score es suficiente.
 * Guarda el estado en el backend y actualiza la UI.
 */
async function aprobarAutomatico() {
    const solicitudActiva = window.solicitudSeleccionadaScoring;
    if (!solicitudActiva) {
        return showNotification('Error: No hay ninguna solicitud activa.', 'error');
    }

    const scoreFinal = parseInt(document.getElementById('scoreCalculado').textContent) || 0;
    if (scoreFinal < 70) {
        return showNotification('Score bajo. Se recomienda enviar a revisión manual.', 'warning');
    }
    
    showNotification(`Aprobando solicitud #${solicitudActiva.id}...`, 'info');

    const payload = {
        status: 'aprobada',
        credit_score: scoreFinal
    };
    
    // Asume que tienes una función patchAPI o haz el fetch directamente
    try {
        const user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
        const response = await fetch(`/api/applications/${solicitudActiva.id}/`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showNotification(`Solicitud #${solicitudActiva.id} aprobada con éxito.`, 'success');
            showSection('pendientes');
            cargarSolicitudesPendientes();
            cargarEstadisticasEvaluador();
        } else {
            showNotification('Error del servidor al aprobar.', 'error');
        }
    } catch (error) {
        showNotification('Error de conexión al aprobar.', 'error');
    }
}

/**
 * Envía la solicitud activa a la etapa de Revisión Manual y navega a esa pantalla.
 */
// REEMPLAZA ESTA FUNCIÓN EN TU evaluador.js

/**
 * Envía la solicitud a Revisión Manual.
 * Guarda el score, actualiza el estado en el backend y navega a la siguiente pantalla.
 */
/**
 * Envía la solicitud a Revisión Manual y navega a esa pantalla.
 * Guarda el score actual y actualiza el estado en el backend.
 */
/**
 * Envía al usuario a la pantalla de Revisión Manual con los datos de la solicitud.
 * Esta es una versión simplificada que se enfoca en la navegación.
 */
function enviarARevisionManual() {
    // 1. Obtiene la solicitud activa
    const s = G.solicitudActiva;
    if (!s) {
        showNotification('Error: No hay una solicitud activa para revisar.', 'error');
        return;
    }

    // 2. Llena la sección de Revisión con los datos del caso
    const score = document.getElementById('scoreCalculado').textContent;
    document.getElementById('revision-header').innerHTML = `<i class="fas fa-user-check"></i> Revisión Manual - Solicitud #${s.id}`;
    document.getElementById('revCliente').textContent = s.client_username ?? '-';
    document.getElementById('revMonto').textContent = `S/ ${Number(s.amount).toLocaleString('es-PE')}`;
    document.getElementById('revScore').textContent = score || s.credit_score || '-';
    document.getElementById('montoManual').value = s.amount;

    // 3. Te lleva directamente a la sección de Revisión
    showNotification('Pasando a Revisión Manual...', 'info');
    showSection('revision');
}
/**
 * Envía la solicitud activa a la etapa de Revisión Manual.
 * Se activa con el botón "Enviar a Revisión
/**
 * Guarda la decisión final (aprobada/rechazada) desde la pantalla de Revisión Manual.
 */
// REEMPLAZA ESTA FUNCIÓN EN TU evaluador.js
// REEMPLAZA ESTA FUNCIÓN EN TU evaluador.js

/**
 * Guarda la decisión final (aprobada/rechazada) desde la pantalla de Revisión Manual.
 * Envía los datos al backend y actualiza toda la interfaz.
 */
async function guardarDecisionManual() {
    // 1. Obtiene la solicitud activa que estás revisando.
    const s = G.solicitudActiva;
    if (!s) {
        return showNotification('Error: No hay una solicitud activa para guardar.', 'error');
    }
    
    // 2. Recoge los datos del formulario de decisión.
    const decision = document.getElementById('decisionManual').value;
    const montoAprobado = document.getElementById('montoManual').value;
    const observaciones = document.getElementById('observacionesManual').value;

    // 3. Valida que se haya seleccionado una decisión.
    if (!decision) {
        return showNotification('Por favor, seleccione una decisión (Aprobar o Rechazar).', 'error');
    }
    
    showNotification(`Finalizando solicitud #${s.id} como "${decision}"...`, 'info');

    // 4. Prepara los datos para enviar a tu API.
    const payload = {
        status: decision, // Será 'aprobada' o 'rechazada'
        amount_aprobado: montoAprobado,
        evaluator_comments: observaciones,
        evaluated_at: new Date().toISOString()
    };
    
    // 5. Envía la actualización final al backend.
    const res = await patchAPI(`/api/applications/${s.id}/`, payload);
    
    // 6. Si el backend confirma, actualiza toda la pantalla.
    if(res && res.ok) {
        showNotification('Decisión final guardada con éxito.', 'success');
        
        // Vuelve a la pantalla principal
        showSection('pendientes');
        
        // Refresca la lista de pendientes (la solicitud desaparecerá)
        cargarSolicitudesPendientes();
        
        // Refresca las tarjetas de estadísticas (contadores de hoy, pendientes, etc.)
        cargarEstadisticasEvaluador();

    } else {
        showNotification('Error: No se pudo guardar la decisión final.', 'error');
    }
}
/**
 * Genera y descarga un reporte en PDF con las estadísticas del evaluador.
 */
function generarReportePDF() {
    if (!window.jspdf) return showNotification('Librería PDF no encontrada.', 'error');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text('Reporte de Desempeño del Evaluador', 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-PE')}`, 14, 29);
    
    // Necesita el plugin autotable para una tabla profesional, esto es un fallback simple.
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('Estadísticas Generales:', 14, 40);
    const body = [
        ['Solicitudes Pendientes', document.querySelector('#stat-pendientes').textContent],
        ['Evaluadas Hoy', document.querySelector('#stat-evaluadas').textContent],
        ['Tasa de Aprobación', document.querySelector('#stat-tasa').textContent],
        ['Tiempo Promedio', document.querySelector('#stat-tiempo').textContent],
    ];
    let startY = 45;
    body.forEach(row => {
        doc.text(`${row[0]}: ${row[1]}`, 14, startY);
        startY += 7;
    });

    showNotification('Generando reporte PDF...', 'info');
    doc.save('Reporte_CreditoSys.pdf');
}

// --- 6. NAVEGACIÓN Y MANEJO DE SECCIONES ---

/**
 * Muestra una sección del panel y oculta las demás.
 * @param {string} sectionName - El ID de la sección a mostrar.
 */
function showSection(sectionName) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.section === sectionName);
    });
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
        section.classList.remove('active');
    });
    
    const targetSection = document.getElementById(sectionName);
    if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.classList.add('active');
        void targetSection.offsetWidth; 
        targetSection.style.animation = 'fadeIn 0.5s';
    }
    
    if (sectionName === 'revision' && G.solicitudActiva) {
        const s = G.solicitudActiva;
        document.getElementById('revision-header').innerHTML = `<i class="fas fa-user-check"></i> Revisión Manual - Solicitud #${s.id}`;
        document.getElementById('revCliente').textContent = s.client_username ?? '-';
        document.getElementById('revMonto').textContent = `S/ ${Number(s.amount).toLocaleString('es-PE')}`;
        document.getElementById('revScore').textContent = document.getElementById('scoreCalculado').textContent || s.credit_score || '-';
        document.getElementById('montoManual').value = s.amount;
    }
}

// --- 7. INICIALIZACIÓN Y EVENT LISTENERS GLOBALES ---

window.cambiarPagina = function(nuevaPagina) { G.paginaActual = nuevaPagina; renderSolicitudesPaginadas(); };

document.addEventListener('DOMContentLoaded', () => {
    // Carga inicial de datos
    cargarEstadisticasEvaluador();
    cargarSolicitudesPendientes();

    // Asignar eventos a elementos estáticos
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => showSection(tab.dataset.section));
    });

    document.getElementById('busquedaSolicitudes')?.addEventListener('input', e => {
        G.filtroBusqueda = e.target.value;
        G.paginaActual = 1;
        renderSolicitudesPaginadas();
    });
    
    document.getElementById('btnActualizarPendientes')?.addEventListener('click', cargarSolicitudesPendientes);
    document.getElementById('btnProcederAScoring')?.addEventListener('click', procederAScoring);
    document.getElementById('btnAprobarAuto')?.addEventListener('click', aprobarAutomatico);
    document.getElementById('btnEnviarRevision')?.addEventListener('click', enviarARevisionManual);
    document.getElementById('btnGuardarDecision')?.addEventListener('click', guardarDecisionManual);
    document.getElementById('btnGenerarReporte')?.addEventListener('click', generarReportePDF);
    document.getElementById('btnLogout').onclick = window.logout;

    document.querySelectorAll('#scoring input[type="range"]').forEach(slider => {
        slider.addEventListener('input', updateScoring);
    });
});
/**
 * Navega a la sección de Scoring y la prepara con los datos de la solicitud activa.
 */
function procederAScoring() {
    // Obtiene la solicitud que se está viendo
    const s = G.solicitudActiva;
    if (!s) {
        showNotification('Error: No hay una solicitud activa.', 'error');
        return;
    }
    
    // Prepara la pantalla de Scoring con los datos
    document.getElementById('scoring-header').innerHTML = `<i class="fas fa-calculator"></i> Cálculo de Score - Solicitud #${s.id}`;
    document.getElementById('puntajeHistorial').textContent = s.credit_score || '70';
    document.getElementById('puntajeIngresos').textContent = '85'; // Simulado
    document.getElementById('puntajeActivos').textContent = '75'; // Simulado
    document.getElementById('puntajeComportamiento').textContent = '80'; // Simulado
    
    // Te lleva a la sección de Scoring
    showSection('scoring');
    
    // Realiza el primer cálculo de score
    updateScoring();
}
/**
 * Guarda la decisión final (aprobada/rechazada) desde la pantalla de Revisión Manual.
 * Envía los datos al backend y actualiza toda la interfaz.
 */
