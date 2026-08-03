import React, { useState } from 'react';
import axios from 'axios';

const API_BASE_URL = `http://${window.location.hostname}:5000/api`;

export default function ClientesTab({ clientes, onClienteCreated, onRefresh }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    nombre: '',
    telefono: '',
    dniCuit: '',
    honorario: '',
    tipoTrabajo: 'honorarios',
    interesMensualActivo: false,
    interesMensualPorcentaje: ''
  });
  const [message, setMessage] = useState('');
  const [showHistorial, setShowHistorial] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(false);
  const [showProgramadorHonorario, setShowProgramadorHonorario] = useState(null);
  const [programadorData, setProgramadorData] = useState({
    periodoMesInput: '',
    honorario: '',
    cargarDeudaAnterior: false
  });
  const [programandoHonorario, setProgramandoHonorario] = useState(false);
  const [cerrandoProgramadorHonorario, setCerrandoProgramadorHonorario] = useState(false);
  const [vistaClientes, setVistaClientes] = useState('mensuales');

  React.useEffect(() => {
    const tableWrapper = document.querySelector('.table-wrapper-scrollable');
    if (!tableWrapper) return;

    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;

    const handleMouseDown = (e) => {
      isDown = true;
      startX = e.pageX - tableWrapper.offsetLeft;
      startScrollLeft = tableWrapper.scrollLeft;
      tableWrapper.style.cursor = 'grabbing';
      tableWrapper.style.userSelect = 'none';
    };

    const handleMouseLeave = () => {
      isDown = false;
      tableWrapper.style.cursor = 'grab';
    };

    const handleMouseUp = () => {
      isDown = false;
      tableWrapper.style.cursor = 'grab';
    };

    const handleMouseMove = (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - tableWrapper.offsetLeft;
      const walk = (x - startX) * 1.5;
      tableWrapper.scrollLeft = startScrollLeft - walk;
    };

    tableWrapper.addEventListener('mousedown', handleMouseDown);
    tableWrapper.addEventListener('mouseleave', handleMouseLeave);
    tableWrapper.addEventListener('mouseup', handleMouseUp);
    tableWrapper.addEventListener('mousemove', handleMouseMove);
    tableWrapper.style.cursor = 'grab';

    return () => {
      tableWrapper.removeEventListener('mousedown', handleMouseDown);
      tableWrapper.removeEventListener('mouseleave', handleMouseLeave);
      tableWrapper.removeEventListener('mouseup', handleMouseUp);
      tableWrapper.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const getCurrentMonthInput = () => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    return `${yyyy}-${mm}`;
  };

  const monthInputToPeriodoMes = (monthInputValue) => {
    const value = (monthInputValue || '').toString().trim();
    const match = value.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return null;
    }
    return `${match[2]}-${match[1]}`;
  };

  const isPeriodoMesPasado = (periodoMes) => {
    const match = (periodoMes || '').toString().match(/^(\d{2})-(\d{4})$/);
    if (!match) {
      return false;
    }

    const mes = parseInt(match[1], 10);
    const anio = parseInt(match[2], 10);
    if (!Number.isInteger(mes) || !Number.isInteger(anio)) {
      return false;
    }

    const periodoDate = new Date(anio, mes - 1, 1);
    const now = new Date();
    const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return periodoDate < currentMonthDate;
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await axios.put(`${API_BASE_URL}/clientes/${editingId}`, formData);
        setMessage('✓ Cliente actualizado exitosamente');
      } else {
        await axios.post(`${API_BASE_URL}/clientes`, formData);
        setMessage('✓ Cliente creado exitosamente');
      }
      setFormData({
        nombre: '',
        telefono: '',
        dniCuit: '',
        honorario: '',
        tipoTrabajo: 'honorarios',
        interesMensualActivo: false,
        interesMensualPorcentaje: ''
      });
      setShowForm(false);
      setEditingId(null);
      onClienteCreated();
    } catch (error) {
      setMessage('✗ Error: ' + error.response?.data?.error || error.message);
    }
  };

  const handleEdit = (cliente) => {
    setFormData({
      nombre: cliente.nombre,
      telefono: cliente.telefono,
      dniCuit: cliente.dniCuit || '',
      honorario: cliente.honorario,
      tipoTrabajo: cliente.tipoTrabajo || 'honorarios',
      interesMensualActivo: Boolean(cliente.interesMensualActivo),
      interesMensualPorcentaje: cliente.interesMensualPorcentaje || ''
    });
    setEditingId(cliente.id);
    setShowForm(true);
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({
      nombre: '',
      telefono: '',
      dniCuit: '',
      honorario: '',
      tipoTrabajo: 'honorarios',
      interesMensualActivo: false,
      interesMensualPorcentaje: ''
    });
  };

  const handleHonorarioChange = async (clienteId, nuevoHonorario) => {
    try {
      await axios.put(`${API_BASE_URL}/clientes/${clienteId}/honorario`, {
        honorario: parseFloat(nuevoHonorario)
      });
      setMessage('✓ Honorario actualizado');
      onRefresh();
    } catch (error) {
      setMessage('✗ Error: ' + error.response?.data?.error || error.message);
    }
  };

  const openProgramadorHonorario = (cliente) => {
    setCerrandoProgramadorHonorario(false);
    setShowProgramadorHonorario(cliente);
    setProgramadorData({
      periodoMesInput: getCurrentMonthInput(),
      honorario: String(cliente?.honorario || 0),
      cargarDeudaAnterior: false
    });
  };

  const closeProgramadorHonorario = () => {
    if (programandoHonorario) {
      return;
    }

    setCerrandoProgramadorHonorario(true);
    setTimeout(() => {
      setShowProgramadorHonorario(null);
      setProgramadorData({
        periodoMesInput: '',
        honorario: '',
        cargarDeudaAnterior: false
      });
      setProgramandoHonorario(false);
      setCerrandoProgramadorHonorario(false);
    }, 220);
  };

  const handleProgramadorChange = (e) => {
    const { name, value, type, checked } = e.target;
    setProgramadorData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleProgramarHonorarioSubmit = async (e) => {
    e.preventDefault();
    if (!showProgramadorHonorario) {
      return;
    }

    const periodoMes = monthInputToPeriodoMes(programadorData.periodoMesInput);
    if (!periodoMes) {
      setMessage('✗ Período inválido. Seleccione un mes válido.');
      return;
    }

    const honorario = parseFloat(programadorData.honorario);
    if (!Number.isFinite(honorario) || honorario < 0) {
      setMessage(
        programadorData.cargarDeudaAnterior
          ? '✗ Monto de deuda inválido. Debe ser un número mayor o igual a 0'
          : '✗ Honorario inválido. Debe ser un número mayor o igual a 0'
      );
      return;
    }

    try {
      setProgramandoHonorario(true);
      const periodoPasado = isPeriodoMesPasado(periodoMes);
      const cargarComoDeudaAnterior = programadorData.cargarDeudaAnterior;

      const endpoint = cargarComoDeudaAnterior
        ? `${API_BASE_URL}/clientes/${showProgramadorHonorario.id}/deuda-anterior`
        : `${API_BASE_URL}/clientes/${showProgramadorHonorario.id}/honorario-programado`;
      const payload = cargarComoDeudaAnterior
        ? { periodoMes, deuda: honorario }
        : { periodoMes, honorario };

      await axios.put(endpoint, payload);

      if (cargarComoDeudaAnterior) {
        setMessage(`✓ Deuda anterior de ${showProgramadorHonorario.nombre} cargada para ${periodoMes}`);
      } else if (periodoPasado) {
        setMessage(`✓ Monto histórico de ${showProgramadorHonorario.nombre} actualizado para ${periodoMes}`);
      } else {
        setMessage(`✓ Honorario de ${showProgramadorHonorario.nombre} programado para ${periodoMes}`);
      }
      setProgramandoHonorario(false);
      closeProgramadorHonorario();
      onRefresh();
    } catch (error) {
      setMessage('✗ Error: ' + (error.response?.data?.error || error.message));
      setProgramandoHonorario(false);
    }
  };

  const calcularDiasRestantes = (proximaFacturacion) => {
    if (!proximaFacturacion) return null;

    const fechaProxima = new Date(proximaFacturacion);
    const hoy = new Date();
    const msPorDia = 1000 * 60 * 60 * 24;

    fechaProxima.setHours(0, 0, 0, 0);
    hoy.setHours(0, 0, 0, 0);

    const diferencia = fechaProxima - hoy;
    if (diferencia >= 0) {
      return Math.ceil(diferencia / msPorDia);
    }

    const diasDesdeVencimiento = Math.floor((hoy - fechaProxima) / msPorDia);
    const diasCiclo = 30 - (diasDesdeVencimiento % 30);
    return diasCiclo === 0 ? 30 : diasCiclo;
  };

  const obtenerColorDias = (dias) => {
    if (dias === null) return 'var(--color-neutral)';
    if (dias <= 5) return 'var(--color-primary)';
    if (dias <= 15) return 'var(--color-accent)';
    return 'var(--color-accent)';
  };

  const obtenerEstadoDias = (dias) => {
    if (dias === null) return '-';
    if (dias <= 1) return dias === 1 ? '🔴 Mañana' : '30 días';
    return `${dias} días`;
  };

  const handleVerHistorial = async (clienteId, nombreCliente) => {
    setLoadingHistorial(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/historial/cliente/${clienteId}`);
      
      // Eliminar duplicados por mes (por si acaso)
      const mesesByKey = {};
      for (const entry of response.data) {
        mesesByKey[entry.mes] = entry;
      }
      const historialSinDuplicados = Object.values(mesesByKey);
      
      setHistorial(historialSinDuplicados);
      setShowHistorial({ clienteId, nombreCliente });
      setMessage('');
    } catch (error) {
      setMessage('✗ Error cargando historial: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoadingHistorial(false);
    }
  };

  const formatearMesLegible = (mesYYYY) => {
    // Convierte "01-2026" a "Enero 2026"
    if (!mesYYYY || !mesYYYY.includes('-')) return mesYYYY;
    
    const [mes, año] = mesYYYY.split('-');
    const meses = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    
    const nombreMes = meses[parseInt(mes) - 1] || mes;
    return `${nombreMes} ${año}`;
  };

  const handleDelete = async (cliente) => {
    const confirmacion = window.confirm(
      `⚠️ ¿Está seguro de que desea eliminar a ${cliente.nombre}?\n\nEsta acción eliminará:\n- El cliente\n- Todos sus pagos registrados\n- Todo su historial\n\n¡Esta acción NO se puede deshacer!`
    );

    if (!confirmacion) return;

    try {
      await axios.delete(`${API_BASE_URL}/clientes/${cliente.id}`);
      setMessage(`✓ Cliente ${cliente.nombre} eliminado completamente`);
      onClienteCreated(); // Refrescar la lista
    } catch (error) {
      setMessage('✗ Error eliminando cliente: ' + (error.response?.data?.error || error.message));
    }
  };

  const interesDisponible = formData.tipoTrabajo === 'honorarios';
  const interesActivo = interesDisponible && Boolean(formData.interesMensualActivo);
  const ordenarClientesPorNombre = (listaClientes) =>
    [...listaClientes].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
  const clientesMensuales = ordenarClientesPorNombre(clientes.filter((c) => c.tipoTrabajo !== 'particular'));
  const clientesParticulares = ordenarClientesPorNombre(clientes.filter((c) => c.tipoTrabajo === 'particular'));
  const esVistaMensuales = vistaClientes === 'mensuales';
  const clientesVistaActiva = esVistaMensuales ? clientesMensuales : clientesParticulares;

  const renderTablaClientes = (lista, titulo, emptyText) => (
    <div style={{ marginBottom: '26px' }}>
      <h3 style={{ marginBottom: '10px' }}>{titulo}</h3>
      {lista.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '20px', color: 'var(--color-neutral)' }}>{emptyText}</p>
      ) : (
        <div style={styles.tableWrapper} className="table-wrapper-scrollable">
          <table style={styles.clientesTable}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Tipo de Trabajo</th>
                <th>Honorario Mensual</th>
                <th>Interés Mensual</th>
                <th>Saldo</th>
                <th>Días para Recargo</th>
                <th style={styles.accionesHeader}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(cliente => {
                const diasRestantes = calcularDiasRestantes(cliente.proximaFacturacion);
                return (
                  <tr key={cliente.id}>
                    <td><strong>{cliente.nombre}</strong></td>
                    <td>{cliente.telefono || '-'}</td>
                    <td>{cliente.tipoTrabajo === 'particular' ? 'Particular (único)' : 'Honorarios (mensual)'}</td>
                    <td>
                      <input
                        type="number"
                        value={cliente.honorario || ''}
                        onChange={(e) => handleHonorarioChange(cliente.id, e.target.value)}
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        style={{ width: '100px', padding: '5px' }}
                        onBlur={() => onRefresh()}
                      />
                    </td>
                    <td>
                      {cliente.tipoTrabajo === 'honorarios' && cliente.interesMensualActivo
                        ? `${parseFloat(cliente.interesMensualPorcentaje || 0).toFixed(2)}%`
                        : '-'}
                    </td>
                    <td style={{ color: cliente.totalAdeudado > 0 ? 'var(--color-dark)' : 'var(--color-accent)' }}>
                      ${cliente.totalAdeudado?.toFixed(2) || '0.00'}
                    </td>
                    <td style={{
                      fontWeight: 'bold',
                      textAlign: 'center',
                      color: obtenerColorDias(diasRestantes),
                      backgroundColor: diasRestantes !== null && diasRestantes <= 5 ? 'rgba(29, 62, 138, 0.1)' : 'transparent',
                      padding: '8px',
                      borderRadius: '4px'
                    }}>
                      {obtenerEstadoDias(diasRestantes)}
                    </td>
                    <td>
                      <div style={styles.accionesCell}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleEdit(cliente)}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn-info btn-sm"
                          onClick={() => handleVerHistorial(cliente.id, cliente.nombre)}
                        >
                          Historial
                        </button>
                        {cliente.tipoTrabajo === 'honorarios' && (
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => openProgramadorHonorario(cliente)}
                          >
                            Programar mes
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDelete(cliente)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2>👥 Gestión de Clientes</h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? '✕ Cancelar' : '+ Nuevo Cliente'}
        </button>
      </div>

      {message && (
        <div className={message.includes('✓') ? 'alert alert-success' : 'alert alert-error'}>
          {message}
        </div>
      )}

      {showForm && (
        <div style={styles.formContainer}>
          <h3>{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
          {!editingId && (
            <p style={styles.requiredHint}>* Campos obligatorios: Nombre, DNI/CUIT y Honorario</p>
          )}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Nombre *</label>
              <input
                type="text"
                name="nombre"
                value={formData.nombre}
                onChange={handleInputChange}
                required={!editingId}
                placeholder="Ingrese el nombre del cliente"
              />
            </div>

            <div className="form-group">
              <label>Teléfono</label>
              <input
                type="tel"
                name="telefono"
                value={formData.telefono}
                onChange={handleInputChange}
                placeholder="(2625) 123456"
              />
            </div>

            <div className="form-group">
              <label>DNI/CUIT {!editingId ? '*' : ''}</label>
              <input
                type="text"
                name="dniCuit"
                value={formData.dniCuit}
                onChange={handleInputChange}
                required={!editingId}
                placeholder="Ej: 20304567891"
              />
            </div>

            <div className="form-group">
              <label>Honorario Mensual ($) {!editingId ? '*' : ''}</label>
              <input
                type="number"
                name="honorario"
                value={formData.honorario}
                onChange={handleInputChange}
                step="0.01"
                min="0"
                inputMode="decimal"
                required={!editingId}
                placeholder="0"
              />
            </div>

            <div className="form-group">
              <label>Tipo de Trabajo</label>
              <select
                name="tipoTrabajo"
                value={formData.tipoTrabajo}
                onChange={handleInputChange}
              >
                <option value="honorarios">Honorarios Estudio Capella (mensual)</option>
                <option value="particular">Trabajo Particular Estudio Capella (único)</option>
              </select>
            </div>

            <div style={styles.interesCard(interesDisponible)}>
              <div style={styles.interesCardHeader}>
                <div>
                  <p style={styles.interesTitle}>Interés Mensual (Opcional)</p>
                  <p style={styles.interesSubtitle}>
                    {interesDisponible
                      ? 'Se aplicará cuando venza cada recargo de 30 días.'
                      : 'Disponible solo para clientes de Honorarios mensuales.'}
                  </p>
                </div>

                <label style={styles.switchLabel(interesDisponible)}>
                  <input
                    type="checkbox"
                    name="interesMensualActivo"
                    checked={interesActivo}
                    onChange={handleInputChange}
                    disabled={!interesDisponible}
                    style={{ display: 'none' }}
                  />
                  <span style={styles.switchTrack(interesActivo)}>
                    <span style={styles.switchThumb(interesActivo)} />
                  </span>
                  <span style={styles.switchText(interesActivo)}>{interesActivo ? 'Activado' : 'Desactivado'}</span>
                </label>
              </div>

              {interesActivo && (
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label>Porcentaje de Interés Mensual (%)</label>
                  <input
                    type="number"
                    name="interesMensualPorcentaje"
                    value={formData.interesMensualPorcentaje}
                    onChange={handleInputChange}
                    step="0.01"
                    min="0"
                    placeholder="Ej: 5"
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-success">
                {editingId ? '✓ Actualizar' : '✓ Crear'}
              </button>
              <button 
                type="button" 
                className="btn btn-secondary"
                onClick={handleCancel}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {clientes.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '20px', color: 'var(--color-neutral)' }}>No hay clientes registrados</p>
      ) : (
        <div style={styles.subPantallasWrapper}>
          <div style={styles.subPantallasHeader}>
            <p style={styles.subPantallasEyebrow}>Vista de Clientes</p>
            <div style={styles.subPantallasTabs}>
              <button
                type="button"
                onClick={() => setVistaClientes('mensuales')}
                style={styles.subPantallaTabBtn(esVistaMensuales)}
              >
                <span style={styles.subPantallaTabTitle}>Mensuales</span>
                <span style={styles.subPantallaTabCount(esVistaMensuales)}>{clientesMensuales.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setVistaClientes('particulares')}
                style={styles.subPantallaTabBtn(!esVistaMensuales)}
              >
                <span style={styles.subPantallaTabTitle}>Particulares</span>
                <span style={styles.subPantallaTabCount(!esVistaMensuales)}>{clientesParticulares.length}</span>
              </button>
            </div>

            <div style={styles.subPantallasStats}>
              <span style={styles.subPantallaInfoPill}>
                Mostrando: <strong>{esVistaMensuales ? 'Mensuales' : 'Particulares'}</strong>
              </span>
              <span style={styles.subPantallaInfoPill}>
                Total en vista: <strong>{clientesVistaActiva.length}</strong>
              </span>
            </div>
          </div>

          <div key={vistaClientes} style={styles.subPantallaBody}>
            {renderTablaClientes(
              clientesVistaActiva,
              esVistaMensuales ? 'Clientes Mensuales' : 'Clientes Particulares',
              esVistaMensuales ? 'No hay clientes mensuales registrados' : 'No hay clientes particulares registrados'
            )}
          </div>
        </div>
      )}

      <div style={styles.infoBox}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <span style={{ fontSize: '20px' }}>ℹ️</span>
          <div>
            <strong>Información importante sobre los Honorarios:</strong>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>El campo <strong>Honorario Mensual</strong> modifica el honorario del período actual</li>
              <li>Con <strong>Programar mes</strong> puedes anticipar cambios para cualquier mes futuro (MM-YYYY)</li>
              <li>En <strong>Programar mes</strong> también puedes activar <strong>Cargar deuda anterior</strong> para meses históricos</li>
              <li>Los clientes de <strong>Trabajo Particular</strong> permanecen en sistema para conservar historial</li>
              <li>Si activas <strong>Interés mensual</strong>, se aplica al honorario cuando vence cada recargo (cada 30 días)</li>
              <li>Los clientes de <strong>Trabajo Particular</strong> no generan recargo mensual</li>
            </ul>
          </div>
        </div>
      </div>

      {showHistorial && (
        <div style={styles.modalOverlay} onClick={() => setShowHistorial(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3>📋 Historial de {showHistorial.nombreCliente}</h3>
              <button 
                className="btn btn-secondary"
                onClick={() => setShowHistorial(null)}
              >
                ✕ Cerrar
              </button>
            </div>

            {loadingHistorial ? (
              <p>Cargando historial...</p>
            ) : historial.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--color-accent)', fontWeight: 'bold' }}>
                ✓ Este cliente no tiene historial
              </p>
            ) : (
              <table style={{ width: '100%', marginTop: '15px' }}>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th>Deuda Original</th>
                    <th>Pagado</th>
                    <th>Pendiente</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.sort((a, b) => {
                    // Ordenar por año y mes (más recientes primero)
                    const [mesA, añoA] = (a.mes || '').split('-');
                    const [mesB, añoB] = (b.mes || '').split('-');
                    if (añoB !== añoA) return parseInt(añoB) - parseInt(añoA);
                    return parseInt(mesB) - parseInt(mesA);
                  }).map((entry, idx) => (
                    <tr 
                      key={idx}
                      style={{
                        backgroundColor: entry.estado === 'pagado' ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.08)',
                        opacity: entry.estado === 'pagado' ? 0.7 : 1,
                        borderLeft: `4px solid ${entry.estado === 'pagado' ? '#28a745' : '#dc3545'}`
                      }}
                    >
                      <td><strong>{formatearMesLegible(entry.mes)}</strong></td>
                      <td style={{ textAlign: 'right' }}>${parseFloat(entry.deuda || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: entry.estado === 'pagado' ? '#28a745' : '#dc3545' }}>
                        ${parseFloat(entry.montoPagado || 0).toFixed(2)}
                      </td>
                      <td style={{ 
                        textAlign: 'right', 
                        fontWeight: 'bold', 
                        color: entry.deudaPendiente > 0 ? 'var(--color-primary)' : 'var(--color-accent)'
                      }}>
                        ${parseFloat(entry.deudaPendiente || 0).toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          fontWeight: 'bold',
                          backgroundColor: entry.estado === 'pagado' ? 'rgba(40, 167, 69, 0.14)' : 'rgba(220, 53, 69, 0.14)',
                          color: entry.estado === 'pagado' ? '#155724' : '#721c24'
                        }}>
                          {entry.estado === 'pagado' ? '✓ PAGADO' : '✕ ADEUDADO'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid rgba(165, 166, 146, 0.5)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                <p style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--color-accent)', fontSize: '14px' }}>
                  Total Pagado: ${historial.reduce((sum, h) => sum + (parseFloat(h.montoPagado) || 0), 0).toFixed(2)}
                </p>
                <p style={{ textAlign: 'center', fontWeight: 'bold', color: 'var(--color-primary)', fontSize: '14px' }}>
                  Total Adeudado: ${historial.reduce((sum, h) => sum + (parseFloat(h.deudaPendiente) || 0), 0).toFixed(2)}
                </p>
              </div>
              <p style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '16px', color: 'var(--color-dark)', marginTop: '10px' }}>
                Deuda Total: ${historial.reduce((sum, h) => sum + (parseFloat(h.deuda) || 0), 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      {showProgramadorHonorario && (
        <div
          style={styles.animatedModalOverlay(cerrandoProgramadorHonorario)}
          onClick={closeProgramadorHonorario}
        >
          <div
            style={styles.animatedModalContent(cerrandoProgramadorHonorario)}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <h3>🗓 Programar Honorario</h3>
              <button
                className="btn btn-secondary"
                onClick={closeProgramadorHonorario}
                disabled={programandoHonorario}
              >
                ✕ Cerrar
              </button>
            </div>

            <div style={styles.programadorSummaryCard}>
              <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--color-dark)' }}>{showProgramadorHonorario.nombre}</p>
              <p style={{ margin: '6px 0 0 0', color: 'var(--color-neutral)' }}>
                Honorario actual: <strong>${parseFloat(showProgramadorHonorario.honorario || 0).toFixed(2)}</strong>
              </p>
            </div>

            <form onSubmit={handleProgramarHonorarioSubmit}>
              <div style={styles.programadorOptionCard(programadorData.cargarDeudaAnterior)}>
                <label style={styles.switchLabel(true)}>
                  <input
                    type="checkbox"
                    name="cargarDeudaAnterior"
                    checked={programadorData.cargarDeudaAnterior}
                    onChange={handleProgramadorChange}
                    disabled={programandoHonorario}
                    style={{ display: 'none' }}
                  />
                  <span style={styles.switchTrack(programadorData.cargarDeudaAnterior)}>
                    <span style={styles.switchThumb(programadorData.cargarDeudaAnterior)} />
                  </span>
                  <span style={styles.switchText(programadorData.cargarDeudaAnterior)}>
                    Cargar deuda anterior
                  </span>
                </label>
                <small style={styles.programadorHintText}>
                  Úsalo solo para registrar saldos históricos en meses pasados.
                </small>
              </div>

              <div className="form-group">
                <label>Período objetivo *</label>
                <input
                  type="month"
                  name="periodoMesInput"
                  value={programadorData.periodoMesInput}
                  onChange={handleProgramadorChange}
                  required
                />
                <small style={styles.programadorHintText}>
                  {programadorData.cargarDeudaAnterior
                    ? 'Puedes elegir meses anteriores para cargar deuda histórica (MM-YYYY).'
                    : 'Si eliges un mes pasado, se guardará automáticamente como deuda histórica (MM-YYYY).'}
                </small>
              </div>

              <div className="form-group">
                <label>
                  {programadorData.cargarDeudaAnterior
                    ? 'Monto adeudado para ese período *'
                    : 'Nuevo honorario para ese período *'}
                </label>
                <input
                  type="number"
                  name="honorario"
                  value={programadorData.honorario}
                  onChange={handleProgramadorChange}
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  required
                />
              </div>

              <div style={styles.programadorActions}>
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={programandoHonorario}
                >
                  {programandoHonorario
                    ? '⏳ Guardando...'
                    : programadorData.cargarDeudaAnterior
                      ? '✓ Guardar Deuda'
                      : '✓ Guardar Programación'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeProgramadorHonorario}
                  disabled={programandoHonorario}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  formContainer: {
    background: 'rgba(165, 166, 146, 0.12)',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '20px',
    border: '1px solid rgba(165, 166, 146, 0.45)',
  },
  requiredHint: {
    margin: '0 0 14px 0',
    color: 'var(--color-primary)',
    fontSize: '13px',
    fontWeight: 600,
    background: 'rgba(63, 181, 233, 0.12)',
    border: '1px solid rgba(63, 181, 233, 0.5)',
    borderRadius: '8px',
    padding: '10px 12px'
  },
  infoBox: {
    background: 'rgba(63, 181, 233, 0.14)',
    border: '1px solid rgba(63, 181, 233, 0.5)',
    borderRadius: '8px',
    padding: '15px',
    marginTop: '25px',
    color: 'var(--color-primary)',
  },
  subPantallasWrapper: {
    border: '1px solid rgba(63, 181, 233, 0.35)',
    borderRadius: '14px',
    overflow: 'hidden',
    marginBottom: '14px',
    background: 'linear-gradient(180deg, rgba(63, 181, 233, 0.08) 0%, rgba(255,255,255,0.94) 42%)',
    boxShadow: '0 6px 16px rgba(29, 62, 138, 0.12)'
  },
  subPantallasHeader: {
    padding: '14px 14px 10px 14px',
    borderBottom: '1px solid rgba(63, 181, 233, 0.25)'
  },
  subPantallasEyebrow: {
    margin: '0 0 10px 2px',
    fontSize: '12px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-primary)',
    fontWeight: 700
  },
  subPantallasTabs: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    flexWrap: 'wrap'
  },
  subPantallaTabBtn: (active) => ({
    border: active ? '1px solid rgba(29, 62, 138, 0.55)' : '1px solid rgba(165, 166, 146, 0.55)',
    background: active ? 'linear-gradient(135deg, rgba(29, 62, 138, 0.92), rgba(63, 181, 233, 0.85))' : 'rgba(255,255,255,0.85)',
    color: active ? 'var(--color-white)' : 'var(--color-dark)',
    borderRadius: '10px',
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: active ? '0 6px 14px rgba(29, 62, 138, 0.25)' : 'none'
  }),
  subPantallaTabTitle: {
    fontWeight: 700,
    fontSize: '14px'
  },
  subPantallaTabCount: (active) => ({
    minWidth: '28px',
    height: '28px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? 'rgba(255,255,255,0.24)' : 'rgba(29, 62, 138, 0.12)',
    color: active ? 'var(--color-white)' : 'var(--color-primary)',
    fontWeight: 700,
    fontSize: '13px'
  }),
  subPantallasStats: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '10px'
  },
  subPantallaInfoPill: {
    background: 'rgba(255,255,255,0.78)',
    border: '1px solid rgba(165, 166, 146, 0.45)',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '12px',
    color: 'var(--color-dark)'
  },
  subPantallaBody: {
    padding: '6px 12px 12px 12px',
    animation: 'tabFadeSlide 260ms ease'
  },
  programadorSummaryCard: {
    background: 'linear-gradient(135deg, rgba(63, 181, 233, 0.16), rgba(29, 62, 138, 0.08))',
    border: '1px solid rgba(63, 181, 233, 0.45)',
    borderRadius: '10px',
    padding: '12px 14px',
    marginBottom: '16px'
  },
  programadorHintText: {
    display: 'block',
    marginTop: '6px',
    color: 'var(--color-neutral)',
    fontSize: '12px'
  },
  programadorActions: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap'
  },
  programadorOptionCard: (active) => ({
    background: active ? 'rgba(29, 62, 138, 0.08)' : 'rgba(165, 166, 146, 0.08)',
    border: active ? '1px solid rgba(29, 62, 138, 0.35)' : '1px solid rgba(165, 166, 146, 0.4)',
    borderRadius: '10px',
    padding: '10px 12px',
    marginBottom: '14px'
  }),
  interesCard: (enabled) => ({
    background: enabled ? 'rgba(63, 181, 233, 0.08)' : 'rgba(165, 166, 146, 0.12)',
    border: enabled ? '1px solid rgba(63, 181, 233, 0.4)' : '1px solid rgba(165, 166, 146, 0.45)',
    borderRadius: '10px',
    padding: '14px',
    marginBottom: '16px'
  }),
  interesCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap'
  },
  interesTitle: {
    margin: 0,
    fontWeight: 'bold',
    color: 'var(--color-dark)'
  },
  interesSubtitle: {
    margin: '4px 0 0 0',
    fontSize: '13px',
    color: 'var(--color-neutral)'
  },
  switchLabel: (enabled) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.65,
    userSelect: 'none'
  }),
  switchTrack: (active) => ({
    width: '44px',
    height: '24px',
    borderRadius: '999px',
    background: active ? 'var(--color-primary)' : 'rgba(165, 166, 146, 0.8)',
    position: 'relative',
    transition: 'all 0.2s ease'
  }),
  switchThumb: (active) => ({
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    background: 'var(--color-white)',
    position: 'absolute',
    top: '3px',
    left: active ? '23px' : '3px',
    transition: 'left 0.2s ease'
  }),
  switchText: (active) => ({
    fontSize: '13px',
    fontWeight: 'bold',
    color: active ? 'var(--color-primary)' : 'var(--color-neutral)'
  }),
  tableWrapper: {
    width: '100%',
    overflowX: 'auto',
    borderRadius: '8px',
    WebkitOverflowScrolling: 'touch'
  },
  clientesTable: {
    minWidth: '1200px',
    width: '100%'
  },
  accionesHeader: {
    minWidth: '70px',
    textAlign: 'center',
    whiteSpace: 'nowrap'
  },
  accionesCell: {
    display: 'flex',
    justifyContent: 'center',
    position: 'relative',
    minWidth: '70px',
    whiteSpace: 'nowrap'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(25, 25, 25, 0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000
  },
  modalContent: {
    background: 'var(--color-white)',
    padding: '25px',
    borderRadius: '8px',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '70vh',
    overflowY: 'auto',
    boxShadow: '0 4px 10px rgba(25, 25, 25, 0.2)'
  },
  animatedModalOverlay: (closing) => ({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(25, 25, 25, 0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1100,
    opacity: closing ? 0 : 1,
    transition: 'opacity 220ms ease'
  }),
  animatedModalContent: (closing) => ({
    background: 'var(--color-white)',
    padding: '25px',
    borderRadius: '8px',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '70vh',
    overflowY: 'auto',
    boxShadow: '0 4px 10px rgba(25, 25, 25, 0.2)',
    transform: closing ? 'translateY(10px) scale(0.98)' : 'translateY(0) scale(1)',
    opacity: closing ? 0 : 1,
    transition: 'transform 220ms ease, opacity 220ms ease'
  })
};
