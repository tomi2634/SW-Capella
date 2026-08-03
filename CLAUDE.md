# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SW-Capella** is a standalone accounting firm management system for "Estudio Contable Capella" in Argentina. It handles client management (two types: monthly honorarios and one-time particular work), payment tracking with multiple payment methods (cash, transfer, cheque, combinations), PDF receipt generation, and debt calculation at month-end billing.

The app runs entirely on a single Windows PC in a local network (no cloud/authentication). The backend and frontend start independently via a batch script.

## Key Commands

```bash
# Start the full system (both backend and frontend)
./iniciar.bat          # Windows: starts backend on :5000, frontend on :3000

# Backend (Express, port 5000)
cd backend && npm start        # Starts the API server
cd backend && node server.js   # Same
cd backend && node rebuild-historial.js  # Rebuild historial.xlsx from client/payment data

# Frontend (React, port 3000)
cd frontend && npm start       # Development server
cd frontend && npm run build   # Production build (outputs to build/)
cd frontend && npm test        # Run tests

# Backend dependencies
cd backend && npm install
cd frontend && npm install
```

## Architecture

### Data Layer (Excel-based, no database)

Three `.xlsx` files in `data/` serve as the database:

- **`clientes.xlsx`** — Clients table with columns: ID, nombre, teléfono, honorario, honorarioPeriodo, totalAdeudado, próximaFacturacion, fechaCreacion, tipoTrabajo, interesMensualActivo/%, lastUpdate, dniCuit, honorariosProgramados (JSON column).
- **`pagos.xlsx`** — Payments table: ID, clienteId, monto, tipoPago, detalles, fecha, timestamp, numeroCheque, nombreBanco, estado (activo/anulado), anulación metadata, recibo file metadata.
- **`historial.xlsx`** — Billing history per client per month (populated by `rebuild-historial.js`).

Debt calculation is **dynamic** — computed at read time rather than stored. The system generates months from `fechaCreacion` to the current month, subtracts active payments, and derives debt.

### Backend (`backend/`)

**Express** server on port 5000. Three files:

- **`server.js`** — Routes and core logic (~1300 lines). All routes are defined here: CRUD for clients, payments, receipts, history, polling sync, admin endpoints (reset, backup, debug). Also handles daily ZIP backups of the `data/` folder with retention management.
- **`excelManager.js`** — `ExcelManager` class (~1660 lines). Wraps `exceljs` for all Excel read/write operations. Manages column mappings via constants, schema migrations (adds missing columns on read), and the core `_calcularFinanzasCliente()` method.
- **`pdfGenerator.js`** — `PDFGenerator` class using `pdfkit`. Generates A5-format receipt PDFs with logo, client info, payment table, cheque details, and footer.

Key architectural patterns:
- Payments are recorded → debt auto-recalculates via `recalculateClienteDeuda()`.
- Receipts are saved as PDF files under `Trabajos Estudio Capella/`, organized by client folder, inside a gitignored directory.
- Receipt numbering uses a JSON counter file (`_contador_recibos.json`).
- A "particular" client is a one-time job with a fixed fee (no monthly billing cycle).
- Monthly interest can be configured per client (percentage applied to each month's honorario).

### Frontend (`frontend/`)

Create React App with three tabs:

- **`App.js`** — Root component, navigation, polling every 5 seconds for real-time sync.
- **`components/ResumenTab.js`** — Summary dashboard: total clients, total debt, clients with/without debt.
- **`components/ClientesTab.js`** — Client management with inline honorario editing, sub-tabs (Mensuales/Particulares), history modal, and a "Programar honorario" modal for scheduling per-month fees or loading historical debt.
- **`components/PagosTab.js`** — Payment registration with searchable client dropdown, cheque support (multiple cheques), receipt generation, receipt listing with filters, download, and voiding.
- **`App.css`** — CSS custom properties for theming (`--color-primary: #1d3e8a`, etc.).

### File Organization on Disk

```
SW-Capella-Codigo/
├── backend/           # Express API server
├── frontend/          # React SPA (built output in build/)
├── data/              # Excel files (database)
├── backups/           # Daily ZIP backups of data/
├── Trabajos Estudio Capella/   # Client receipt PDFs (gitignored)
├── iniciar.bat        # One-click startup script
```

### Workflow

1. Admin adds a client (honorarios = monthly billable, or particular = one-time fee).
2. When the client pays, admin registers the payment in the "Registrar Pago" tab.
3. A receipt PDF is auto-generated and saved to disk.
4. The debt calculation updates automatically across all views via polling.
5. Receipts can be listed, filtered, downloaded, or voided (which excludes the payment from debt calculation).
6. Daily ZIP backups of the `data/` directory are created on server start (max 10 retained).
7. The `programar mes` feature allows setting per-month honorarios and loading historical debt for past periods.

## Notable Implementation Details

- **Copilot instructions file** exists at `.github/workflows/copilot-instructions.md` — it enforces a non-verbose "DeepSeek V4 Pro" mode that should NOT be applied to Claude.
- The `node_modules` directories are committed for both backend and frontend.
- Backend uses `javascript-obfuscator` as a dev dependency (for code obfuscation during distribution).
- Ports are hardcoded: backend on 5000, frontend dev server on 3000.
- The frontend picks up the API host dynamically from `window.location.hostname`, defaulting to `localhost:5000/api`.
- All monetary values use 2-decimal rounding (`Math.round(value * 100) / 100`).
- The `iniciar.bat` script runs both backend and frontend in hidden cmd windows via PowerShell Start-Process.
