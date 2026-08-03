import React from 'react';

export default function ResumenTab({ resumen, clientes }) {
  if (!resumen) {
    return <div className="loading">Cargando datos...</div>;
  }

  const clientesConDeudaPendiente = clientes.filter(c => c.totalAdeudado > 0);

  return (
    <div>
      <h2>📊 Resumen General</h2>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{resumen.totalClientes}</div>
          <div style={styles.statLabel}>Total Clientes</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>${resumen.totalAdeudado?.toFixed(2) || '0.00'}</div>
          <div style={styles.statLabel}>Total Adeudado</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{resumen.clientesConDeuda || 0}</div>
          <div style={styles.statLabel}>Clientes con Deuda</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{resumen.clientesPagoDia || 0}</div>
          <div style={styles.statLabel}>Clientes al Día</div>
        </div>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h3>⚠️ Clientes con Deuda Pendiente</h3>
        {clientesConDeudaPendiente.length === 0 ? (
          <p style={{ color: 'var(--color-accent)', marginTop: '10px' }}>✓ No hay clientes con deuda pendiente</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Meses Adeudados</th>
                <th>Total Adeudado</th>
                <th>Honorario Mensual</th>
              </tr>
            </thead>
            <tbody>
              {clientesConDeudaPendiente.map(cliente => (
                <tr key={cliente.id}>
                  <td>{cliente.nombre}</td>
                  <td>{cliente.mesesAdeudados || 0}</td>
                  <td style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>
                    ${cliente.totalAdeudado?.toFixed(2) || '0.00'}
                  </td>
                  <td>${cliente.honorario || '0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const styles = {
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginTop: '20px',
  },
  statCard: {
    background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-dark) 100%)',
    color: 'var(--color-white)',
    padding: '20px',
    borderRadius: '8px',
    textAlign: 'center',
    boxShadow: '0 4px 8px rgba(29, 62, 138, 0.2)',
  },
  statNumber: {
    fontSize: '32px',
    fontWeight: 'bold',
    marginBottom: '10px',
  },
  statLabel: {
    fontSize: '14px',
    opacity: 0.9,
  },
};
