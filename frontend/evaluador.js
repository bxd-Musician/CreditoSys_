// evaluador.js

// Variables globales protegidas para evitar doble declaración
if (!window.evaluadorGlobals) {
    window.evaluadorGlobals = true;
    window.solicitudesPendientes = [];
    window.paginaActual = 1;
    window.solicitudesPorPagina = 5;
    window.filtroBusqueda = '';
}

async function cargarEstadisticasEvaluador() {
    const pendientesElem = document.querySelector('.stat-card:nth-child(1) .stat-number');
    const evaluadasHoyElem = document.querySelector('.stat-card:nth-child(2) .stat-number');
    const tasaAprobacionElem = document.querySelector('.stat-card:nth-child(3) .stat-number');
    const tiempoPromedioElem = document.querySelector('.stat-card:nth-child(4) .stat-number');
    let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!user || !user.access_token) return;
    try {
        let response;
        if (typeof fetchAuthenticated === 'function') {
            response = await fetchAuthenticated('/api/applications/evaluator-stats/');
        } else {
            response = await fetch('/api/applications/evaluator-stats/', {
                headers: {
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            response = await response.json();
        }
        if (pendientesElem) pendientesElem.textContent = response.pendientes ?? '-';
        if (evaluadasHoyElem) evaluadasHoyElem.textContent = response.evaluadas_hoy ?? '-';
        if (tasaAprobacionElem) tasaAprobacionElem.textContent = (response.tasa_aprobacion !== undefined ? response.tasa_aprobacion + '%' : '-');
        if (tiempoPromedioElem) tiempoPromedioElem.textContent = (response.tiempo_promedio !== undefined ? response.tiempo_promedio + ' min' : '-');
    } catch (e) {
        if (pendientesElem) pendientesElem.textContent = '-';
        if (evaluadasHoyElem) evaluadasHoyElem.textContent = '-';
        if (tasaAprobacionElem) tasaAprobacionElem.textContent = '-';
        if (tiempoPromedioElem) tiempoPromedioElem.textContent = '-';
        console.error('Error cargando estadísticas del evaluador:', e);
    }
}

async function cargarSolicitudesPendientes() {
    const tablaBody = document.querySelector('.table tbody');
    if (!tablaBody) return;
    tablaBody.innerHTML = '<tr><td colspan="7" class="text-center">Cargando...</td></tr>';
    let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
    if (!user || !user.access_token) return;
    try {
        // Hacer dos peticiones y combinar resultados
        let [respPendiente, respRevision] = await Promise.all([
            fetch('/api/applications/?status=pendiente', {
                headers: {
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json'
                }
            }),
            fetch('/api/applications/?status=en_revision', {
                headers: {
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json'
                }
            })
        ]);
        let solicitudesPendiente = await respPendiente.json();
        let solicitudesRevision = await respRevision.json();
        let arrPendiente = Array.isArray(solicitudesPendiente) ? solicitudesPendiente : (solicitudesPendiente.results || []);
        let arrRevision = Array.isArray(solicitudesRevision) ? solicitudesRevision : (solicitudesRevision.results || []);
        window.solicitudesPendientes = arrPendiente.concat(arrRevision);
        renderSolicitudesPaginadas();
    } catch (e) {
        tablaBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar solicitudes.</td></tr>';
        console.error('Error cargando solicitudes pendientes:', e);
    }
}

function renderSolicitudesPaginadas() {
    const tablaBody = document.querySelector('.table tbody');
    if (!tablaBody) return;
    let filtradas = window.solicitudesPendientes.filter(s => {
        if (!window.filtroBusqueda) return true;
        const texto = `${s.id} ${s.client_username || ''} ${s.amount}`.toLowerCase();
        return texto.includes(window.filtroBusqueda.toLowerCase());
    });
    const total = filtradas.length;
    const totalPaginas = Math.ceil(total / window.solicitudesPorPagina);
    if (window.paginaActual > totalPaginas) window.paginaActual = 1;
    const inicio = (window.paginaActual - 1) * window.solicitudesPorPagina;
    const fin = inicio + window.solicitudesPorPagina;
    const pagina = filtradas.slice(inicio, fin);
    if (!pagina.length) {
        tablaBody.innerHTML = '<tr><td colspan="7" class="text-center">No hay solicitudes pendientes.</td></tr>';
        renderPaginacionSolicitudes(total, totalPaginas);
        return;
    }
    tablaBody.innerHTML = '';
    pagina.forEach(s => {
        const estado = s.status === 'pendiente' ? 'DOCUMENTOS SUBIDOS' : s.status === 'en_revision' ? 'EN VALIDACIÓN' : s.status.toUpperCase();
        const prioridad = calcularPrioridad(s);
        const accion = s.status === 'en_revision' ?
            `<button class='btn btn-success btn-sm' onclick='continuarEvaluacion(${s.id})'><i class="fas fa-arrow-right"></i> Continuar</button>` :
            `<button class='btn btn-primary btn-sm' onclick='iniciarEvaluacion(${s.id})'><i class="fas fa-play"></i> Evaluar</button>`;
        tablaBody.innerHTML += `
            <tr>
                <td>#${s.id.toString().padStart(3, '0')}</td>
                <td>${s.client_username || '-'}</td>
                <td>S/ ${Number(s.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                <td>${new Date(s.application_date).toLocaleDateString()}</td>
                <td><span class='badge status-${s.status}'>${estado}</span></td>
                <td><span class='badge' style='background:${prioridad.color};color:white;'>${prioridad.texto}</span></td>
                <td>${accion}</td>
            </tr>
        `;
    });
    renderPaginacionSolicitudes(total, totalPaginas);
}

function renderPaginacionSolicitudes(total, totalPaginas) {
    const pagDiv = document.getElementById('paginacionSolicitudes');
    if (!pagDiv) return;
    let html = '';
    if (totalPaginas > 1) {
        html += `<button class='btn btn-outline btn-sm' ${window.paginaActual === 1 ? 'disabled' : ''} onclick='cambiarPaginaSolicitudes(${window.paginaActual - 1})'><i class='fas fa-chevron-left'></i></button>`;
        for (let i = 1; i <= totalPaginas; i++) {
            html += `<button class='btn ${i === window.paginaActual ? 'btn-primary' : 'btn-outline'} btn-sm' onclick='cambiarPaginaSolicitudes(${i})'>${i}</button>`;
        }
        html += `<button class='btn btn-outline btn-sm' ${window.paginaActual === totalPaginas ? 'disabled' : ''} onclick='cambiarPaginaSolicitudes(${window.paginaActual + 1})'><i class='fas fa-chevron-right'></i></button>`;
    }
    pagDiv.innerHTML = html;
}

window.cambiarPaginaSolicitudes = function(nuevaPagina) {
    window.paginaActual = nuevaPagina;
    renderSolicitudesPaginadas();
};

document.getElementById('busquedaSolicitudes').addEventListener('input', function(e) {
    window.filtroBusqueda = e.target.value;
    window.paginaActual = 1;
    renderSolicitudesPaginadas();
});

// Eliminar función verDetalleSolicitud y cerrarModalDetalleSolicitud
window.verDetalleSolicitud = undefined;
window.cerrarModalDetalleSolicitud = undefined;

async function actualizarEstadoSolicitud(id, nuevoEstado) {
    let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
    const comentarios = document.getElementById('comentariosEvaluador')?.value || '';
    try {
        await fetch(`/api/applications/${id}/`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: nuevoEstado, evaluator_comments: comentarios })
        });
        cargarSolicitudesPendientes();
        cargarEstadisticasEvaluador();
    } catch (e) {
        alert('Error al actualizar la solicitud');
    }
}

function calcularPrioridad(solicitud) {
    if (solicitud.amount >= 40000) return { texto: 'ALTA', color: '#ff6b6b' };
    if (solicitud.amount >= 20000) return { texto: 'MEDIA', color: '#ffa726' };
    return { texto: 'BAJA', color: '#4caf50' };
}

function hookActualizarPendientes() {
    const btn = document.querySelector('.card-header button.btn-primary, .card-header .btn.btn-primary');
    if (btn) btn.onclick = cargarSolicitudesPendientes;
}

document.addEventListener('DOMContentLoaded', function() {
    cargarEstadisticasEvaluador();
    cargarSolicitudesPendientes();
    hookActualizarPendientes();
});

window.iniciarEvaluacion = async function(id) {
    await mostrarValidacionSolicitud(id);
};
window.continuarEvaluacion = async function(id) {
    await mostrarValidacionSolicitud(id);
};

// Corrige showSection para que funcione sin event.target
window.showSection = function(sectionName) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    // Activar la pestaña correspondiente solo si se llama desde un evento
    const navTabs = document.querySelectorAll('.nav-tab');
    for (let tab of navTabs) {
        if (tab.textContent.toLowerCase().includes(sectionName)) {
            tab.classList.add('active');
            break;
        }
    }
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });
    const targetSection = document.getElementById(sectionName);
    if (targetSection) {
        targetSection.classList.add('active');
        targetSection.classList.add('fade-in');
    }
};

// Guardar la solicitud seleccionada globalmente
window.solicitudSeleccionadaScoring = null;

// Modifica mostrarValidacionSolicitud para guardar la solicitud seleccionada
async function mostrarValidacionSolicitud(id) {
    // Buscar solicitud
    const solicitud = window.solicitudesPendientes.find(s => s.id == id);
    if (!solicitud) return;
    window.solicitudSeleccionadaScoring = solicitud; // Guardar para scoring
    // Cambiar título
    const titulo = document.querySelector('#validacion .card-header h3');
    if (titulo) titulo.innerHTML = `<i class="fas fa-file-check"></i> Validación de Documentos - Solicitud #${solicitud.id}`;
    // Mostrar datos del cliente
    const infoCliente = document.querySelector('#validacion .col-2 .card-body');
    if (infoCliente) {
        infoCliente.innerHTML = `
            <p><strong>Nombre:</strong> ${solicitud.client_username ?? '-'}</p>
            <p><strong>DNI:</strong> ${solicitud.client_dni ?? '-'}</p>
            <p><strong>Email:</strong> ${solicitud.client_email ?? '-'}</p>
            <p><strong>Teléfono:</strong> ${solicitud.client_phone ?? '-'}</p>
            <p><strong>Monto:</strong> S/ ${solicitud.amount !== undefined && solicitud.amount !== null ? Number(solicitud.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}</p>
            <p><strong>Plazo:</strong> ${solicitud.term ?? '-'} meses</p>
        `;
    }
    // Mostrar documentos a validar
    const docsCont = document.querySelector('#validacion .col-2:nth-child(2)');
    if (docsCont) {
        docsCont.innerHTML = `<h4>Documentos a Validar</h4><div id='docsAValidar'></div><div class='text-center mt-3'><button id='btnProcederScoring' class='btn btn-primary btn-lg'><i class='fas fa-arrow-right'></i> Proceder a Scoring</button></div>`;
        const docsDiv = docsCont.querySelector('#docsAValidar');
        docsDiv.innerHTML = '<span class="text-muted">Cargando documentos...</span>';
        let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
        try {
            const resp = await fetch(`/api/applications/${id}/documents/`, {
                headers: { 'Authorization': `Bearer ${user.access_token}` }
            });
            const docs = await resp.json();
            if (Array.isArray(docs) && docs.length > 0) {
                docsDiv.innerHTML = docs.map(doc => `
                    <div class='card mb-2' style='position:relative;'>
                        ${estadoBadgeDoc(doc.status)}
                        <div class='card-body'>
                            <h5><i class='fas fa-file'></i> ${doc.document_type} ${estadoBadgeDoc(doc.status)}</h5>
                            <p>${doc.description || ''}</p>
                            <div class='d-flex gap-1'>
                                <a href='${doc.file}' target='_blank' class='btn btn-primary btn-sm'><i class='fas fa-eye'></i> Ver</a>
                                ${doc.status === 'pendiente' ? `
                                    <button class='btn btn-success btn-sm' onclick='validarDocumentoIndividual(${doc.id},"valido",${id})'><i class='fas fa-check'></i> Validar</button>
                                    <button class='btn btn-danger btn-sm' onclick='validarDocumentoIndividual(${doc.id},"rechazado",${id})'><i class='fas fa-times'></i> Rechazar</button>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `).join('');
            } else {
                docsDiv.innerHTML = '<span class="text-muted">No hay documentos subidos.</span>';
            }
        } catch (e) {
            docsDiv.innerHTML = '<span class="text-danger">Error al cargar documentos.</span>';
        }
        // Botón Proceder a Scoring funcional
        const btnScoring = docsCont.querySelector('#btnProcederScoring');
        if (btnScoring) {
            btnScoring.onclick = function() {
                showNotification('Procediendo a cálculo de scoring para la solicitud #' + id, 'info');
                llenarScoringConSolicitud(solicitud);
                showSection('scoring');
            };
        }
    }
    // Cambiar a la sección de validación
    showSection('validacion');
}

// Función para llenar la sección de scoring con los datos de la solicitud seleccionada
function llenarScoringConSolicitud(solicitud) {
    // Cabecera
    const header = document.querySelector('#scoring .card-header h3');
    if (header) header.innerHTML = `<i class="fas fa-calculator"></i> Cálculo de Score Crediticio - Solicitud #${solicitud.id}`;
    // Datos clave
    const scoringCard = document.querySelector('#scoring .card-body .row');
    if (scoringCard) {
        let infoHtml = `<div class='mb-2'><strong>Cliente:</strong> ${solicitud.client_username ?? '-'}<br>` +
            `<strong>Monto:</strong> S/ ${Number(solicitud.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br>` +
            `<strong>Plazo:</strong> ${solicitud.term_months ?? '-'} meses<br>` +
            `<strong>Propósito:</strong> ${solicitud.purpose ?? '-'}<br>` +
            `<strong>Estado:</strong> ${solicitud.status ?? '-'}<br></div>`;
        let firstCol = scoringCard.querySelector('.col-2, .col-3');
        if (firstCol && !scoringCard.querySelector('.scoring-info')) {
            let div = document.createElement('div');
            div.className = 'col-2 scoring-info';
            div.innerHTML = infoHtml;
            scoringCard.insertBefore(div, firstCol);
        } else if (firstCol && scoringCard.querySelector('.scoring-info')) {
            scoringCard.querySelector('.scoring-info').innerHTML = infoHtml;
        }
    }
    // Llenar scoring con datos reales si existen
    let historial = solicitud.historial_crediticio ?? 0;
    let ingresos = solicitud.ingresos ?? 0;
    let activos = solicitud.activos ?? 0;
    let comportamiento = solicitud.comportamiento ?? 0;
    // Si existen inputs, actualízalos
    if (document.getElementById('puntajeHistorial')) document.getElementById('puntajeHistorial').textContent = historial;
    if (document.getElementById('puntajeIngresos')) document.getElementById('puntajeIngresos').textContent = ingresos;
    if (document.getElementById('puntajeActivos')) document.getElementById('puntajeActivos').textContent = activos;
    if (document.getElementById('puntajeComportamiento')) document.getElementById('puntajeComportamiento').textContent = comportamiento;
    // Desglose de puntajes
    const desglose = document.querySelector('#scoring .mt-3');
    if (desglose) {
        desglose.innerHTML = `
            <h5>Desglose:</h5>
            <p>Historial: <input type='number' id='inputHistorial' value='${historial}' min='0' max='100' style='width:60px;'> pts</p>
            <p>Ingresos: <input type='number' id='inputIngresos' value='${ingresos}' min='0' max='100' style='width:60px;'> pts</p>
            <p>Activos: <input type='number' id='inputActivos' value='${activos}' min='0' max='100' style='width:60px;'> pts</p>
            <p>Comportamiento: <input type='number' id='inputComportamiento' value='${comportamiento}' min='0' max='100' style='width:60px;'> pts</p>
            <button class='btn btn-primary btn-sm mt-2' id='btnGuardarPuntajes'>Guardar Puntajes</button>
        `;
    }
    // Recalcular score (ahora sí existen los inputs)
    calcularScoreRealTime();
    // Resalta el resultado
    setTimeout(() => {
        const score = document.getElementById('scoreCalculado');
        if (score) {
            score.style.background = '#e3fcec';
            score.style.borderRadius = '50%';
            score.style.transition = 'background 0.5s';
            setTimeout(() => { score.style.background = ''; }, 1500);
        }
        hookGuardarScoreScoring();
    }, 500);
}

// Función para guardar el score en el backend
async function guardarScoreSolicitud(id, score) {
    let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
    try {
        await fetch(`/api/applications/${id}/`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ credit_score: score })
        });
    } catch (e) {
        showNotification('Error al guardar el score en el backend', 'error');
    }
}

// Hook para guardar el score al aprobar/rechazar desde scoring
function hookGuardarScoreScoring() {
    const btnAprobar = document.querySelector('#scoring .btn-success');
    const btnRevision = document.querySelector('#scoring .btn-warning');
    if (btnAprobar) {
        btnAprobar.onclick = async function() {
            const score = parseInt(document.getElementById('scoreCalculado').textContent) || 0;
            if (window.solicitudSeleccionadaScoring) {
                await guardarScoreSolicitud(window.solicitudSeleccionadaScoring.id, score);
            }
            showNotification('Solicitud aprobada automáticamente', 'success');
        };
    }
    if (btnRevision) {
        btnRevision.onclick = async function() {
            const score = parseInt(document.getElementById('scoreCalculado').textContent) || 0;
            if (window.solicitudSeleccionadaScoring) {
                await guardarScoreSolicitud(window.solicitudSeleccionadaScoring.id, score);
            }
            showNotification('Enviando a revisión manual...', 'info');
            showSection('revision');
        };
    }
}

// Llama el hook cada vez que se llena scoring
function llenarScoringConSolicitud(solicitud) {
    // Cabecera
    const header = document.querySelector('#scoring .card-header h3');
    if (header) header.innerHTML = `<i class="fas fa-calculator"></i> Cálculo de Score Crediticio - Solicitud #${solicitud.id}`;
    // Datos clave
    const scoringCard = document.querySelector('#scoring .card-body .row');
    if (scoringCard) {
        let infoHtml = `<div class='mb-2'><strong>Cliente:</strong> ${solicitud.client_username ?? '-'}<br>` +
            `<strong>Monto:</strong> S/ ${Number(solicitud.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br>` +
            `<strong>Plazo:</strong> ${solicitud.term_months ?? '-'} meses<br>` +
            `<strong>Propósito:</strong> ${solicitud.purpose ?? '-'}<br>` +
            `<strong>Estado:</strong> ${solicitud.status ?? '-'}<br></div>`;
        let firstCol = scoringCard.querySelector('.col-2, .col-3');
        if (firstCol && !scoringCard.querySelector('.scoring-info')) {
            let div = document.createElement('div');
            div.className = 'col-2 scoring-info';
            div.innerHTML = infoHtml;
            scoringCard.insertBefore(div, firstCol);
        } else if (firstCol && scoringCard.querySelector('.scoring-info')) {
            scoringCard.querySelector('.scoring-info').innerHTML = infoHtml;
        }
    }
    // Llenar scoring con datos reales si existen
    let historial = solicitud.historial_crediticio ?? 0;
    let ingresos = solicitud.ingresos ?? 0;
    let activos = solicitud.activos ?? 0;
    let comportamiento = solicitud.comportamiento ?? 0;
    // Si existen inputs, actualízalos
    if (document.getElementById('puntajeHistorial')) document.getElementById('puntajeHistorial').textContent = historial;
    if (document.getElementById('puntajeIngresos')) document.getElementById('puntajeIngresos').textContent = ingresos;
    if (document.getElementById('puntajeActivos')) document.getElementById('puntajeActivos').textContent = activos;
    if (document.getElementById('puntajeComportamiento')) document.getElementById('puntajeComportamiento').textContent = comportamiento;
    // Desglose de puntajes
    const desglose = document.querySelector('#scoring .mt-3');
    if (desglose) {
        desglose.innerHTML = `
            <h5>Desglose:</h5>
            <p>Historial: <input type='number' id='inputHistorial' value='${historial}' min='0' max='100' style='width:60px;'> pts</p>
            <p>Ingresos: <input type='number' id='inputIngresos' value='${ingresos}' min='0' max='100' style='width:60px;'> pts</p>
            <p>Activos: <input type='number' id='inputActivos' value='${activos}' min='0' max='100' style='width:60px;'> pts</p>
            <p>Comportamiento: <input type='number' id='inputComportamiento' value='${comportamiento}' min='0' max='100' style='width:60px;'> pts</p>
            <button class='btn btn-primary btn-sm mt-2' id='btnGuardarPuntajes'>Guardar Puntajes</button>
        `;
    }
    // Recalcular score (ahora sí existen los inputs)
    calcularScoreRealTime();
    // Resalta el resultado
    setTimeout(() => {
        const score = document.getElementById('scoreCalculado');
        if (score) {
            score.style.background = '#e3fcec';
            score.style.borderRadius = '50%';
            score.style.transition = 'background 0.5s';
            setTimeout(() => { score.style.background = ''; }, 1500);
        }
        hookGuardarScoreScoring();
    }, 500);
}

// Badge en esquina superior derecha del card de documento
function estadoBadgeDoc(estado) {
    if (estado === 'valido') return `<span class='badge' style='background:#4caf50;color:white;position:absolute;top:8px;right:12px;z-index:2;'>VALIDADO</span>`;
    if (estado === 'rechazado') return `<span class='badge' style='background:#e53935;color:white;position:absolute;top:8px;right:12px;z-index:2;'>RECHAZADO</span>`;
    return `<span class='badge' style='background:#ffc107;color:black;position:absolute;top:8px;right:12px;z-index:2;'>PENDIENTE</span>`;
}

window.validarDocumentoIndividual = async function(documentoId, nuevoEstado, solicitudId) {
    let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
    // Deshabilitar botones mientras se procesa
    const btns = document.querySelectorAll(`button[onclick*='validarDocumentoIndividual(${documentoId},']`);
    btns.forEach(btn => btn.disabled = true);
    // Obtener tipo de documento para el mensaje
    let tipoDoc = '';
    try {
        const solicitud = window.solicitudesPendientes.find(s => s.id == solicitudId);
        if (solicitud && Array.isArray(solicitud.documentos)) {
            const doc = solicitud.documentos.find(d => d.id == documentoId);
            if (doc) tipoDoc = doc.document_type;
        }
    } catch (e) {}
    // Solo valores válidos para status
    let statusValido = nuevoEstado;
    if (nuevoEstado === 'rechazado') statusValido = 'en_revision'; // Ahora sí, 'en_revision' para revisión manual
    if (!['pendiente', 'en_revision', 'valido'].includes(statusValido)) {
        showNotification('Estado de documento no válido para el backend', 'error');
        btns.forEach(btn => btn.disabled = false);
        return;
    }
    try {
        const resp = await fetch(`/api/applications/${solicitudId}/documents/${documentoId}/`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${user.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: statusValido })
        });
        if (!resp.ok) {
            let msg = `Error al actualizar el documento (ID: ${documentoId}${tipoDoc ? ', tipo: ' + tipoDoc : ''})`;
            try {
                const data = await resp.json();
                if (data && data.detail) msg += ': ' + data.detail;
                if (data && data.error) msg += ': ' + data.error;
            } catch (e) {}
            showNotification(msg, 'error');
            // Refresca la lista aunque haya error
            mostrarValidacionSolicitud(solicitudId);
            btns.forEach(btn => btn.disabled = false);
            return;
        }
        // Notificación visual
        if (statusValido === 'valido') {
            showNotification(`Documento (ID: ${documentoId}${tipoDoc ? ', tipo: ' + tipoDoc : ''}) validado correctamente.`, 'success');
        } else if (statusValido === 'en_revision') {
            showNotification(`Documento (ID: ${documentoId}${tipoDoc ? ', tipo: ' + tipoDoc : ''}) enviado a revisión manual. La solicitud sigue en proceso.`, 'warning');
        } else {
            showNotification(`Documento (ID: ${documentoId}${tipoDoc ? ', tipo: ' + tipoDoc : ''}) marcado como pendiente.`, 'info');
        }
        // Refrescar la lista de documentos
        mostrarValidacionSolicitud(solicitudId);
    } catch (e) {
        showNotification(`Error al actualizar el documento (ID: ${documentoId}${tipoDoc ? ', tipo: ' + tipoDoc : ''})`, 'error');
        mostrarValidacionSolicitud(solicitudId);
    } finally {
        btns.forEach(btn => btn.disabled = false);
    }
};

document.addEventListener('click', async function(e) {
    if (e.target && e.target.id === 'btnGuardarPuntajes') {
        const historial = parseInt(document.getElementById('inputHistorial').value) || 0;
        const ingresos = parseInt(document.getElementById('inputIngresos').value) || 0;
        const activos = parseInt(document.getElementById('inputActivos').value) || 0;
        const comportamiento = parseInt(document.getElementById('inputComportamiento').value) || 0;
        const solicitud = window.solicitudSeleccionadaScoring;
        if (!solicitud) return;
        let user = window.currentUser || JSON.parse(localStorage.getItem('currentUser') || '{}');
        try {
            const resp = await fetch(`/api/applications/${solicitud.id}/`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${user.access_token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    historial_crediticio: historial,
                    ingresos: ingresos,
                    activos: activos,
                    comportamiento: comportamiento
                })
            });
            if (!resp.ok) {
                let msg = 'Error al actualizar los puntajes';
                try {
                    const data = await resp.json();
                    if (data && data.detail) msg += ': ' + data.detail;
                    if (data && data.error) msg += ': ' + data.error;
                    if (typeof data === 'object') msg += ' ' + JSON.stringify(data);
                    console.error('Respuesta backend:', data);
                } catch (err) {
                    msg += ' (no se pudo leer el detalle del error)';
                }
                showNotification(msg, 'error');
                return;
            }
            showNotification('Puntajes actualizados correctamente', 'success');
            // Actualiza los spans y recalcula el score
            calcularScoreRealTime();
        } catch (e) {
            showNotification('Error inesperado al actualizar los puntajes', 'error');
            console.error('Error JS:', e);
        }
    }
}); 

function calcularScoreRealTime() {
    // Obtener puntajes base desde los inputs si existen, si no desde los spans
    const historialPts = document.getElementById('inputHistorial') ? parseInt(document.getElementById('inputHistorial').value) || 0 : parseInt(document.getElementById('puntajeHistorial').textContent) || 0;
    const ingresosPts = document.getElementById('inputIngresos') ? parseInt(document.getElementById('inputIngresos').value) || 0 : parseInt(document.getElementById('puntajeIngresos').textContent) || 0;
    const activosPts = document.getElementById('inputActivos') ? parseInt(document.getElementById('inputActivos').value) || 0 : parseInt(document.getElementById('puntajeActivos').textContent) || 0;
    const comportamientoPts = document.getElementById('inputComportamiento') ? parseInt(document.getElementById('inputComportamiento').value) || 0 : parseInt(document.getElementById('puntajeComportamiento').textContent) || 0;
    // Obtener pesos
    const pesoHist = document.getElementById('pesoHistorial').value / 100;
    const pesoIng = document.getElementById('pesoIngresos').value / 100;
    const pesoAct = document.getElementById('pesoActivos').value / 100;
    const pesoComp = document.getElementById('pesoComportamiento').value / 100;
    // Calcular score final
    const scoreFinal = Math.round(
        (historialPts * pesoHist) +
        (ingresosPts * pesoIng) +
        (activosPts * pesoAct) +
        (comportamientoPts * pesoComp)
    );
    // Actualizar interfaz
    document.getElementById('scoreCalculado').textContent = scoreFinal;
    document.getElementById('barraScore').style.width = scoreFinal + '%';
    // Actualizar clasificación
    let clasificacion = '';
    if (scoreFinal >= 80) clasificacion = 'Excelente';
    else if (scoreFinal >= 70) clasificacion = 'Bueno';
    else if (scoreFinal >= 60) clasificacion = 'Regular';
    else clasificacion = 'Deficiente';
    document.getElementById('clasificacionScore').textContent = clasificacion;
} 