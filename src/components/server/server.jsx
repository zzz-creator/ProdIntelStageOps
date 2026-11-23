/**
 * ProdIntel StageOps - Offline Backend Server
 * Run: node server.js
 * Requires: PostgreSQL running + .env configured
 */

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ─── Database ────────────────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'prodintel',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.connect().then(() => console.log('✅ PostgreSQL connected')).catch(err => {
  console.error('❌ PostgreSQL connection failed:', err.message);
  process.exit(1);
});

// ─── Entity → Table mapping ───────────────────────────────────────────────────

const TABLE_MAP = {
  Production:                  'productions',
  ProductionTemplate:          'production_templates',
  Venue:                       'venues',
  CrewMember:                  'crew_members',
  CrewAssignment:              'crew_assignments',
  CrewOnboarding:              'crew_onboarding',
  TaskChecklist:               'task_checklists',
  IncidentLog:                 'incident_logs',
  Budget:                      'budgets',
  BudgetExpense:               'budget_expenses',
  EquipmentAsset:              'equipment_assets',
  MaintenanceRecord:           'maintenance_records',
  UsageMetrics:                'usage_metrics',
  EquipmentSchedule:           'equipment_schedules',
  AssetLocation:               'asset_locations',
  KnowledgeRecord:             'knowledge_records',
  CueDocumentation:            'cue_documentations',
  ProcedureLibrary:            'procedure_libraries',
  AutomationRule:              'automation_rules',
  TriggerCondition:            'trigger_conditions',
  WorkflowAction:              'workflow_actions',
  ExecutionLog:                'execution_logs',
  HistoricalIncidentAnalysis:  'historical_incident_analyses',
  ActivityLog:                 'activity_logs',
  AuditLog:                    'audit_logs',
  Comment:                     'comments',
  Notification:                'notifications',
  NotificationPreference:      'notification_preferences',
  Announcement:                'announcements',
  Conversation:                'conversations',
  Message:                     'messages',
  User:                        'users',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseSortParam(sort) {
  if (!sort) return 'created_date DESC';
  const desc = sort.startsWith('-');
  const field = sort.replace(/^-/, '').replace(/[^a-zA-Z0-9_]/g, '');
  return `${field} ${desc ? 'DESC' : 'ASC'}`;
}

function buildWhereClause(query, startIdx = 1) {
  const conditions = [];
  const values = [];
  let idx = startIdx;
  for (const [key, val] of Object.entries(query || {})) {
    const safeKey = key.replace(/[^a-zA-Z0-9_]/g, '');
    conditions.push(`${safeKey} = $${idx++}`);
    values.push(val);
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || 'prodintel-dev-secret-change-in-production';

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Auth Routes ─────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = result.rows[0];

  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, full_name, role = 'user' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) return res.status(409).json({ error: 'User already exists' });

  const password_hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  const now = new Date().toISOString();

  const result = await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, created_date, updated_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, email, full_name, role`,
    [id, email, password_hash, full_name || email.split('@')[0], role, now, now]
  );

  const token = jwt.sign(
    { id, email, role, full_name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.status(201).json({ token, user: result.rows[0] });
});

app.post('/api/auth/logout', (_req, res) => res.json({ success: true }));

app.get('/api/auth/me', authenticate, async (req, res) => {
  const result = await pool.query(
    'SELECT id, email, full_name, role, created_date FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(result.rows[0]);
});

app.put('/api/auth/me', authenticate, async (req, res) => {
  const allowed = ['full_name', 'phone', 'profile_image_url'];
  const updates = [];
  const values = [];
  let idx = 1;

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updates.push(`${key} = $${idx++}`);
      values.push(req.body[key]);
    }
  }
  if (updates.length === 0) {
    const r = await pool.query('SELECT id, email, full_name, role FROM users WHERE id = $1', [req.user.id]);
    return res.json(r.rows[0]);
  }
  updates.push(`updated_date = $${idx++}`);
  values.push(new Date().toISOString());
  values.push(req.user.id);

  const result = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, full_name, role`,
    values
  );
  res.json(result.rows[0]);
});

// ─── User management (admin only) ────────────────────────────────────────────

app.get('/api/users', authenticate, async (req, res) => {
  const result = await pool.query('SELECT id, email, full_name, role, created_date FROM users ORDER BY created_date DESC');
  res.json(result.rows);
});

app.put('/api/users/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { role } = req.body;
  const result = await pool.query(
    'UPDATE users SET role = $1, updated_date = $2 WHERE id = $3 RETURNING id, email, full_name, role',
    [role, new Date().toISOString(), req.params.id]
  );
  res.json(result.rows[0]);
});

// ─── Entity CRUD ─────────────────────────────────────────────────────────────

// LIST
app.get('/api/entities/:entity', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: `Unknown entity: ${req.params.entity}` });

  const sort = parseSortParam(req.query.sort);
  const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
  const skip = parseInt(req.query.skip) || 0;

  const result = await pool.query(
    `SELECT * FROM ${table} ORDER BY ${sort} LIMIT $1 OFFSET $2`,
    [limit, skip]
  );
  res.json(result.rows);
});

// GET single
app.get('/api/entities/:entity/:id', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Record not found' });
  res.json(result.rows[0]);
});

// FILTER
app.post('/api/entities/:entity/filter', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const sort = parseSortParam(req.query.sort);
  const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
  const skip = parseInt(req.query.skip) || 0;

  const { where, values } = buildWhereClause(req.body);
  const result = await pool.query(
    `SELECT * FROM ${table} ${where} ORDER BY ${sort} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, limit, skip]
  );
  res.json(result.rows);
});

// CREATE
app.post('/api/entities/:entity', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const now = new Date().toISOString();
  const data = {
    id: uuidv4(),
    created_date: now,
    updated_date: now,
    created_by: req.user.email,
    ...req.body,
  };

  const keys = Object.keys(data);
  const vals = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

  const result = await pool.query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  res.status(201).json(result.rows[0]);
});

// BULK CREATE
app.post('/api/entities/:entity/bulk', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const records = Array.isArray(req.body) ? req.body : [req.body];
  const created = [];

  for (const item of records) {
    const now = new Date().toISOString();
    const data = { id: uuidv4(), created_date: now, updated_date: now, created_by: req.user.email, ...item };
    const keys = Object.keys(data);
    const vals = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals
    );
    created.push(result.rows[0]);
  }
  res.status(201).json(created);
});

// UPDATE
app.put('/api/entities/:entity/:id', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const data = { ...req.body, updated_date: new Date().toISOString() };
  delete data.id;
  delete data.created_date;
  delete data.created_by;

  const keys = Object.keys(data);
  const vals = Object.values(data);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

  const result = await pool.query(
    `UPDATE ${table} SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    [...vals, req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Record not found' });
  res.json(result.rows[0]);
});

// DELETE
app.delete('/api/entities/:entity/:id', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ error: 'Record not found' });
  res.json({ success: true });
});

// DELETE MANY
app.delete('/api/entities/:entity', authenticate, async (req, res) => {
  const table = TABLE_MAP[req.params.entity];
  if (!table) return res.status(404).json({ error: 'Unknown entity' });

  const { where, values } = buildWhereClause(req.body);
  if (!where) return res.status(400).json({ error: 'Delete many requires a query filter' });

  const result = await pool.query(`DELETE FROM ${table} ${where} RETURNING id`, values);
  res.json({ deleted: result.rowCount });
});

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'error', db: err.message });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`\n🎭 ProdIntel StageOps backend running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}\n`);
});