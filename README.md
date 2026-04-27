# 🔴 PrecioScan — Consulta de Precios

Sistema de consulta de precios para empleados con escaneo de código de barras.
Diseño neon rojo/negro. Funciona en celular desde el navegador.

---

## 📁 Estructura de archivos

```
precioscan/
├── server.js          ← Backend Node.js (API + SQLite)
├── package.json
├── data/              ← Se crea automático (base de datos SQLite)
│   └── precios.db
└── public/
    └── index.html     ← Frontend (copiá el index.html acá)
```

---

## 🚀 Deploy en Railway (GRATIS, recomendado)

1. Creá cuenta en https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Subí esta carpeta a un repo de GitHub
4. Railway lo detecta automático con el package.json
5. En Variables de entorno agregá: `PORT=3000`
6. Railway te da una URL pública tipo: `https://precioscan-xxx.railway.app`

**Después:**
- Editá `index.html` y cambiá la línea:
  ```js
  const API = null;
  ```
  por:
  ```js
  const API = 'https://precioscan-xxx.railway.app/api';
  ```

---

## 🖥️ Correr en local

```bash
npm install
node server.js
```
Abrí http://localhost:3000

---

## 📤 Exportar CSV desde Factusol

1. Factusol → módulo **Artículos**
2. Menú superior → **Listados** → **Artículos**
3. Exportar → elegí **CSV** con separador **coma**
4. Columnas mínimas a incluir:
   - `codigo` (o ref, cód. artículo)
   - `nombre` (o descripción)
   - `precio` (precio de venta)
   - `categoria` (familia/grupo)
   - `stock` (existencias)
   - `iva` (tipo IVA, ej: 21)
5. Subí el CSV en la app → pestaña **CSV**

---

## 🔌 API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/products?q=alfajor` | Buscar productos |
| GET | `/api/products/barcode/ALF001` | Buscar por código exacto |
| GET | `/api/products/all` | Todos los productos |
| POST | `/api/products` | Crear/actualizar uno |
| POST | `/api/products/import` | Importar array JSON |
| DELETE | `/api/products/:codigo` | Eliminar |
| GET | `/api/stats` | Estadísticas |
| GET | `/health` | Estado del servidor |

---

## 📱 Instalar como app en el celular

**iPhone:**
Safari → Compartir → "Agregar a pantalla de inicio"

**Android:**
Chrome → menú ⋮ → "Agregar a pantalla de inicio"

La app funciona sin internet una vez cargada (los datos se guardan en el servidor).

---

## 💡 Flujo recomendado con Factusol

```
Actualizás precios en Factusol
    ↓
Exportás artículos como CSV
    ↓
Subís el CSV en la app (pestaña CSV)
    ↓
La base de datos se actualiza
    ↓
Todos los empleados ven los precios nuevos
```

Recomendado: hacerlo 1 vez por semana o cada vez que cambien precios.
