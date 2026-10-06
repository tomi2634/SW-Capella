import React from 'react';
import ReactDOM from 'react-dom/client';
import './App.css';
import App from './App';

// La rueda del mouse sobre un input numérico con foco le cambia el valor.
// Quitarle el foco evita el cambio y deja que la página siga scrolleando.
document.addEventListener('wheel', () => {
  const el = document.activeElement;
  if (el && el.type === 'number') el.blur();
}, { passive: true });

const root =ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
