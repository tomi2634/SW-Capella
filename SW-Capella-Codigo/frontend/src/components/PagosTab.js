import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API_BASE_URL = `http://${window.location.hostname}:5000/api`;

export default function PagosTab({ clientes, onPagoRegistrado }) {
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [clienteSearchTerm, setClienteSearchTerm] = useState('');
  const [monto, setMonto] = useState('');
  const [tipoPago, setTipoPago] = useState('Efectivo');
  const [tipoPagoCombinado, setTipoPagoCombinado] = useState('Efectivo y Transferencia');
  const [cheques, setCheques] = useState([{ numeroCheque: '', nombreBanco: '' }]);
  const [showClienteDropdown, setShowClienteDropdown] = useState(false);
  const [detalles, setDetalles] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [reciboGenerado, setReciboGenerado] = useState(null);
  const [downloadingCopy, setDownloadingCopy] = useState(false);
  const [recibos, setRecibos] = useState([]);
  const [loadingRecibos, setLoadingRecibos] = useState(false);
  const [filtroClienteId, setFiltroClienteId] = useState('');
  const [filtroTipoTrabajo, setFiltroTipoTrabajo] = useState('');
  const [filtroTipoPago, setFiltroTipoPago] = useState('');
  const [filtroNumeroCheque, setFiltroNumeroCheque] = useState('');
  const [filtroNombreBanco, setFiltroNombreBanco] = useState('');
  const [filtroNombreCliente, setFiltroNombreCliente] = useState('');
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const [reciboParaAnular, setReciboParaAnular] = useState(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('Anulado por error de carga');
  const [anulandoRecibo, setAnulandoRecibo] = useState(false);
  const [cerrandoModalAnulacion, setCerrandoModalAnulacion] = useState(false);

  const formatearFecha = (value) => {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString('es-AR');
  };

  const formatearTamano = (size) => {
    if (!Number.isFinite(size)) {
      return '-';
    }
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const normalizeMonto = (value) => {
    return parseFloat(value.toString().replace(/,/g, '.'));
  };

  const fetchRecibos = async () => {
    try {
      setLoadingRecibos(true);
      const params = { limit: 100 };

      if (filtroClienteId) {
        params.clienteId = filtroClienteId;
      }
      if (filtroTipoTrabajo) {
        params.tipoTrabajo = filtroTipoTrabajo;
      }
      if (filtroTipoPago) {
        params.tipoPago = filtroTipoPago;
      }
      if (filtroTipoPago === 'Cheque' && filtroNumeroCheque.trim()) {
        params.numeroCheque = filtroNumeroCheque.trim();
      }
      if (filtroTipoPago === 'Cheque' && filtroNombreBanco.trim()) {
        params.nombreBanco = filtroNombreBanco.trim();
      }
      if (filtroNombreCliente.trim()) {
        params.cliente = filtroNombreCliente.trim();
      }
      if (filtroDesde) {
        params.desde = filtroDesde;
      }
      if (filtroHasta) {
        params.hasta = filtroHasta;
      }

      const response = await axios.get(`${API_BASE_URL}/recibos`, { params });
      setRecibos(response.data?.items || []);
    } catch (error) {
      setMessage('✗ No se pudo cargar el listado de recibos');
    } finally {
      setLoadingRecibos(false);
    }
  };

  useEffect(() => {
    const fetchRecibosIniciales = async () => {
      try {
        setLoadingRecibos(true);
        const response = await axios.get(`${API_BASE_URL}/recibos`, { params: { limit: 100 } });
        setRecibos(response.data?.items || []);
      } catch (error) {
        setMessage('✗ No se pudo cargar el listado de recibos');
      } finally {
        setLoadingRecibos(false);
      }
    };

    fetchRecibosIniciales();
  }, []);

  const descargarRecibo = async (recibo) => {
    if (!recibo?.relativePath) {
      return;
    }

    const path = recibo.relativePath;
    const fileName = recibo.fileName || 'recibo.pdf';

    const pdfRes = await axios.get(
      `${API_BASE_URL}/recibos/descargar`,
      {
        params: { path },
        responseType: 'blob'
      }
    );

    const url = window.URL.createObjectURL(new Blob([pdfRes.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.parentNode.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  const abrirModalAnularRecibo = (recibo) => {
    setCerrandoModalAnulacion(false);
    setReciboParaAnular(recibo);
    setMotivoAnulacion('Anulado por error de carga');
  };

  const cerrarModalAnularRecibo = (force = false) => {
    if (anulandoRecibo) {
      return;
    }

    setCerrandoModalAnulacion(true);
    setTimeout(() => {
      setReciboParaAnular(null);
      setMotivoAnulacion('Anulado por error de carga');
      if (force) {
        setAnulandoRecibo(false);
      }
      setCerrandoModalAnulacion(false);
    }, 220);
  };

  const confirmarAnularRecibo = async () => {
    const recibo = reciboParaAnular;
    if (!recibo?.relativePath) {
      return;
    }

    const motivo = (motivoAnulacion || '').toString().trim();
    if (!motivo) {
      setMessage('✗ Debe ingresar un motivo para anular el recibo');
      return;
    }

    try {
      setAnulandoRecibo(true);
      await axios.post(`${API_BASE_URL}/recibos/anular`, {
        relativePath: recibo.relativePath,
        pagoId: recibo.pagoId || undefined,
        motivo
      });
      setMessage('✓ Recibo anulado correctamente');
      setAnulandoRecibo(false);
      cerrarModalAnularRecibo();
      await fetchRecibos();
      onPagoRegistrado();
    } catch (error) {
      setMessage('✗ No se pudo anular el recibo: ' + (error.response?.data?.error || error.message));
      setAnulandoRecibo(false);
    }
  };

  const abrirCarpetaCliente = async (clienteFolderName, tipoTrabajo) => {
    if (!clienteFolderName) {
      return;
    }

    try {
      await axios.post(`${API_BASE_URL}/recibos/abrir-carpeta`, { clienteFolderName, tipoTrabajo });
      setMessage('✓ Carpeta abierta en la PC servidor');
    } catch (error) {
      setMessage('✗ No se pudo abrir la carpeta del cliente en el servidor');
    }
  };

  const descargarCopiaRecibo = async () => {
    if (!reciboGenerado?.relativePath) {
      return;
    }

    try {
      setDownloadingCopy(true);
      await descargarRecibo(reciboGenerado);
    } catch (error) {
      setMessage('✗ No se pudo descargar la copia del recibo');
    } finally {
      setDownloadingCopy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedClienteId || !monto) {
      setMessage('✗ Debe seleccionar un cliente e ingresar un monto');
      return;
    }

    const efectoCheques = tipoPago === 'Cheque' || (tipoPago === 'Combinacion de pagos' && tipoPagoCombinado.includes('Cheque'));
    const tipoPagoEnviar = tipoPago === 'Combinacion de pagos' ? tipoPagoCombinado : tipoPago;

    if (efectoCheques) {
      const chequesValidos = cheques
        .map((c) => ({ numero: c.numeroCheque.trim(), banco: c.nombreBanco.trim() }))
        .filter((c) => c.numero || c.banco);

      if (chequesValidos.length === 0 || chequesValidos.some((c) => !c.numero || !c.banco)) {
        setMessage('✗ Para pago con cheque debe completar número de cheque y banco en todos los ítems');
        return;
      }
    }

    setLoading(true);
    try {
      setReciboGenerado(null);

      const numeroChequeCadena = efectoCheques
        ? cheques.map((c) => c.numeroCheque.trim()).filter(Boolean).join(', ')
        : '';
      const nombreBancoCadena = efectoCheques
        ? cheques.map((c) => c.nombreBanco.trim()).filter(Boolean).join(', ')
        : '';

      // Registrar pago
      const pagoRes = await axios.post(`${API_BASE_URL}/pagos`, {
        clienteId: selectedClienteId,
        monto: normalizeMonto(monto),
        tipoPago: tipoPagoEnviar,
        numeroCheque: numeroChequeCadena,
        nombreBanco: nombreBancoCadena,
        detalles: detalles.trim()
      });

      // Generar recibo y guardarlo en servidor
      const reciboRes = await axios.post(
        `${API_BASE_URL}/generar-recibo`,
        {
          clienteId: selectedClienteId,
          pagoId: pagoRes.data?.pago?.id,
          monto: parseFloat(monto),
          pagosAnteriores: [],
          pago: pagoRes.data?.pago,
          tipoPago: tipoPagoEnviar,
          numeroCheque: numeroChequeCadena,
          nombreBanco: nombreBancoCadena,
          detalles: detalles.trim()
        }
      );

      setReciboGenerado(reciboRes.data?.recibo || null);
      fetchRecibos();

      setMessage('✓ Pago registrado y recibo guardado en el servidor. Puede descargar una copia local si desea.');
      setMonto('');
      setSelectedClienteId('');
      setTipoPago('Efectivo');
      setTipoPagoCombinado('Efectivo y Transferencia');
      setCheques([{ numeroCheque: '', nombreBanco: '' }]);
      setDetalles('');
      onPagoRegistrado();
    } catch (error) {
      setMessage('✗ Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const clienteSeleccionado = clientes.find(c => c.id === selectedClienteId);
  const clientesFiltrados = clientes.filter((cliente) => {
    const search = clienteSearchTerm.trim().toLowerCase();
    if (!search) {
      return true;
    }

    const nombre = (cliente.nombre || '').toString().toLowerCase();
    const dniCuit = (cliente.dniCuit || '').toString().toLowerCase();
    return nombre.includes(search) || dniCuit.includes(search);
  });

  const handleSeleccionarCliente = (cliente) => {
    setSelectedClienteId(cliente.id);
    setClienteSearchTerm(cliente.nombre || '');
    setShowClienteDropdown(false);
  };

  return (
    <div>
      <h2>💰 Registrar Pago</h2>

      {message && (
        <div className={message.includes('✓') ? 'alert alert-success' : 'alert alert-error'}>
          {message}
        </div>
      )}

      <div style={styles.container}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Cliente * </label>
            <div style={styles.searchInputWrap}>
              <span style={styles.searchIcon}>🔍</span>
              <input
                type="text"
                value={clienteSearchTerm}
                onChange={(e) => {
                  setClienteSearchTerm(e.target.value);
                  setShowClienteDropdown(true);
                }}
                onFocus={() => setShowClienteDropdown(true)}
                onBlur={() => setTimeout(() => setShowClienteDropdown(false), 140)}
                placeholder="Buscar cliente por nombre o DNI/CUIT"
                style={styles.searchInput}
              />

              {showClienteDropdown && (
                <div style={styles.searchResultsDropdown}>
                  {clientesFiltrados.length === 0 ? (
                    <p style={styles.searchNoResults}>No se encontraron clientes para esa búsqueda.</p>
                  ) : (
                    <div style={styles.searchResultsList}>
                      {clientesFiltrados.map((cliente) => {
                        const selected = cliente.id === selectedClienteId;
                        return (
                          <button
                            key={cliente.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => handleSeleccionarCliente(cliente)}
                            style={styles.searchResultItem(selected)}
                          >
                            <span style={styles.searchResultName}>{cliente.nombre}</span>
                            <span style={styles.searchResultMeta}>
                              DNI/CUIT: {cliente.dniCuit || '-'} · Deuda: ${cliente.totalAdeudado?.toFixed(2) || '0.00'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <input type="hidden" value={selectedClienteId} required />

            {selectedClienteId && clienteSeleccionado && (
              <small style={styles.selectedClienteHint}>
                Cliente seleccionado: <strong>{clienteSeleccionado.nombre}</strong>
              </small>
            )}
          </div>

          {clienteSeleccionado && (
            <div style={styles.infoBox}>
              <h4>Información del Cliente</h4>
              <p><strong>Nombre:</strong> {clienteSeleccionado.nombre}</p>
              <p><strong>Honorario Mensual:</strong> ${clienteSeleccionado.honorario || '0'}</p>
              <p><strong>Total Adeudado:</strong> ${clienteSeleccionado.totalAdeudado?.toFixed(2) || '0.00'}</p>
              <p><strong>Meses sin Pagar:</strong> {clienteSeleccionado.mesesAdeudados || 0}</p>
            </div>
          )}

          <div className="form-group">
            <label>Monto Pagado ($) *</label>
            <input
              type="number"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              step="0.01"
              placeholder="0.00"
              required
            />
          </div>

          {clienteSeleccionado && (
            <div style={styles.calcBox}>
              <p>
                <strong>Cálculo Automático:</strong>
              </p>
              <p>
                Meses cubiertos: {(monto / (clienteSeleccionado.honorario || 1)).toFixed(2)}
              </p>
              <p>
                Saldo pendiente: ${((clienteSeleccionado.totalAdeudado - monto) || 0).toFixed(2)}
              </p>
            </div>
          )}

          <div className="form-group">
            <label>Tipo de pago *</label>
            <select
              value={tipoPago}
              onChange={(e) => {
                const nextTipo = e.target.value;
                setTipoPago(nextTipo);

                if (nextTipo === 'Combinacion de pagos') {
                  setTipoPagoCombinado('Efectivo y Transferencia');
                  setCheques([{ numeroCheque: '', nombreBanco: '' }]);
                } else if (nextTipo === 'Cheque') {
                  setCheques([{ numeroCheque: '', nombreBanco: '' }]);
                } else {
                  setCheques([{ numeroCheque: '', nombreBanco: '' }]);
                }
              }}
              required
            >
              <option value="Cheque">Cheque</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Efectivo">Efectivo</option>
              <option value="Combinacion de pagos">Combinación de pagos</option>
            </select>
          </div>

          {tipoPago === 'Combinacion de pagos' && (
            <div className="form-group">
              <label>Combinación *</label>
              <select
                value={tipoPagoCombinado}
                onChange={(e) => {
                  const nextCombo = e.target.value;
                  setTipoPagoCombinado(nextCombo);
                  if (!nextCombo.includes('Cheque')) {
                    setCheques([{ numeroCheque: '', nombreBanco: '' }]);
                  }
                }}
                required
              >
                <option value="Efectivo y Transferencia">Efectivo y Transferencia</option>
                <option value="Efectivo y Cheque">Efectivo y Cheque</option>
                <option value="Transferencia y Cheque">Transferencia y Cheque</option>
              </select>
            </div>
          )}

          {(tipoPago === 'Cheque' || (tipoPago === 'Combinacion de pagos' && tipoPagoCombinado.includes('Cheque'))) && (
            <>
              {cheques.map((cheque, index) => (
                <div key={index} style={styles.chequeRow}>
                  <div style={styles.chequeField}>
                    <label>Número de cheque *</label>
                    <input
                      type="text"
                      value={cheque.numeroCheque}
                      onChange={(e) => {
                        const nueva = [...cheques];
                        nueva[index] = { ...nueva[index], numeroCheque: e.target.value.slice(0, 80) };
                        setCheques(nueva);
                      }}
                      placeholder="Ej: 00012345"
                      required
                      style={{ ...styles.chequeField, borderRadius: '6px', border: '1px solid rgba(29, 62, 138, 0.35)', padding: '8px' }}
                    />
                  </div>

                  <div style={styles.chequeField}>
                    <label>Nombre del banco *</label>
                    <input
                      type="text"
                      value={cheque.nombreBanco}
                      onChange={(e) => {
                        const nueva = [...cheques];
                        nueva[index] = { ...nueva[index], nombreBanco: e.target.value.slice(0, 120) };
                        setCheques(nueva);
                      }}
                      placeholder="Ej: Banco Nación"
                      required
                      style={{ ...styles.chequeField, borderRadius: '6px', border: '1px solid rgba(29, 62, 138, 0.35)', padding: '8px' }}
                    />
                  </div>

                  <div style={styles.chequeActions}>
                    <button
                      type="button"
                      onClick={() => {
                        if (cheques.length <= 1) return;
                        const nueva = cheques.filter((_, i) => i !== index);
                        setCheques(nueva);
                      }}
                      style={styles.removeChequeButton}
                      title="Eliminar este cheque"
                    >
                      −
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setCheques([...cheques, { numeroCheque: '', nombreBanco: '' }])}
                style={styles.addChequeButton}
                title="Agregar otra línea de cheque"
              >
                + Agregar cheque
              </button>
            </>
          )}

          <div className="form-group">
            <label>Detalles</label>
            <textarea
              value={detalles}
              onChange={(e) => setDetalles(e.target.value.slice(0, 1000))}
              maxLength={1000}
              rows={4}
              placeholder="Ingrese detalles del pago (máximo 1000 caracteres)"
            />
            <small style={{ color: 'var(--color-neutral)' }}>
              {detalles.length}/1000 caracteres
            </small>
          </div>

          <button 
            type="submit" 
            className="btn btn-success"
            disabled={loading}
            style={{ width: '100%', padding: '15px' }}
          >
            {loading ? '⏳ Procesando...' : '✓ Registrar Pago y Generar Recibo'}
          </button>

          {reciboGenerado?.fileName && (
            <div style={styles.copyBox}>
              <p>
                El recibo oficial quedó guardado en la PC servidor.
              </p>
              <button
                type="button"
                className="btn btn-info"
                onClick={descargarCopiaRecibo}
                disabled={downloadingCopy}
                style={{ width: '100%' }}
              >
                {downloadingCopy ? '⏳ Descargando copia...' : '⬇ Descargar copia en esta PC'}
              </button>
            </div>
          )}
        </form>
      </div>

      <div style={styles.listadoBox}>
        <h4>📁 Recibos guardados</h4>
        <div style={styles.serverNotice}>
          <strong>Importante:</strong> el botón <strong>Abrir carpeta</strong> abre la carpeta en la PC servidor (donde corre el backend).
        </div>

        <div className="pagos-filtros-main-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Tipo de trabajo</label>
            <select
              value={filtroTipoTrabajo}
              onChange={(e) => setFiltroTipoTrabajo(e.target.value)}
            >
              <option value="">Todos</option>
              <option value="honorarios">Honorarios</option>
              <option value="particular">Particulares</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Filtrar por cliente</label>
            <select
              value={filtroClienteId}
              onChange={(e) => setFiltroClienteId(e.target.value)}
            >
              <option value="">Todos</option>
              {clientes.map(cliente => (
                <option key={cliente.id} value={cliente.id}>{cliente.nombre}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Tipo de pago</label>
            <select
              value={filtroTipoPago}
              onChange={(e) => {
                const nextTipoPago = e.target.value;
                setFiltroTipoPago(nextTipoPago);
                if (nextTipoPago !== 'Cheque') {
                  setFiltroNumeroCheque('');
                  setFiltroNombreBanco('');
                }
              }}
            >
              <option value="">Todos</option>
              <option value="Cheque">Cheque</option>
              <option value="Combinacion de pagos">Combinación de pagos</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Efectivo">Efectivo</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Cliente o DNI/CUIT</label>
            <input
              type="text"
              value={filtroNombreCliente}
              onChange={(e) => setFiltroNombreCliente(e.target.value)}
              placeholder="Ej: Juan Perez o 20304567891"
            />
          </div>
        </div>

        <div className="pagos-filtros-date-row">
          {(filtroTipoPago === 'Cheque' || filtroTipoPago === 'Combinacion de pagos') && (
            <>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Nro de cheque</label>
                <input
                  type="text"
                  value={filtroNumeroCheque}
                  onChange={(e) => setFiltroNumeroCheque(e.target.value)}
                  placeholder="Ej: 00012345"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Nombre del banco</label>
                <input
                  type="text"
                  value={filtroNombreBanco}
                  onChange={(e) => setFiltroNombreBanco(e.target.value)}
                  placeholder="Ej: Banco Nación"
                />
              </div>
            </>
          )}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Desde</label>
            <input
              type="date"
              value={filtroDesde}
              onChange={(e) => setFiltroDesde(e.target.value)}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Hasta</label>
            <input
              type="date"
              value={filtroHasta}
              onChange={(e) => setFiltroHasta(e.target.value)}
            />
          </div>
        </div>

        <div style={styles.filtrosActions}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={fetchRecibos}
            disabled={loadingRecibos}
          >
            {loadingRecibos ? '⏳ Buscando...' : '🔎 Buscar recibos'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setFiltroClienteId('');
              setFiltroTipoTrabajo('');
              setFiltroTipoPago('');
              setFiltroNumeroCheque('');
              setFiltroNombreBanco('');
              setFiltroNombreCliente('');
              setFiltroDesde('');
              setFiltroHasta('');
              setTimeout(() => fetchRecibos(), 0);
            }}
            disabled={loadingRecibos}
          >
            Limpiar filtros
          </button>
        </div>

        <div style={styles.listaRecibos}>
          {recibos.length === 0 ? (
            <p style={{ margin: 0 }}>
              {loadingRecibos ? 'Cargando recibos...' : 'No hay recibos para los filtros seleccionados.'}
            </p>
          ) : (
            recibos.map((recibo) => (
              <div key={`${recibo.relativePath}_${recibo.createdAt}`} style={styles.reciboItem}>
                <div>
                  <p style={styles.reciboTitulo}>{recibo.fileName}</p>
                  <p style={styles.reciboMeta}>Cliente: {recibo.clienteFolderName}</p>
                  {recibo.categoriaCarpeta && <p style={styles.reciboMeta}>Categoría: {recibo.categoriaCarpeta}</p>}
                  {recibo.tipoPago && <p style={styles.reciboMeta}>Tipo de pago: {recibo.tipoPago}</p>}
                  {recibo.tipoPago === 'Cheque' && (
                    <p style={styles.reciboMeta}>
                      Cheque: {recibo.numeroCheque || '-'} · Banco: {recibo.nombreBanco || '-'}
                    </p>
                  )}
                  {recibo.anulado && (
                    <p style={{ ...styles.reciboMeta, color: '#b22222', fontWeight: 'bold' }}>
                      Estado: ANULADO {recibo.anuladoMotivo ? `· Motivo: ${recibo.anuladoMotivo}` : ''}
                    </p>
                  )}
                  <p style={styles.reciboMeta}>Fecha: {formatearFecha(recibo.createdAt)} · Tamaño: {formatearTamano(recibo.size)}</p>
                </div>
                <div style={styles.reciboActions}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => abrirCarpetaCliente(recibo.clienteFolderName, recibo.tipoTrabajo)}
                  >
                    Abrir carpeta
                  </button>
                  <button
                    type="button"
                    className="btn btn-info btn-sm"
                    onClick={async () => {
                      try {
                        await descargarRecibo(recibo);
                      } catch (error) {
                        setMessage('✗ No se pudo descargar uno de los recibos');
                      }
                    }}
                  >
                    Descargar
                  </button>
                  {!recibo.anulado && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => abrirModalAnularRecibo(recibo)}
                    >
                      Anular recibo
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={styles.helpBox}>
        <h4>ℹ️ Información</h4>
        <ul>
          <li>El recibo oficial se guarda automáticamente en la PC servidor</li>
          <li>Puede descargar una copia local del recibo en esta PC</li>
          <li>El cálculo de meses cubiertos se realiza automáticamente</li>
          <li>Todos los contadores verán el pago actualizado en tiempo real</li>
          <li>Los datos se guardan en Excel para respaldo</li>
        </ul>
      </div>

      {reciboParaAnular && (
        <div
          style={styles.modalOverlay(cerrandoModalAnulacion)}
          onClick={() => cerrarModalAnularRecibo()}
        >
          <div
            style={styles.modalContent(cerrandoModalAnulacion)}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, color: 'var(--color-dark)' }}>Anular Recibo</h3>

            <div style={styles.anularSummaryCard}>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-primary)' }}>{reciboParaAnular.fileName}</p>
              <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: 'var(--color-dark)' }}>
                Cliente: <strong>{reciboParaAnular.clienteFolderName}</strong>
              </p>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-dark)' }}>
                Fecha: {formatearFecha(reciboParaAnular.createdAt)}
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: '14px' }}>
              <label>Motivo de anulación *</label>
              <textarea
                value={motivoAnulacion}
                onChange={(e) => setMotivoAnulacion(e.target.value.slice(0, 250))}
                rows={3}
                maxLength={250}
                placeholder="Describa por qué se anula el recibo"
              />
              <small style={{ color: 'var(--color-neutral)' }}>{motivoAnulacion.length}/250 caracteres</small>
            </div>

            <div style={styles.warningBox}>
              Esta acción marca el recibo como anulado y excluye el pago del cálculo de deuda.
            </div>

            <div style={styles.modalActions}>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmarAnularRecibo}
                disabled={anulandoRecibo}
              >
                {anulandoRecibo ? '⏳ Anulando...' : 'Confirmar anulación'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => cerrarModalAnularRecibo()}
                disabled={anulandoRecibo}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: 'rgba(165, 166, 146, 0.12)',
    padding: '20px',
    borderRadius: '8px',
    marginTop: '20px',
    border: '1px solid rgba(165, 166, 146, 0.45)'
  },
  infoBox: {
    background: 'rgba(63, 181, 233, 0.14)',
    border: '1px solid rgba(63, 181, 233, 0.5)',
    color: 'var(--color-primary)',
    padding: '15px',
    borderRadius: '5px',
    marginBottom: '20px',
  },
  searchInputWrap: {
    position: 'relative',
    marginBottom: '8px'
  },
  searchIcon: {
    position: 'absolute',
    left: '10px',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '14px',
    pointerEvents: 'none',
    opacity: 0.85
  },
  searchInput: {
    paddingLeft: '34px'
  },
  searchResultsDropdown: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    right: 0,
    zIndex: 60,
    border: '1px solid rgba(165, 166, 146, 0.55)',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.98)',
    overflow: 'hidden',
    boxShadow: '0 10px 22px rgba(25, 25, 25, 0.15)'
  },
  searchResultsList: {
    maxHeight: '210px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
  searchResultItem: (selected) => ({
    border: 'none',
    borderBottom: '1px solid rgba(165, 166, 146, 0.35)',
    background: selected ? 'rgba(63, 181, 233, 0.18)' : 'transparent',
    textAlign: 'left',
    padding: '10px 12px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px'
  }),
  searchResultName: {
    fontWeight: 700,
    color: 'var(--color-dark)'
  },
  searchResultMeta: {
    fontSize: '12px',
    color: 'var(--color-neutral)'
  },
  searchNoResults: {
    margin: 0,
    padding: '12px',
    color: 'var(--color-primary)',
    fontSize: '13px'
  },
  selectedClienteHint: {
    display: 'block',
    marginTop: '8px',
    color: 'var(--color-primary)',
    fontSize: '12px'
  },
  chequeRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr auto',
    gap: '10px',
    alignItems: 'flex-end',
    padding: '12px',
    border: '1px solid rgba(63, 181, 233, 0.35)',
    borderRadius: '8px',
    background: 'rgba(63, 181, 233, 0.08)',
    marginBottom: '10px'
  },
  chequeField: {
    width: '100%'
  },
  chequeActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  addChequeButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px 14px',
    border: '1px solid rgba(29, 62, 138, 0.6)',
    borderRadius: '6px',
    backgroundColor: 'rgba(29, 62, 138, 0.08)',
    color: 'var(--color-dark)',
    fontWeight: 600,
    cursor: 'pointer'
  },
  removeChequeButton: {
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    padding: '0',
    border: '1px solid rgba(233, 68, 68, 0.7)',
    backgroundColor: 'rgba(233, 68, 68, 0.1)',
    color: 'rgb(199, 45, 45)',
    fontWeight: 700,
    cursor: 'pointer'
  },
  calcBox: {
    background: 'rgba(29, 62, 138, 0.1)',
    border: '1px solid rgba(29, 62, 138, 0.35)',
    color: 'var(--color-primary)',
    padding: '15px',
    borderRadius: '5px',
    marginBottom: '20px',
  },
  copyBox: {
    background: 'rgba(63, 181, 233, 0.1)',
    border: '1px solid rgba(63, 181, 233, 0.45)',
    color: 'var(--color-primary)',
    padding: '12px',
    borderRadius: '5px',
    marginTop: '16px'
  },
  listadoBox: {
    background: 'rgba(165, 166, 146, 0.12)',
    border: '1px solid rgba(165, 166, 146, 0.45)',
    color: 'var(--color-dark)',
    padding: '15px',
    borderRadius: '5px',
    marginTop: '20px'
  },
  serverNotice: {
    background: 'rgba(29, 62, 138, 0.1)',
    border: '1px solid rgba(29, 62, 138, 0.35)',
    color: 'var(--color-primary)',
    padding: '10px 12px',
    borderRadius: '5px',
    marginTop: '10px',
    marginBottom: '12px',
    fontSize: '13px'
  },
  filtrosActions: {
    display: 'flex',
    gap: '10px',
    marginTop: '12px',
    flexWrap: 'wrap'
  },
  listaRecibos: {
    marginTop: '15px',
    display: 'grid',
    gap: '10px'
  },
  reciboItem: {
    border: '1px solid rgba(29, 62, 138, 0.25)',
    borderRadius: '5px',
    padding: '10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(255,255,255,0.7)'
  },
  reciboActions: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'flex-end'
  },
  reciboTitulo: {
    margin: 0,
    fontWeight: 600,
    color: 'var(--color-primary)'
  },
  reciboMeta: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: 'var(--color-dark)'
  },
  helpBox: {
    background: 'rgba(165, 166, 146, 0.18)',
    border: '1px solid rgba(165, 166, 146, 0.6)',
    color: 'var(--color-dark)',
    padding: '15px',
    borderRadius: '5px',
    marginTop: '20px',
  },
  modalOverlay: (closing) => ({
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
    padding: '16px',
    opacity: closing ? 0 : 1,
    transition: 'opacity 220ms ease'
  }),
  modalContent: (closing) => ({
    width: '100%',
    maxWidth: '560px',
    background: 'var(--color-white)',
    borderRadius: '10px',
    padding: '20px',
    boxShadow: '0 10px 28px rgba(25, 25, 25, 0.25)',
    transform: closing ? 'translateY(10px) scale(0.985)' : 'translateY(0) scale(1)',
    opacity: closing ? 0 : 1,
    transition: 'transform 220ms ease, opacity 220ms ease'
  }),
  anularSummaryCard: {
    background: 'linear-gradient(135deg, rgba(29, 62, 138, 0.1), rgba(63, 181, 233, 0.1))',
    border: '1px solid rgba(29, 62, 138, 0.25)',
    borderRadius: '8px',
    padding: '10px 12px',
    marginBottom: '14px'
  },
  warningBox: {
    background: 'rgba(178, 34, 34, 0.08)',
    border: '1px solid rgba(178, 34, 34, 0.28)',
    color: '#7f1d1d',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '13px',
    marginBottom: '14px'
  },
  modalActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    flexWrap: 'wrap'
  }
};
