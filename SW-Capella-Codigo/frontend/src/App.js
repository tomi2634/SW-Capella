import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import ClientesTab from './components/ClientesTab';
import PagosTab from './components/PagosTab';
import ResumenTab from './components/ResumenTab';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || `http://${window.location.hostname || 'localhost'}:5000/api`;

function App() {
  const [activeTab, setActiveTab] = useState('resumen');
  const [clientes, setClientes] = useState([]);
  const [resumen, setResumen] = useState(null);

  useEffect(() => {
    fetchData();
    // Polling cada 5 segundos para sincronización en tiempo real
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [clientesRes, resumenRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/clientes`),
        axios.get(`${API_BASE_URL}/resumen`)
      ]);
      setClientes(clientesRes.data);
      setResumen(resumenRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  };

  const handleClienteCreated = async () => {
    await fetchData();
  };

  const handlePagoRegistrado = async () => {
    await fetchData();
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="brand">
            <img
              src="/images/isologotipo-capella_sinfondo.png"
              alt="Isologotipo Capella"
              className="brand-full-logo"
            />
          </div>
        </div>
      </header>

      <div className="container">
        <nav className="tabs">
          <button
            className={`tab ${activeTab === 'resumen' ? 'active' : ''}`}
            onClick={() => setActiveTab('resumen')}
          >
            📊 Resumen
          </button>
          <button
            className={`tab ${activeTab === 'clientes' ? 'active' : ''}`}
            onClick={() => setActiveTab('clientes')}
          >
            👥 Clientes
          </button>
          <button
            className={`tab ${activeTab === 'pagos' ? 'active' : ''}`}
            onClick={() => setActiveTab('pagos')}
          >
            💰 Registrar Pago
          </button>
        </nav>

        <div className="content">
          <div key={activeTab} className="tab-panel">
            {activeTab === 'resumen' && <ResumenTab resumen={resumen} clientes={clientes} />}
            {activeTab === 'clientes' && (
              <ClientesTab 
                clientes={clientes} 
                onClienteCreated={handleClienteCreated}
                onRefresh={fetchData}
              />
            )}
            {activeTab === 'pagos' && (
              <PagosTab 
                clientes={clientes}
                onPagoRegistrado={handlePagoRegistrado}
              />
            )}
          </div>
        </div>
      </div>

      <footer className="footer">
        <p>© 2024 Estudio Contable Capella - Sistema de Gestión de Pagos</p>
        <p>Teléfono: (2625) 436867</p>
        <a
          href="/manual-usuario.html"
          target="_blank"
          rel="noreferrer"
          className="footer-manual-btn"
        >
          Manual de Usuario
        </a>
      </footer>
    </div>
  );
}

export default App;
