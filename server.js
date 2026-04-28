// ─────────────────────────────────────────────────────────────────
// PrecioScan — Backend Node.js + PostgreSQL
// ─────────────────────────────────────────────────────────────────

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── CONEXIÓN POSTGRESQL ───────────────────────────────────────────
// Railway inyecta DATABASE_URL automáticamente
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── CREAR TABLA SI NO EXISTE ──────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS productos (
      id          SERIAL PRIMARY KEY,
      codigo      TEXT UNIQUE NOT NULL,
      nombre      TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      precio      NUMERIC(12,2) NOT NULL DEFAULT 0,
      categoria   TEXT DEFAULT 'General',
      stock       INTEGER DEFAULT 0,
      unidad      TEXT DEFAULT 'unidad',
      iva         NUMERIC(5,2) DEFAULT 21,
      updated_at  TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(codigo);
    CREATE INDEX IF NOT EXISTS idx_productos_nombre ON productos(nombre);
  `);

  // Datos de ejemplo si la tabla está vacía
  const { rows } = await pool.query('SELECT COUNT(*) as n FROM productos');
  if (parseInt(rows[0].n) === 0) {
    await pool.query(`
      INSERT INTO productos (codigo, nombre, descripcion, precio, categoria, stock, unidad, iva) VALUES
      ('ALF001', 'Alfajor Clásico',          'De maicena con dulce de leche repostero',  850,   'Alfajores', 200, 'unidad',  21),
      ('ALF002', 'Alfajor Chocolate Amargo', 'Cubierto de chocolate 70% cacao',          980,   'Alfajores', 150, 'unidad',  21),
      ('ALF003', 'Alfajor Triple',           'Tres capas con dulce de leche repostero',  1100,  'Alfajores', 120, 'unidad',  21),
      ('CAJ001', 'Caja x12 Clásicos',        'Caja de 12 alfajores clásicos',            9600,  'Cajas',      40, 'caja',    21),
      ('CAJ002', 'Caja x24 Surtidos',        'Caja surtida 24 unidades variadas',        19200, 'Cajas',      25, 'caja',    21),
      ('REG001', 'Estuche Regalo Chico',     '3 alfajores seleccionados con lazo',       3200,  'Regalos',    50, 'estuche', 21),
      ('REG002', 'Estuche Regalo Grande',    '6 alfajores premium con caja decorada',    6800,  'Regalos',    20, 'estuche', 21),
      ('MAY001', 'Mayorista x60 Clásicos',   'Bolsa mayorista 60 unidades',              45000, 'Mayorista',  15, 'bolsa',   21)
      ON CONFLICT (codigo) DO NOTHING;
    `);
    console.log('✓ Datos de ejemplo cargados');
  }

  console.log('✓ Base de datos lista');
}

// ── RUTAS ─────────────────────────────────────────────────────────

// Buscar productos
app.get('/api/products', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      const { rows } = await pool.query('SELECT * FROM productos ORDER BY categoria, nombre LIMIT 200');
      return res.json(rows);
    }
    const like = `%${q}%`;
    const { rows } = await pool.query(`
      SELECT * FROM productos
      WHERE nombre ILIKE $1 OR codigo ILIKE $2 OR descripcion ILIKE $3 OR categoria ILIKE $4
      ORDER BY
        CASE WHEN codigo = $5 THEN 0
             WHEN codigo ILIKE $6 THEN 1
             WHEN nombre ILIKE $7 THEN 2
             ELSE 3 END
      LIMIT 20
    `, [like, like, like, like, q, `${q}%`, `${q}%`]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error en búsqueda' });
  }
});

// Buscar por código de barras exacto
app.get('/api/products/barcode/:code', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos WHERE codigo = $1', [req.params.code]);
    if (!rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

// Todos los productos
app.get('/api/products/all', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM productos ORDER BY categoria, nombre');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

// Crear o actualizar un producto
app.post('/api/products', async (req, res) => {
  const p = req.body;
  if (!p.codigo || !p.nombre || p.precio == null) {
    return res.status(400).json({ error: 'Faltan campos: codigo, nombre, precio' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO productos (codigo, nombre, descripcion, precio, categoria, stock, unidad, iva, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (codigo) DO UPDATE SET
        nombre      = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        precio      = EXCLUDED.precio,
        categoria   = EXCLUDED.categoria,
        stock       = EXCLUDED.stock,
        unidad      = EXCLUDED.unidad,
        iva         = EXCLUDED.iva,
        updated_at  = NOW()
      RETURNING *
    `, [
      p.codigo, p.nombre, p.descripcion || '',
      parseFloat(p.precio) || 0,
      p.categoria || 'General',
      parseInt(p.stock) || 0,
      p.unidad || 'unidad',
      parseFloat(p.iva) || 21,
    ]);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al guardar' });
  }
});

// Importar array desde CSV
app.post('/api/products/import', async (req, res) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Se esperaba un array' });

  let ok = 0; const errors = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [i, p] of items.entries()) {
      if (!p.codigo || !p.nombre) { errors.push(`Fila ${i}: falta codigo o nombre`); continue; }
      await client.query(`
        INSERT INTO productos (codigo, nombre, descripcion, precio, categoria, stock, unidad, iva, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (codigo) DO UPDATE SET
          nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion,
          precio=EXCLUDED.precio, categoria=EXCLUDED.categoria,
          stock=EXCLUDED.stock, unidad=EXCLUDED.unidad,
          iva=EXCLUDED.iva, updated_at=NOW()
      `, [
        String(p.codigo), String(p.nombre), p.descripcion || '',
        parseFloat(p.precio) || 0, p.categoria || 'General',
        parseInt(p.stock) || 0, p.unidad || 'unidad',
        parseFloat(p.iva) || 21,
      ]);
      ok++;
    }
    await client.query('COMMIT');
    res.json({ ok, errors });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Error en importación', detail: e.message });
  } finally {
    client.release();
  }
});

// Eliminar producto
app.delete('/api/products/:codigo', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM productos WHERE codigo = $1', [req.params.codigo]);
    if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

// Stats
app.get('/api/stats', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) as n FROM productos');
    const cats  = await pool.query('SELECT categoria, COUNT(*) as n FROM productos GROUP BY categoria ORDER BY n DESC');
    const last  = await pool.query('SELECT MAX(updated_at) as t FROM productos');
    res.json({ total: parseInt(total.rows[0].n), categorias: cats.rows, lastUpdate: last.rows[0].t });
  } catch (e) {
    res.status(500).json({ error: 'Error' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) as n FROM productos');
    res.json({ status: 'ok', products: parseInt(rows[0].n), db: 'postgresql' });
  } catch (e) {
    res.status(500).json({ status: 'error', detail: e.message });
  }
});

// Raíz → app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ARRANCAR ──────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🔴 PrecioScan corriendo en puerto ${PORT}`);
      console.log(`📦 Base de datos: PostgreSQL`);
      console.log(`🌐 http://localhost:${PORT}\n`);
    });
  })
  .catch(err => {
    console.error('Error iniciando DB:', err);
    process.exit(1);
  });
