// ─────────────────────────────────────────────────────────────────
// PrecioScan — Backend Node.js + SQLite
// Hosteable gratis en Railway.app o Render.com
// ─────────────────────────────────────────────────────────────────

const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/precios.db';

// ── SETUP ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public')); // sirve el index.html desde /public

// Crear directorio si no existe
if (!fs.existsSync('./data')) fs.mkdirSync('./data');

const db = new Database(DB_PATH);

// ── SCHEMA ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS productos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo    TEXT UNIQUE NOT NULL,
    nombre    TEXT NOT NULL,
    descripcion TEXT DEFAULT '',
    precio    REAL NOT NULL DEFAULT 0,
    categoria TEXT DEFAULT 'General',
    stock     INTEGER DEFAULT 0,
    unidad    TEXT DEFAULT 'unidad',
    iva       REAL DEFAULT 21,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_codigo ON productos(codigo);
  CREATE INDEX IF NOT EXISTS idx_nombre ON productos(nombre);
`);

// Datos de ejemplo si la tabla está vacía
const count = db.prepare('SELECT COUNT(*) as n FROM productos').get();
if (count.n === 0) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO productos (codigo, nombre, descripcion, precio, categoria, stock, unidad, iva)
    VALUES (@codigo, @nombre, @descripcion, @precio, @categoria, @stock, @unidad, @iva)
  `);
  const insertMany = db.transaction((items) => items.forEach(i => insert.run(i)));
  insertMany([
    { codigo:'ALF001', nombre:'Alfajor Clásico', descripcion:'De maicena con dulce de leche', precio:850, categoria:'Alfajores', stock:200, unidad:'unidad', iva:21 },
    { codigo:'ALF002', nombre:'Alfajor Chocolate', descripcion:'Cubierto chocolate amargo', precio:980, categoria:'Alfajores', stock:150, unidad:'unidad', iva:21 },
    { codigo:'CAJ001', nombre:'Caja x12 Clásicos', descripcion:'Caja 12 unidades', precio:9600, categoria:'Cajas', stock:40, unidad:'caja', iva:21 },
    { codigo:'REG001', nombre:'Estuche Regalo', descripcion:'6 alfajores premium', precio:6800, categoria:'Regalos', stock:20, unidad:'estuche', iva:21 },
    { codigo:'MAY001', nombre:'Mayorista x60', descripcion:'Bolsa mayorista', precio:45000, categoria:'Mayorista', stock:15, unidad:'bolsa', iva:21 },
  ]);
}

// ── RUTAS ─────────────────────────────────────────────────────────

// GET /api/products?q=texto  — búsqueda
app.get('/api/products', (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (!q) {
    rows = db.prepare('SELECT * FROM productos ORDER BY nombre LIMIT 100').all();
  } else {
    const like = `%${q}%`;
    rows = db.prepare(`
      SELECT * FROM productos
      WHERE nombre LIKE ? OR codigo LIKE ? OR descripcion LIKE ? OR categoria LIKE ?
      ORDER BY
        CASE WHEN codigo = ? THEN 0
             WHEN codigo LIKE ? THEN 1
             WHEN nombre LIKE ? THEN 2
             ELSE 3 END
      LIMIT 20
    `).all(like, like, like, like, q, `${q}%`, `${q}%`);
  }
  res.json(rows);
});

// GET /api/products/barcode/:code  — búsqueda por código de barras exacto
app.get('/api/products/barcode/:code', (req, res) => {
  const code = req.params.code;
  const row = db.prepare('SELECT * FROM productos WHERE codigo = ?').get(code);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  res.json(row);
});

// GET /api/products/all  — todos los productos
app.get('/api/products/all', (req, res) => {
  const rows = db.prepare('SELECT * FROM productos ORDER BY categoria, nombre').all();
  res.json(rows);
});

// POST /api/products  — crear/actualizar un producto
app.post('/api/products', (req, res) => {
  const p = req.body;
  if (!p.codigo || !p.nombre || p.precio == null) {
    return res.status(400).json({ error: 'Faltan campos requeridos: codigo, nombre, precio' });
  }
  const upsert = db.prepare(`
    INSERT INTO productos (codigo, nombre, descripcion, precio, categoria, stock, unidad, iva, updated_at)
    VALUES (@codigo, @nombre, @descripcion, @precio, @categoria, @stock, @unidad, @iva, datetime('now'))
    ON CONFLICT(codigo) DO UPDATE SET
      nombre=excluded.nombre, descripcion=excluded.descripcion,
      precio=excluded.precio, categoria=excluded.categoria,
      stock=excluded.stock, unidad=excluded.unidad, iva=excluded.iva,
      updated_at=datetime('now')
  `);
  const info = upsert.run({
    codigo: p.codigo, nombre: p.nombre,
    descripcion: p.descripcion || '',
    precio: parseFloat(p.precio) || 0,
    categoria: p.categoria || 'General',
    stock: parseInt(p.stock) || 0,
    unidad: p.unidad || 'unidad',
    iva: parseFloat(p.iva) || 21,
  });
  const saved = db.prepare('SELECT * FROM productos WHERE rowid = ?').get(info.lastInsertRowid || info.changes);
  res.json(saved || { ok: true });
});

// POST /api/products/import  — importar array de productos (desde CSV)
app.post('/api/products/import', (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Se esperaba un array' });

  const upsert = db.prepare(`
    INSERT INTO productos (codigo, nombre, descripcion, precio, categoria, stock, unidad, iva, updated_at)
    VALUES (@codigo, @nombre, @descripcion, @precio, @categoria, @stock, @unidad, @iva, datetime('now'))
    ON CONFLICT(codigo) DO UPDATE SET
      nombre=excluded.nombre, descripcion=excluded.descripcion,
      precio=excluded.precio, categoria=excluded.categoria,
      stock=excluded.stock, unidad=excluded.unidad, iva=excluded.iva,
      updated_at=datetime('now')
  `);
  const importMany = db.transaction((rows) => {
    let ok = 0, errors = [];
    rows.forEach((p, i) => {
      if (!p.codigo || !p.nombre) { errors.push(`Fila ${i}: falta codigo o nombre`); return; }
      upsert.run({
        codigo: String(p.codigo), nombre: String(p.nombre),
        descripcion: p.descripcion || '',
        precio: parseFloat(p.precio) || 0,
        categoria: p.categoria || 'General',
        stock: parseInt(p.stock) || 0,
        unidad: p.unidad || 'unidad',
        iva: parseFloat(p.iva) || 21,
      });
      ok++;
    });
    return { ok, errors };
  });

  const result = importMany(items);
  res.json(result);
});

// DELETE /api/products/:codigo
app.delete('/api/products/:codigo', (req, res) => {
  const info = db.prepare('DELETE FROM productos WHERE codigo = ?').run(req.params.codigo);
  if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ deleted: true });
});

// GET /api/stats
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM productos').get().n;
  const cats = db.prepare('SELECT categoria, COUNT(*) as n FROM productos GROUP BY categoria').all();
  const lastUpdate = db.prepare('SELECT MAX(updated_at) as t FROM productos').get().t;
  res.json({ total, categorias: cats, lastUpdate });
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', db: DB_PATH, products: db.prepare('SELECT COUNT(*) as n FROM productos').get().n }));

// Servir index.html en la raíz (si no está en /public)
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.json({ message: 'PrecioScan API corriendo. Poné index.html en /public/' });
});

app.listen(PORT, () => {
  console.log(`\n🔴 PrecioScan corriendo en puerto ${PORT}`);
  console.log(`📦 Base de datos: ${DB_PATH}`);
  console.log(`🌐 API: http://localhost:${PORT}/api/products\n`);
});
