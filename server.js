import express from 'express'
import multer from 'multer'
import depositRouter from './deposit.js'
import sqlite3Pkg from 'sqlite3'
const sqlite3 = sqlite3Pkg.verbose()
import path from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import cors from 'cors'
import fetch from 'node-fetch'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Gestionnaires d'erreurs globaux pour capturer les crashes silencieux
process.on('uncaughtException', (err) => {
  console.error('❌ ERREUR NON GEREE (uncaughtException):', err.message)
  console.error('Stack:', err.stack)
  console.error("Process va s'arrêter...")
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ PROMISE REJETEE (unhandledRejection):', reason)
  console.error('Promise:', promise)
  console.error("Process va s'arrêter...")
  process.exit(1)
})

console.log("✅ Gestionnaires d'erreurs globaux installés")

// Gestionnaire pour l'arrêt du processus
process.on('exit', (code) => {
  console.log(`🛑 PROCESSUS SE TERMINE avec code: ${code}`)
})

process.on('beforeExit', (code) => {
  console.log(`⚠️ AVANT SORTIE avec code: ${code}`)
})

const app = express()
app.use(cors())
const PORT = 3000

app.use(express.json())
app.use('/api', depositRouter)
import depositSimRouter from './deposit-sim.js'
app.use('/api', depositSimRouter)
// Serve the built frontend (Vite) in production so only one server is needed
const distDir = path.resolve(__dirname, '../dist')
app.use(express.static(distDir))
console.log('Static frontend dir:', distDir)

// Serve index.html explicitly for root and SPA client routes
const spaPaths = [
  '/',
  '/signup',
  '/atm',
  '/debt-market',
  '/my-bought-debts',
  '/my-sell-debts',
  '/deposit',
  '/convert-currency',
  '/conversion-success',
  '/admin-panel',
  // Added gambling routes & aliases so direct refresh / prod deep links work
  '/gambling',
  '/gambling-v2',
  '/gamblingv2', // alias without hyphen
  '/gamblongv2', // common typo observed
]
spaPaths.forEach((p) => {
  app.get(p, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
})

// Endpoint pour obtenir le taux EUR/RUB en temps réel
app.get('/rate', async (req, res) => {
  try {
    const fxRes = await fetch('https://open.er-api.com/v6/latest/EUR')
    const fxData = await fxRes.json()
    const rate = fxData.rates && fxData.rates.RUB ? fxData.rates.RUB : 0
    if (!rate || rate <= 0) return res.status(500).json({ error: 'Taux indisponible' })
    res.json({ rate })
  } catch {
    res.status(500).json({ error: 'Erreur récupération taux' })
  }
})

// Connexion à la base SQLite avec auto-réparation résiliente (Windows friendly)
const dbPath = path.resolve(__dirname, 'bank.db')
let db

function runMigrations() {
  if (!db) return
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      pin TEXT NOT NULL,
      balance REAL DEFAULT 0,
      rub REAL DEFAULT 0,
      is_admin INTEGER DEFAULT 0
    )`)
    // Ajout colonnes manquantes
    db.all('PRAGMA table_info(users)', (err, columns) => {
      if (!err && Array.isArray(columns)) {
        const names = columns.map((c) => c.name)
        if (!names.includes('pin'))
          db.run('ALTER TABLE users ADD COLUMN pin TEXT NOT NULL DEFAULT "0000"')
        if (!names.includes('is_admin'))
          db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0')
        if (!names.includes('rub')) db.run('ALTER TABLE users ADD COLUMN rub REAL DEFAULT 0')
      }
    })
    db.run(`CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      description TEXT,
      owner TEXT NOT NULL,
      buyer TEXT,
      status TEXT DEFAULT 'en_vente',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      debtor_phone TEXT,
      debtor_address TEXT,
      creditor_address TEXT,
      creditor_name TEXT,
      identity_doc_path TEXT,
      author_name TEXT
    )`)
    const debtNewCols = [
      { name: 'debtor_phone', def: 'TEXT' },
      { name: 'debtor_address', def: 'TEXT' },
      { name: 'creditor_address', def: 'TEXT' },
      { name: 'creditor_name', def: 'TEXT' },
      { name: 'identity_doc_path', def: 'TEXT' },
      { name: 'author_name', def: 'TEXT' },
    ]
    db.all('PRAGMA table_info(debts)', (err, cols) => {
      if (!err && Array.isArray(cols)) {
        const existing = new Set(cols.map((c) => c.name))
        debtNewCols.forEach((c) => {
          if (!existing.has(c.name)) db.run(`ALTER TABLE debts ADD COLUMN ${c.name} ${c.def}`)
        })
      }
    })
    db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT,
      amount REAL,
      date TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`)
    db.run(`CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      seed TEXT,
      target_multiplier REAL,
      stake REAL NOT NULL,
      cashout_multiplier REAL,
      payout REAL,
      profit REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      cashed_out_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`)

    // Table des revenus du casino (argent perdu par les joueurs)
    db.run(`CREATE TABLE IF NOT EXISTS casino_revenue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_phone TEXT,
      amount_lost REAL NOT NULL,
      game_type TEXT DEFAULT 'gambling',
      bet_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      description TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(bet_id) REFERENCES bets(id)
    )`)
  })

  // Créer un utilisateur de test s'il n'existe pas
  db.get('SELECT * FROM users WHERE phone = ?', ['0783702747'], (err, user) => {
    if (!err && !user) {
      db.run(
        'INSERT INTO users (phone, pin, balance, is_admin) VALUES (?, ?, ?, ?)',
        ['0783702747', '041020', 1000.0, 1],
        (err) => {
          if (!err) {
            console.log('[DB] Utilisateur de test créé: 0783702747 (admin, balance: 1000€)')
          }
        },
      )
    }
  })

  console.log('[DB] Migrations exécutées (tables assurées).')
}

function openDatabase() {
  console.log('[DEBUG] openDatabase() appelée')
  db = new sqlite3.Database(dbPath)
  console.log('[DEBUG] sqlite3.Database créée')
  app.set('db', db)
  console.log('[DEBUG] db attachée à app')
  try {
    console.log('[DEBUG] Tentative PRAGMA quick_check...')
    db.get('PRAGMA quick_check', (err, row) => {
      console.log('[DEBUG] PRAGMA quick_check callback:', { err, row })
      if (err) {
        console.error('[DB] quick_check error -> tentative recréation', err)
        return recreate()
      }
      const result = row && (row.quick_check || row.integrity_check || row[0] || row)
      console.log('[DEBUG] quick_check result:', result)
      if (result !== 'ok') {
        console.error('[DB] quick_check indique un problème:', result)
        return recreate()
      }
      console.log('[DEBUG] Appel runMigrations()')
      runMigrations()
      console.log('[DEBUG] Appel startServerIfNeeded()')
      startServerIfNeeded()
      console.log('[DEBUG] openDatabase() terminée avec succès')
    })
  } catch (e) {
    console.error('[DB] Exception pendant quick_check', e)
    return recreate()
  }
  console.log('[DEBUG] openDatabase() - fin du try block')
}

async function recreate() {
  console.error('\n[DB] Corruption détectée – procédure de recréation...')
  const fs = await import('fs')
  const backupPath = dbPath + '.corrupt-' + Date.now()
  const closePromise = new Promise((resolve) => {
    try {
      db.close(() => resolve())
    } catch {
      resolve()
    }
  })
  await closePromise
  // Petit délai pour Windows afin de libérer le verrou
  await new Promise((r) => setTimeout(r, 120))
  if (fs.existsSync(dbPath)) {
    try {
      fs.renameSync(dbPath, backupPath)
      console.error('[DB] Fichier renommé ->', backupPath)
    } catch (renErr) {
      console.error('[DB] rename échec, tentative copy+unlink', renErr.code)
      try {
        fs.copyFileSync(dbPath, backupPath)
        fs.unlinkSync(dbPath)
        console.error('[DB] Copie + suppression réalisées ->', backupPath)
      } catch (copyErr) {
        console.error('[DB] Echec copy+unlink -> suppression forcée', copyErr.code)
        try {
          fs.unlinkSync(dbPath)
        } catch {}
      }
    }
  }
  // Réouvrir et migrer
  db = new sqlite3.Database(dbPath)
  app.set('db', db)
  console.log('[DB] Nouvelle base vierge ouverte.')
  runMigrations()
  startServerIfNeeded()
}
openDatabase()

let serverStarted = false
function startServerIfNeeded() {
  console.log('[DEBUG] startServerIfNeeded() appelée, serverStarted =', serverStarted)
  if (serverStarted) return
  serverStarted = true
  console.log('[DEBUG] Tentative app.listen...')
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur démarré sur:`)
    console.log(`  - Local:   http://localhost:${PORT}`)
    try {
      const ifaces = os.networkInterfaces()
      const ips = []
      for (const name of Object.keys(ifaces)) {
        for (const info of ifaces[name] || []) {
          if (info && info.family === 'IPv4' && !info.internal) ips.push(info.address)
        }
      }
      if (ips.length) {
        ips.forEach((ip) => console.log(`  - Réseau:  http://${ip}:${PORT}`))
      } else {
        console.log(`  - Réseau:  (aucune IPv4 locale détectée)`)
      }
    } catch (e) {
      console.log('  - Réseau:  (détection IP indisponible)', e?.message || '')
    }
    console.log(`  - All:     http://0.0.0.0:${PORT}`)
    console.log('[DEBUG] ✅ app.listen callback exécuté')
  })

  server.on('error', (err) => {
    console.error('[SERVER] ❌ Erreur serveur:', err.message)
    process.exit(1)
  })

  console.log('[DEBUG] Serveur object créé, setup interval keep-alive...')
  // keep-alive interval (noop) to ensure event loop active if no requests yet
  const keepAliveInterval = setInterval(() => {
    console.log('[DEBUG] Keep-alive tick à', new Date().toISOString())
  }, 60_000)
  console.log('[DEBUG] Keep-alive interval ID:', keepAliveInterval)
  console.log('[DEBUG] startServerIfNeeded() terminée')
}

// Liste toutes les dettes en vente (hors celles de l'utilisateur si phone fourni)
app.get('/debts', (req, res) => {
  const { phone, currency, includeOwn } = req.query
  let target = (currency || 'EUR').toString().toUpperCase()
  let sql = 'SELECT * FROM debts WHERE status = "en_vente"'
  const params = []
  if (phone && !includeOwn) {
    sql += ' AND owner != ?'
    params.push(phone)
  }
  db.all(sql, params, async (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur lecture dettes' })
    if (!rows || rows.length === 0) return res.json([])
    let rates = null
    try {
      if (target !== 'EUR') rates = await getRates('EUR')
    } catch (e) {
      console.error('FX error', e)
    }
    const owners = [...new Set(rows.map((r) => r.owner))]
    const placeholders = owners.map(() => '?').join(',')
    db.all(
      `SELECT phone, balance, rub, is_admin as isAdmin FROM users WHERE phone IN (${placeholders})`,
      owners,
      (uErr, usersRows) => {
        const map = new Map()
        if (!uErr && usersRows) usersRows.forEach((u) => map.set(u.phone, u))
        const enriched = rows.map((d) => {
          const ownerRow = map.get(d.owner)
          const rating = computeDebtRating(d, ownerRow)
          let converted = null
          if (target !== 'EUR' && rates && rates[target]) {
            converted = {
              currency: target,
              value: +(d.amount * rates[target]).toFixed(2),
              rate: rates[target],
            }
          }
          return { ...d, rating, convertedAmount: converted }
        })
        res.json(enriched)
      },
    )
  })
})

// Configuration upload identité
const uploadsDir = path.join(__dirname, 'uploads')
import('fs').then((fs) => {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
})
app.use('/uploads', express.static(uploadsDir))
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ts = Date.now()
    const safe = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')
    cb(null, ts + '_' + safe)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /(png|jpe?g|pdf)$/i.test(file.originalname)
    if (!ok) return cb(new Error('Format accepté: png, jpg, jpeg, pdf'))
    cb(null, true)
  },
})

// Ajouter une dette à vendre (multipart possible)
app.post('/debts', upload.single('identity_doc'), (req, res) => {
  try {
    const {
      amount,
      description,
      owner,
      debtor_phone,
      debtor_address,
      creditor_address,
      creditor_name,
      author_name,
    } = req.body || {}
    if (!amount || !owner || !description || !creditor_name || !author_name)
      return res.status(400).json({ error: 'Champs requis manquants' })
    if (String(description).trim().length < 20)
      return res.status(400).json({ error: 'Description trop courte (min 20 caractères)' })
    if (debtor_phone && !/^\+?[0-9]{6,15}$/.test(debtor_phone))
      return res.status(400).json({ error: 'Format téléphone débiteur invalide' })
    const identityPath = req.file ? '/uploads/' + req.file.filename : null
    db.run(
      `INSERT INTO debts (amount, description, owner, status, debtor_phone, debtor_address, creditor_address, creditor_name, identity_doc_path, author_name)
         VALUES (?, ?, ?, 'en_vente', ?, ?, ?, ?, ?, ?)`,
      [
        amount,
        description,
        owner,
        debtor_phone || null,
        debtor_address || null,
        creditor_address || null,
        creditor_name || null,
        identityPath,
        author_name || null,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: 'Erreur ajout dette' })
        res.json({ id: this.lastID, identity_doc_path: identityPath })
      },
    )
  } catch (e) {
    console.error('POST /debts error', e)
    res.status(500).json({ error: 'Erreur serveur ajout dette' })
  }
})

// Acheter une dette (empêche achat de sa propre dette)
app.post('/debts/buy', (req, res) => {
  const { id, buyer } = req.body
  if (!id || !buyer) return res.status(400).json({ error: 'Paramètres manquants' })
  db.get('SELECT * FROM debts WHERE id = ? AND status = "en_vente"', [id], (err, debt) => {
    if (err || !debt) return res.status(404).json({ error: 'Dette introuvable' })
    if (debt.owner === buyer) return res.status(400).json({ error: 'Auto-achat interdit' })
    db.run(
      'UPDATE debts SET status = "achetee", buyer = ? WHERE id = ?',
      [buyer, id],
      function (err) {
        if (err) return res.status(500).json({ error: 'Erreur achat dette' })
        res.json({ success: true })
      },
    )
  })
})

// Supprimer une dette en vente (seulement propriétaire, status en_vente)
app.delete('/debts/:id', checkPin, (req, res) => {
  const id = req.params.id
  const userPhone = req.query.phone
  db.get('SELECT * FROM debts WHERE id = ?', [id], (err, debt) => {
    if (err) return res.status(500).json({ error: 'Erreur lecture dette' })
    if (!debt) return res.status(404).json({ error: 'Dette introuvable' })
    if (debt.owner !== userPhone) return res.status(403).json({ error: 'Non propriétaire' })
    if (debt.status !== 'en_vente')
      return res.status(400).json({ error: 'Suppression uniquement si en vente' })
    db.run('DELETE FROM debts WHERE id = ?', [id], function (dErr) {
      if (dErr) return res.status(500).json({ error: 'Erreur suppression' })
      res.json({ success: true })
    })
  })
})

// Mes dettes achetées
app.get('/debts/bought/:phone', (req, res) => {
  db.all('SELECT * FROM debts WHERE buyer = ?', [req.params.phone], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erreur lecture' })
    res.json(rows)
  })
})

// Mes dettes en vente
app.get('/debts/sell/:phone', (req, res) => {
  db.all(
    'SELECT * FROM debts WHERE owner = ? AND status = "en_vente"',
    [req.params.phone],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Erreur lecture' })
      res.json(rows)
    },
  )
})
// Conversion euro -> rouble avec taux en ligne
app.post('/convert', async (req, res) => {
  const { phone, amount } = req.body
  if (!phone || typeof amount !== 'number')
    return res.status(400).json({ error: 'Paramètres requis' })
  if (amount <= 0) return res.status(400).json({ error: 'Montant invalide' })
  // Récupérer le taux EUR/RUB en temps réel
  let rate = 0
  try {
    const fxRes = await fetch('https://open.er-api.com/v6/latest/EUR')
    const fxData = await fxRes.json()
    rate = fxData.rates && fxData.rates.RUB ? fxData.rates.RUB : 0
  } catch {
    return res.status(500).json({ error: 'Erreur récupération taux' })
  }
  if (!rate || rate <= 0) return res.status(500).json({ error: 'Taux indisponible' })
  db.get('SELECT id, balance, rub FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    if (user.balance < amount) return res.status(400).json({ error: 'Fonds insuffisants' })
    const newBalance = user.balance - amount
    const rubToAdd = amount * rate
    const newRub = (user.rub || 0) + rubToAdd
    db.run(
      'UPDATE users SET balance = ?, rub = ? WHERE id = ?',
      [newBalance, newRub, user.id],
      function (err) {
        if (err) return res.status(500).json({ error: 'Erreur conversion' })
        db.run(
          'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
          [user.id, 'convert', amount],
          function (err) {
            if (err) return res.status(500).json({ error: 'Erreur transaction' })
            res.json({
              message: 'Conversion effectuée',
              balanceEur: newBalance,
              balanceRub: newRub,
              taux: rate,
            })
          },
        )
      },
    )
  })
})
// (Les migrations sont maintenant déclenchées dans runMigrations après ouverture ou recréation)

// Inscription utilisateur avec PIN
app.post('/register', (req, res) => {
  const { phone, pin } = req.body
  console.log('[REGISTER] Tentative inscription:', { phone, pin: pin ? '***' : 'missing' })

  if (!phone || !pin) {
    console.log('[REGISTER] Rejet: champs manquants')
    return res.status(400).json({ error: 'Numéro et PIN requis' })
  }

  db.run('INSERT INTO users (phone, pin) VALUES (?, ?)', [phone, pin], function (err) {
    if (err) {
      console.error('[REGISTER] Erreur insertion:', err.message)
      return res.status(400).json({ error: 'Ce numéro existe déjà !' })
    }

    console.log('[REGISTER] Succès! userId:', this.lastID, 'phone:', phone)
    res.json({ message: 'Utilisateur inscrit', userId: this.lastID })
  })
})

// Connexion utilisateur (vérifie le PIN)
app.post('/login', (req, res) => {
  const { phone, pin } = req.body
  console.log('[LOGIN] Tentative connexion:', { phone, pin: pin ? '***' : 'missing' })

  if (!phone || !pin) {
    console.log('[LOGIN] Rejet: champs manquants')
    return res.status(400).json({ error: 'Numéro et PIN requis' })
  }

  db.get('SELECT * FROM users WHERE phone = ? AND pin = ?', [phone, pin], (err, user) => {
    if (err) {
      console.error('[LOGIN] Erreur DB:', err)
      return res.status(401).json({ error: 'Erreur base de données' })
    }

    if (!user) {
      console.log('[LOGIN] Utilisateur non trouvé pour:', phone)
      return res.status(401).json({ error: 'Numéro ou PIN incorrect' })
    }

    console.log('[LOGIN] Succès pour:', phone, 'userId:', user.id)
    res.json({ message: 'Connecté', userId: user.id })
  })
})

// Authentification intelligente : inscription automatique OU connexion
app.post('/auth', (req, res) => {
  const { phone, pin } = req.body
  console.log('[AUTH] Tentative auth:', { phone, pin: pin ? '***' : 'missing' })
  
  if (!phone || !pin) {
    console.log('[AUTH] Rejet: champs manquants')
    return res.status(400).json({ error: 'Numéro et PIN requis' })
  }

  // D'abord, essayer de se connecter
  db.get('SELECT * FROM users WHERE phone = ? AND pin = ?', [phone, pin], (err, user) => {
    if (err) {
      console.error('[AUTH] Erreur DB:', err)
      return res.status(500).json({ error: 'Erreur base de données' })
    }

    // Si l'utilisateur existe avec ce PIN : connexion
    if (user) {
      console.log('[AUTH] ✅ Connexion existante:', phone, 'userId:', user.id)
      return res.json({ 
        message: 'Connecté', 
        userId: user.id, 
        isNewUser: false 
      })
    }

    // Sinon, vérifier si le phone existe déjà avec un autre PIN
    db.get('SELECT * FROM users WHERE phone = ?', [phone], (err2, existingUser) => {
      if (err2) {
        console.error('[AUTH] Erreur vérification phone:', err2)
        return res.status(500).json({ error: 'Erreur base de données' })
      }

      // Si le phone existe avec un PIN différent : erreur
      if (existingUser) {
        console.log('[AUTH] ❌ Phone existe avec un autre PIN:', phone)
        return res.status(401).json({ error: 'PIN incorrect pour ce numéro' })
      }

      // Sinon : inscription automatique
      console.log('[AUTH] 🆕 Nouvelle inscription auto:', phone)
      db.run('INSERT INTO users (phone, pin) VALUES (?, ?)', [phone, pin], function (err3) {
        if (err3) {
          console.error('[AUTH] Erreur inscription:', err3.message)
          return res.status(500).json({ error: 'Erreur lors de l\'inscription' })
        }

        console.log('[AUTH] ✅ Inscription réussie! userId:', this.lastID)
        res.json({ 
          message: 'Compte créé et connecté', 
          userId: this.lastID,
          isNewUser: true
        })
      })
    })
  })
})

// Healthcheck simple
app.get('/health', (req, res) => {
  res.json({ ok: true })
})

// Diagnostic endpoint pour voir les utilisateurs (à des fins de debug)
app.get('/debug/users', (req, res) => {
  db.all('SELECT id, phone, balance, is_admin FROM users LIMIT 10', (err, users) => {
    if (err) {
      return res.status(500).json({ error: 'Erreur DB', message: err.message })
    }
    res.json({ count: users.length, users })
  })
})

// Route pour vérifier si un utilisateur est admin
app.get('/is-admin', (req, res) => {
  const { phone, pin } = req.query
  if (!phone || !pin) return res.status(400).json({ error: 'Numéro et PIN requis' })

  db.get('SELECT is_admin FROM users WHERE phone = ? AND pin = ?', [phone, pin], (err, user) => {
    if (err) return res.status(500).json({ error: 'Erreur base de données' })
    if (!user) return res.status(401).json({ error: 'Authentification invalide' })
    res.json({ isAdmin: Number(user.is_admin) === 1 })
  })
})

// Route pour obtenir le solde avec paramètres de requête
app.get('/balance', (req, res) => {
  const { phone, pin } = req.query
  if (!phone || !pin) return res.status(400).json({ error: 'Téléphone et PIN requis' })

  db.get('SELECT balance FROM users WHERE phone = ? AND pin = ?', [phone, pin], (err, user) => {
    if (err) return res.status(500).json({ error: 'Erreur base de données' })
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé ou PIN incorrect' })
    res.json({ balance: user.balance })
  })
})

// Route pour obtenir le solde d'un utilisateur
app.get('/balance/:phone', (req, res) => {
  const { phone } = req.params
  if (!phone) return res.status(400).json({ error: 'Numéro requis' })

  db.get('SELECT balance FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err) return res.status(500).json({ error: 'Erreur base de données' })
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    res.json({ balance: user.balance })
  })
})

// Route de test pour créer un utilisateur de démonstration
app.get('/create-test-user', (req, res) => {
  db.get('SELECT * FROM users WHERE phone = ?', ['0783702747'], (err, user) => {
    if (err) return res.status(500).json({ error: 'Erreur base de données' })
    if (user) return res.json({ message: 'Utilisateur existe déjà', user })

    db.run(
      'INSERT INTO users (phone, pin, balance, is_admin) VALUES (?, ?, ?, ?)',
      ['0783702747', '041020', 1000.0, 1],
      function (err) {
        if (err) return res.status(500).json({ error: 'Erreur création utilisateur' })
        res.json({ message: 'Utilisateur de test créé', id: this.lastID })
      },
    )
  })
}) // Middleware de vérification PIN pour les routes sensibles
function checkPin(req, res, next) {
  try {
    const src =
      req && req.body && typeof req.body === 'object' && 'phone' in req.body
        ? req.body
        : req.query || {}
    const phone = src && src.phone
    const pin = src && src.pin
    if (!phone || !pin) return res.status(401).json({ error: 'Authentification requise' })

    db.get('SELECT * FROM users WHERE phone = ? AND pin = ?', [phone, pin], (err, user) => {
      if (err) {
        console.error('Database error in checkPin:', err)
        return res.status(500).json({ error: 'Erreur base de données' })
      }
      if (!user) return res.status(401).json({ error: 'Authentification invalide' })
      // Attacher l'utilisateur au req pour les middlewares suivants
      req.user = user
      next()
    })
  } catch (error) {
    console.error('Error in checkPin middleware:', error)
    res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// (requireAdmin middleware supprimé car inutilisé)

// Dépôt d'argent
app.post('/deposit', checkPin, (req, res) => {
  const { amount, currentBalance } = req.body || {}
  const user = req.user
  if (typeof amount !== 'number' || amount <= 0)
    return res.status(400).json({ error: 'Montant invalide' })

  // 🔧 NOUVEAU: Utiliser le vrai solde envoyé par le client (incluant dettes gambling)
  const baseBalance = typeof currentBalance === 'number' ? currentBalance : user.balance
  const newBalance = +(baseBalance + amount).toFixed(2)

  console.log(
    `[DEPOSIT] 💰 ${user.phone} - Base: ${baseBalance}€ + Dépôt: ${amount}€ = Nouveau: ${newBalance}€`,
  )
  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Erreur dépôt' })
    db.run(
      'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
      [user.id, 'deposit', amount],
      (tErr) => {
        if (tErr) return res.status(500).json({ error: 'Erreur transaction' })

        console.log(
          `[DEPOSIT] 💰 ${user.phone} - Dépôt: ${amount}€ → Nouveau solde: ${newBalance}€`,
        )

        res.json({
          message: 'Dépôt effectué',
          newBalance,
          // NOUVEAU: Informer le client de forcer la synchronisation gambling
          shouldSyncGambling: true,
          syncTimestamp: Date.now(),
        })
      },
    )
  })
})

// Retrait d'argent
app.post('/withdraw', checkPin, (req, res) => {
  const { amount } = req.body || {}
  const user = req.user
  if (typeof amount !== 'number' || amount <= 0)
    return res.status(400).json({ error: 'Montant invalide' })
  if (user.balance < amount) return res.status(400).json({ error: 'Fonds insuffisants' })
  const newBalance = +(user.balance - amount).toFixed(2)
  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], (err) => {
    if (err) return res.status(500).json({ error: 'Erreur retrait' })
    db.run(
      'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
      [user.id, 'withdraw', amount],
      (tErr) => {
        if (tErr) return res.status(500).json({ error: 'Erreur transaction' })
        res.json({ message: 'Retrait effectué', newBalance })
      },
    )
  })
})

// Crédit/Débit depuis le gambling (synchronisation)
app.post('/credit', checkPin, (req, res) => {
  const { amount, source } = req.body || {}
  const user = req.user

  console.log(`[CREDIT] ${user.phone} - Montant: ${amount}€ - Source: ${source}`)

  if (typeof amount !== 'number') {
    return res.status(400).json({ error: 'Montant invalide' })
  }

  // Calculer le nouveau solde
  const newBalance = +(user.balance + amount).toFixed(2)

  // MODIFICATION: Permettre les soldes négatifs pour les sources de gambling (dettes)
  const isGamblingDebt =
    source &&
    (source.includes('debt') ||
      source.includes('gambling') ||
      source.includes('cashout') ||
      source.includes('bet'))

  if (newBalance < 0 && !isGamblingDebt) {
    console.log(`[CREDIT] Solde négatif bloqué: ${newBalance}€ (source non-gambling)`)
    return res.status(400).json({ error: 'Solde insuffisant' })
  }

  if (newBalance < 0 && isGamblingDebt) {
    console.log(`[CREDIT] 💸 DETTE GAMBLING AUTORISÉE: ${newBalance}€ (source: ${source})`)
  }

  db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], (err) => {
    if (err) {
      console.error('[CREDIT] Erreur update:', err)
      return res.status(500).json({ error: 'Erreur mise à jour solde' })
    }

    // Enregistrer la transaction
    const transactionType = amount >= 0 ? 'gambling_win' : 'gambling_loss'
    db.run(
      'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
      [user.id, transactionType, Math.abs(amount)],
      (tErr) => {
        if (tErr) {
          console.error('[CREDIT] Erreur transaction:', tErr)
          return res.status(500).json({ error: 'Erreur transaction' })
        }

        console.log(`[CREDIT] Succès: ${user.phone} - Nouveau solde: ${newBalance}€`)
        res.json({
          message: amount >= 0 ? 'Gain enregistré' : 'Perte enregistrée',
          newBalance,
          source,
        })
      },
    )
  })
})

// ----------------- Gambling (Crash Game) Balance Integration -----------------
// Hardened version additions (in-progress refactor):
//  - Will add /api prefix & validation (bet/cashout) below
//  - Round authoritative state here; legacy endpoints still below unchanged
//  - Follow-up patch will wrap existing routes.
const crashRound = {
  id: 0,
  seed: null,
  targetMultiplier: null,
  phase: 'idle', // idle|countdown|launch|crashed
  launchAt: 0,
  crashAt: 0,
}
function generateRound() {
  crashRound.id += 1
  crashRound.seed = Math.random().toString(36).slice(2, 12)
  const r = Math.random()
  const t = 1 + Math.pow(1 - Math.log(1 - r), 1.15) * 4
  crashRound.targetMultiplier = +Math.max(1.05, t).toFixed(2)
  crashRound.phase = 'countdown'
  crashRound.launchAt = Date.now() + 4000
  crashRound.crashAt = 0
}
function ensureRoundLoop() {
  if (crashRound.phase === 'idle') generateRound()
}
setInterval(() => {
  const now = Date.now()
  if (crashRound.phase === 'countdown' && now >= crashRound.launchAt) {
    crashRound.phase = 'launch'
    const target = crashRound.targetMultiplier
    const a = 1,
      b = 0.55,
      c = 0.12
    const f = (t) => 1 + a * (Math.exp(b * t) - 1) + c * Math.pow(t, 1.7)
    let lo = 0,
      hi = 60
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2
      if (f(mid) >= target) hi = mid
      else lo = mid
    }
    crashRound.crashAt = Date.now() + hi * 1000
  } else if (crashRound.phase === 'launch' && crashRound.crashAt && now >= crashRound.crashAt) {
    crashRound.phase = 'crashed'

    // NOUVEAU: Calculer les revenus du casino (mises perdues)
    recordCasinoRevenue(crashRound.id)

    setTimeout(() => {
      crashRound.phase = 'idle'
      ensureRoundLoop()
    }, 3000)
  }
}, 300)
ensureRoundLoop()

// Fonction pour enregistrer les revenus du casino (mises perdues)
function recordCasinoRevenue(roundId) {
  console.log(`[CASINO] 💰 Calcul des revenus pour le round ${roundId}`)

  // Trouver toutes les mises non cash-out pour ce round
  db.all(
    `SELECT b.id, b.user_id, b.stake, u.phone
     FROM bets b
     JOIN users u ON b.user_id = u.id
     WHERE b.cashout_multiplier IS NULL
     AND b.created_at >= datetime('now', '-30 seconds')`,
    (err, lostBets) => {
      if (err) {
        console.error('[CASINO] Erreur récupération mises perdues:', err)
        return
      }

      let totalRevenue = 0

      lostBets.forEach((bet) => {
        totalRevenue += bet.stake

        // Enregistrer chaque perte dans casino_revenue
        db.run(
          `INSERT INTO casino_revenue (user_id, user_phone, amount_lost, bet_id, description)
           VALUES (?, ?, ?, ?, ?)`,
          [
            bet.user_id,
            bet.phone,
            bet.stake,
            bet.id,
            `Mise perdue round ${roundId} - x${crashRound.targetMultiplier}`,
          ],
          (insertErr) => {
            if (insertErr) {
              console.error('[CASINO] Erreur enregistrement revenu:', insertErr)
            }
          },
        )

        // Marquer le bet comme perdu
        db.run('UPDATE bets SET profit = ?, cashed_out_at = CURRENT_TIMESTAMP WHERE id = ?', [
          -bet.stake,
          bet.id,
        ])
      })

      if (totalRevenue > 0) {
        console.log(
          `[CASINO] 💰 Revenus round ${roundId}: ${totalRevenue}€ de ${lostBets.length} joueur(s)`,
        )
      }
    },
  )
}

function currentServerMultiplier() {
  if (crashRound.phase !== 'launch') return 1
  const elapsed = (Date.now() - crashRound.launchAt) / 1000
  if (elapsed < 0) return 1
  const a = 1,
    b = 0.55,
    c = 0.12
  return 1 + a * (Math.exp(b * elapsed) - 1) + c * Math.pow(elapsed, 1.7)
}
app.get('/api/gambling/round', (req, res) => {
  res.json({
    id: crashRound.id,
    phase: crashRound.phase,
    seed: crashRound.seed,
    targetMultiplier: crashRound.targetMultiplier,
    launchAt: crashRound.launchAt,
    crashAt: crashRound.crashAt,
    serverNow: Date.now(),
    liveMultiplier: currentServerMultiplier(),
  })
})

// ---- Authoritative gambling endpoints (bet / cashout / history) ----
function handleBet(req, res) {
  const { amount } = req.body || {}
  const phone = req.body?.phone || req.query?.phone
  if (!phone || typeof amount !== 'number')
    return res.status(400).json({ error: 'Paramètres manquants' })
  if (amount <= 0) return res.status(400).json({ error: 'Montant invalide' })
  if (crashRound.phase !== 'countdown')
    return res.status(409).json({ error: 'Round non disponible pour miser' })
  db.get('SELECT id, balance FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    if (user.balance < amount) return res.status(400).json({ error: 'Fonds insuffisants' })
    const newBalance = +(user.balance - amount).toFixed(2)
    db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], function (uErr) {
      if (uErr) return res.status(500).json({ error: 'Erreur débit' })
      db.run(
        'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
        [user.id, 'gamble_bet', amount],
        function (tErr) {
          if (tErr) return res.status(500).json({ error: 'Erreur transaction' })
          db.run(
            'INSERT INTO bets (user_id, seed, target_multiplier, stake) VALUES (?, ?, ?, ?)',
            [user.id, crashRound.seed, crashRound.targetMultiplier, amount],
            function (bErr) {
              if (bErr) return res.status(500).json({ error: 'Erreur enregistrement mise' })
              res.json({
                success: true,
                newBalance,
                betId: this.lastID,
                round: {
                  id: crashRound.id,
                  seed: crashRound.seed,
                  targetMultiplier: crashRound.targetMultiplier,
                },
              })
            },
          )
        },
      )
    })
  })
}
function handleCashout(req, res) {
  const { stake, multiplier } = req.body || {}
  const phone = req.body?.phone || req.query?.phone
  if (!phone || typeof stake !== 'number' || typeof multiplier !== 'number')
    return res.status(400).json({ error: 'Paramètres manquants' })
  if (stake <= 0 || multiplier < 1) return res.status(400).json({ error: 'Valeurs invalides' })
  if (crashRound.phase !== 'launch')
    return res.status(409).json({ error: 'Cashout impossible (phase)' })
  if (multiplier > crashRound.targetMultiplier + 1e-6)
    return res.status(400).json({ error: 'Multiplicateur supérieur au crash' })
  if (Date.now() >= crashRound.crashAt)
    return res.status(409).json({ error: 'Trop tard, round terminé' })
  const payout = +(stake * multiplier).toFixed(2)
  const profit = +(payout - stake).toFixed(2)
  db.get('SELECT id, balance FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    const newBalance = +(user.balance + payout).toFixed(2)
    db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], function (uErr) {
      if (uErr) return res.status(500).json({ error: 'Erreur crédit' })
      db.run(
        'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
        [user.id, 'gamble_cashout', payout],
        function (tErr) {
          if (tErr) return res.status(500).json({ error: 'Erreur transaction' })
          db.get(
            'SELECT id, stake FROM bets WHERE user_id = ? AND cashout_multiplier IS NULL ORDER BY id DESC LIMIT 1',
            [user.id],
            (bErr, bet) => {
              if (!bErr && bet) {
                db.run(
                  'UPDATE bets SET cashout_multiplier = ?, payout = ?, profit = ?, cashed_out_at = CURRENT_TIMESTAMP WHERE id = ?',
                  [multiplier, payout, profit, bet.id],
                )
              }
              res.json({ success: true, newBalance, payout, profit })
            },
          )
        },
      )
    })
  })
}
function handleHistory(req, res) {
  const { phone } = req.params
  db.get('SELECT id FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    db.all(
      'SELECT id, seed, target_multiplier as targetMultiplier, stake, cashout_multiplier as cashoutMultiplier, payout, profit, created_at as createdAt, cashed_out_at as cashedOutAt FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT 50',
      [user.id],
      (bErr, rows) => {
        if (bErr) return res.status(500).json({ error: 'Erreur lecture historique' })
        res.json(rows || [])
      },
    )
  })
}
// Register endpoints (new + legacy)
app.post('/api/gambling/bet', checkPin, handleBet)
app.post('/gambling/bet', checkPin, handleBet)
app.post('/api/gambling/cashout', checkPin, handleCashout)
app.post('/gambling/cashout', checkPin, handleCashout)
app.get('/api/gambling/history/:phone', handleHistory)
app.get('/gambling/history/:phone', handleHistory)

// ---- ENDPOINTS ADMINISTRATEUR ----
// Middleware pour vérifier si l'utilisateur est admin
function checkAdmin(req, res, next) {
  const { phone, pin } = req.body || req.query

  if (!phone || !pin) {
    return res.status(401).json({ error: 'Identifiants requis' })
  }

  db.get('SELECT * FROM users WHERE phone = ? AND pin = ?', [phone, pin], (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Utilisateur non trouvé' })
    }

    // Vérifier si c'est un admin (par exemple, phone spécifique)
    const adminPhones = ['0783702747', '0000000000'] // Ajoutez vos numéros admin ici

    if (!adminPhones.includes(user.phone)) {
      return res.status(403).json({ error: 'Accès administrateur requis' })
    }

    req.user = user
    next()
  })
}

// Statistiques du casino pour admin
app.get('/api/admin/casino-stats', checkAdmin, (req, res) => {
  // Revenus totaux
  db.get('SELECT SUM(amount_lost) as total_revenue FROM casino_revenue', (err, revenueRow) => {
    if (err) return res.status(500).json({ error: 'Erreur revenus' })

    // Revenus par jour (7 derniers jours)
    db.all(
      `SELECT DATE(created_at) as date, SUM(amount_lost) as daily_revenue, COUNT(*) as bets_count
       FROM casino_revenue
       WHERE created_at >= datetime('now', '-7 days')
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      (err2, dailyRevenue) => {
        if (err2) return res.status(500).json({ error: 'Erreur revenus quotidiens' })

        // Top joueurs perdants
        db.all(
          `SELECT user_phone, SUM(amount_lost) as total_lost, COUNT(*) as bets_count
           FROM casino_revenue
           GROUP BY user_phone
           ORDER BY total_lost DESC
           LIMIT 10`,
          (err3, topLosers) => {
            if (err3) return res.status(500).json({ error: 'Erreur top perdants' })

            res.json({
              totalRevenue: revenueRow.total_revenue || 0,
              dailyRevenue: dailyRevenue || [],
              topLosers: topLosers || [],
            })
          },
        )
      },
    )
  })
})

// Liste des utilisateurs pour admin
app.get('/api/admin/users', checkAdmin, (req, res) => {
  db.all(
    `SELECT id, phone, pin, balance, username, created_at,
     (SELECT COUNT(*) FROM bets WHERE user_id = users.id) as total_bets,
     (SELECT SUM(amount_lost) FROM casino_revenue WHERE user_id = users.id) as total_lost
     FROM users
     ORDER BY created_at DESC`,
    (err, users) => {
      if (err) return res.status(500).json({ error: 'Erreur récupération utilisateurs' })

      res.json({
        users: users || [],
        totalUsers: users ? users.length : 0,
      })
    },
  )
})

// Helper: compute rating for a debt
function computeDebtRating(debt, ownerRow) {
  let score = 0
  const reasons = []
  const amount = Number(debt.amount) || 0
  if (amount <= 50) {
    score += 25
    reasons.push({ label: 'Montant faible', points: 25 })
  } else if (amount <= 200) {
    score += 18
    reasons.push({ label: 'Montant modéré', points: 18 })
  } else if (amount <= 500) {
    score += 10
    reasons.push({ label: 'Montant moyen', points: 10 })
  } else {
    score += 2
    reasons.push({ label: 'Montant élevé', points: 2 })
  }

  const balance = ownerRow ? Number(ownerRow.balance) : 0
  if (balance >= 1000) {
    score += 25
    reasons.push({ label: 'Gros solde vendeur', points: 25 })
  } else if (balance >= 300) {
    score += 18
    reasons.push({ label: 'Solde vendeur correct', points: 18 })
  } else if (balance >= 100) {
    score += 10
    reasons.push({ label: 'Solde vendeur moyen', points: 10 })
  } else {
    score += 2
    reasons.push({ label: 'Solde faible vendeur', points: 2 })
  }

  const rub = ownerRow ? Number(ownerRow.rub || 0) : 0
  if (rub >= 500) {
    score += 10
    reasons.push({ label: 'Diversification RUB forte', points: 10 })
  } else if (rub >= 100) {
    score += 6
    reasons.push({ label: 'Diversification RUB', points: 6 })
  } else if (rub > 0) {
    score += 3
    reasons.push({ label: 'Un peu de RUB', points: 3 })
  }

  // Age
  let ageHours = 0
  if (debt.created_at) {
    const created = new Date(debt.created_at)
    ageHours = (Date.now() - created.getTime()) / 36e5
  }
  if (ageHours <= 24) {
    score += 15
    reasons.push({ label: 'Dette récente', points: 15 })
  } else if (ageHours <= 24 * 7) {
    score += 12
    reasons.push({ label: 'Dette < 7j', points: 12 })
  } else if (ageHours <= 24 * 30) {
    score += 6
    reasons.push({ label: 'Dette < 30j', points: 6 })
  } else {
    score += 2
    reasons.push({ label: 'Dette ancienne', points: 2 })
  }

  if (ownerRow && ownerRow.isAdmin) {
    score += 10
    reasons.push({ label: 'Vendeur admin', points: 10 })
  }
  if (debt.status === 'en_vente') {
    score += 5
    reasons.push({ label: 'En vente claire', points: 5 })
  }
  if (debt.description && debt.description.length > 15) {
    score += 5
    reasons.push({ label: 'Description détaillée', points: 5 })
  }

  // Cap score max
  if (score > 100) score = 100
  let grade = 'E'
  if (score >= 80) grade = 'A'
  else if (score >= 65) grade = 'B'
  else if (score >= 50) grade = 'C'
  else if (score >= 35) grade = 'D'

  return { grade, score, reasons }
}

// SPA fallback middleware: serve index.html for non-API, non-asset GET requests
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  const accept = req.headers.accept || ''
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/is-admin') ||
    req.path.startsWith('/health')
  )
    return next()
  // If requesting a file (has extension), let static handle or 404
  if (path.extname(req.path)) return next()
  // Only handle typical browser navigations
  if (!accept.includes('text/html')) return next()
  return res.sendFile(path.join(distDir, 'index.html'))
})

// Simple health endpoint to detect if server is up without auth
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() })
})

// Cache pour les taux de change
let fxCache = { timestamp: 0, base: 'EUR', rates: null }
async function getRates(base = 'EUR') {
  const now = Date.now()
  if (fxCache.rates && now - fxCache.timestamp < 5 * 60 * 1000 && fxCache.base === base) {
    return fxCache.rates
  }
  const resp = await fetch(`https://open.er-api.com/v6/latest/${base}`)
  const data = await resp.json()
  if (!data || data.result === 'error') throw new Error('FX API error')
  fxCache = { timestamp: now, base, rates: data.rates }
  return data.rates
}

// ---------------------- PayPal Integration (0.2% platform fee) ----------------------
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || ''
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || ''
const PAYPAL_BASE = process.env.PAYPAL_BASE || 'https://api-m.sandbox.paypal.com'
// 0.2% fee => 0.002
const PLATFORM_FEE_PCT = Number(process.env.PLATFORM_FEE_PCT || '0.002')

let paypalTokenCache = { token: null, exp: 0 }
async function getPayPalAccessToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error('Missing PayPal credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)')
  }
  const now = Date.now()
  if (paypalTokenCache.token && now < paypalTokenCache.exp) return paypalTokenCache.token
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64')
  const resp = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error('PayPal token error: ' + txt)
  }
  const data = await resp.json()
  paypalTokenCache = { token: data.access_token, exp: now + (data.expires_in - 60) * 1000 }
  return paypalTokenCache.token
}

// Create PayPal order for a debt purchase
app.post('/paypal/create-order', checkPin, async (req, res) => {
  try {
    const db = req.app.get('db')
    const { debtId } = req.body || {}
    const buyerPhone = req.query.phone
    if (!debtId || !buyerPhone) return res.status(400).json({ error: 'Paramètres manquants' })
    db.get('SELECT * FROM debts WHERE id = ?', [debtId], async (err, debt) => {
      if (err) return res.status(500).json({ error: 'Erreur lecture dette' })
      if (!debt) return res.status(404).json({ error: 'Dette inconnue' })
      if (debt.status !== 'en_vente') return res.status(400).json({ error: 'Dette non disponible' })
      if (debt.owner === buyerPhone)
        return res.status(400).json({ error: "Impossible d'acheter sa propre dette" })
      const amount = Number(debt.amount)
      const valueStr = amount.toFixed(2)
      let token
      try {
        token = await getPayPalAccessToken()
      } catch (e) {
        return res.status(500).json({ error: e.message })
      }
      const orderResp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: 'DEBT-' + debtId,
              description: `Achat dette #${debtId}`,
              amount: { currency_code: 'EUR', value: valueStr },
            },
          ],
          application_context: {
            return_url: `http://localhost:5173/paypal-return?debtId=${debtId}`,
            cancel_url: `http://localhost:5173/paypal-cancel`,
          },
        }),
      })
      if (!orderResp.ok) {
        const txt = await orderResp.text()
        return res.status(500).json({ error: 'Erreur création ordre PayPal', details: txt })
      }
      const orderData = await orderResp.json()
      const approveLink = (orderData.links || []).find((l) => l.rel === 'approve')?.href || null
      if (!approveLink) return res.status(500).json({ error: 'Lien approbation introuvable' })
      res.json({ orderId: orderData.id, approvalUrl: approveLink })
    })
  } catch (e) {
    console.error('Error /paypal/create-order:', e)
    res.status(500).json({ error: 'Erreur interne' })
  }
})

// Capture PayPal order & finalize
app.post('/paypal/capture-order', checkPin, async (req, res) => {
  try {
    const db = req.app.get('db')
    const { token: orderId, debtId } = { ...req.body, ...req.query }
    const buyerPhone = req.query.phone
    if (!orderId || !debtId || !buyerPhone)
      return res.status(400).json({ error: 'Paramètres manquants' })
    db.get('SELECT * FROM debts WHERE id = ?', [debtId], async (err, debt) => {
      if (err) return res.status(500).json({ error: 'Erreur lecture dette' })
      if (!debt) return res.status(404).json({ error: 'Dette inconnue' })
      if (debt.owner === buyerPhone)
        return res.status(400).json({ error: 'Achat de sa propre dette interdit' })
      if (debt.status !== 'en_vente') {
        // Idempotence: déjà vendue
        return res.json({ success: true, alreadySold: true, debt })
      }
      let token
      try {
        token = await getPayPalAccessToken()
      } catch (e2) {
        return res.status(500).json({ error: e2.message })
      }
      const capResp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      if (!capResp.ok) {
        const txt = await capResp.text()
        return res.status(500).json({ error: 'Erreur capture PayPal', details: txt })
      }
      const capData = await capResp.json()
      const status = capData.status
      if (status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Ordre non complété', status })
      }
      // Extraire montant capturé
      let capturedValue = null
      try {
        capturedValue = capData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || null
      } catch {}
      if (!capturedValue) {
        return res.status(500).json({ error: 'Montant capture introuvable' })
      }
      const gross = Number(capturedValue)
      const expected = Number(debt.amount)
      if (Math.abs(gross - expected) > 0.01) {
        return res.status(400).json({ error: 'Montant inattendu', gross, expected })
      }
      const fee = +(gross * PLATFORM_FEE_PCT).toFixed(2)
      const net = +(gross - fee).toFixed(2)
      // Effectuer mise à jour atomique (vérifier encore status)
      db.run('BEGIN TRANSACTION', [], (bErr) => {
        if (bErr) return res.status(500).json({ error: 'TX begin failed' })
        db.get('SELECT status FROM debts WHERE id = ? FOR UPDATE', [debtId], (sErr, row) => {
          // SQLite n'a pas FOR UPDATE; on simule juste relecture
          if (sErr) {
            db.run('ROLLBACK')
            return res.status(500).json({ error: 'Erreur vérif status' })
          }
          if (!row || row.status !== 'en_vente') {
            db.run('ROLLBACK')
            return res.json({ success: true, alreadySold: true })
          }
          db.run(
            'UPDATE users SET balance = balance + ? WHERE phone = ?',
            [net, debt.owner],
            (uErr) => {
              if (uErr) {
                db.run('ROLLBACK')
                return res.status(500).json({ error: 'Crédit vendeur échoué' })
              }
              db.run(
                'UPDATE debts SET status = "vendue", buyer = ? WHERE id = ?',
                [buyerPhone, debtId],
                (dErr) => {
                  if (dErr) {
                    db.run('ROLLBACK')
                    return res.status(500).json({ error: 'Maj dette échouée' })
                  }
                  db.run('COMMIT', [], (cErr) => {
                    if (cErr) return res.status(500).json({ error: 'Commit échoué' })
                    return res.json({
                      success: true,
                      debtId,
                      gross,
                      fee,
                      net,
                      feeRate: PLATFORM_FEE_PCT,
                      status: 'vendue',
                    })
                  })
                },
              )
            },
          )
        })
      })
    })
  } catch (e) {
    console.error('Error /paypal/capture-order:', e)
    res.status(500).json({ error: 'Erreur interne capture' })
  }
})
// -------------------------------------------------------------------------------

// ---------------------- Batch PayPal (panier) ----------------------------------
// Mémoire volatile pour associer orderId -> liste dettes & total (dev uniquement)
const batchOrders = new Map()

app.post('/paypal/create-order-batch', checkPin, async (req, res) => {
  try {
    const db = req.app.get('db')
    const { debtIds } = req.body || {}
    const buyerPhone = req.query.phone
    if (!Array.isArray(debtIds) || debtIds.length === 0 || !buyerPhone)
      return res.status(400).json({ error: 'Paramètres manquants' })
    // Récupérer les dettes
    const placeholders = debtIds.map(() => '?').join(',')
    db.all(`SELECT * FROM debts WHERE id IN (${placeholders})`, debtIds, async (err, rows) => {
      if (err) return res.status(500).json({ error: 'Lecture dettes échouée' })
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Dettes introuvables' })
      // Filtrer status/en_vente et non propriétaire
      const valid = rows.filter((d) => d.status === 'en_vente' && d.owner !== buyerPhone)
      if (valid.length === 0) return res.status(400).json({ error: 'Aucune dette achetable' })
      const sum = valid.reduce((acc, d) => acc + Number(d.amount), 0)
      const valueStr = sum.toFixed(2)
      let token
      try {
        token = await getPayPalAccessToken()
      } catch (e) {
        return res.status(500).json({ error: e.message })
      }
      // On encode les ids dans une chaîne (limite longueur description)
      const idsString = valid.map((d) => d.id).join(',')
      const orderResp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: 'DEBTBATCH-' + Date.now(),
              description: `Panier dettes (${idsString})`.substring(0, 120),
              amount: { currency_code: 'EUR', value: valueStr },
              custom_id: idsString.substring(0, 127),
            },
          ],
          application_context: {
            return_url: `http://localhost:5173/paypal-return?debtIds=${encodeURIComponent(
              idsString,
            )}`,
            cancel_url: `http://localhost:5173/paypal-cancel`,
          },
        }),
      })
      if (!orderResp.ok) {
        const txt = await orderResp.text()
        return res.status(500).json({ error: 'Erreur création ordre batch', details: txt })
      }
      const orderData = await orderResp.json()
      const approveLink = (orderData.links || []).find((l) => l.rel === 'approve')?.href || null
      if (!approveLink) return res.status(500).json({ error: 'Lien approbation introuvable' })
      batchOrders.set(orderData.id, { debtIds: valid.map((d) => d.id), total: sum })
      res.json({ orderId: orderData.id, approvalUrl: approveLink })
    })
  } catch (e) {
    console.error('Error /paypal/create-order-batch:', e)
    res.status(500).json({ error: 'Erreur interne batch create' })
  }
})

app.post('/paypal/capture-order-batch', checkPin, async (req, res) => {
  try {
    const db = req.app.get('db')
    const { token: orderId } = { ...req.body, ...req.query }
    const buyerPhone = req.query.phone
    if (!orderId || !buyerPhone) return res.status(400).json({ error: 'Paramètres manquants' })
    const meta = batchOrders.get(orderId)
    if (!meta) return res.status(400).json({ error: 'Batch inconnu ou expiré' })
    let token
    try {
      token = await getPayPalAccessToken()
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
    const capResp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    if (!capResp.ok) {
      const txt = await capResp.text()
      return res.status(500).json({ error: 'Erreur capture batch', details: txt })
    }
    const capData = await capResp.json()
    if (capData.status !== 'COMPLETED')
      return res.status(400).json({ error: 'Ordre non complété', status: capData.status })
    const gross = Number(
      capData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || meta.total,
    )
    if (Math.abs(gross - meta.total) > 0.05) {
      return res.status(400).json({ error: 'Montant inattendu', gross, expected: meta.total })
    }
    const results = []
    let totalFee = 0
    let totalNet = 0
    for (const debtId of meta.debtIds) {
      // Lire la dette
      const row = await new Promise((resolve) => {
        db.get('SELECT * FROM debts WHERE id = ?', [debtId], (err, r) => resolve(err ? null : r))
      })
      if (!row || row.status !== 'en_vente' || row.owner === buyerPhone) {
        results.push({ debtId, skipped: true })
        continue
      }
      const amount = Number(row.amount)
      const fee = +(amount * PLATFORM_FEE_PCT).toFixed(2)
      const net = +(amount - fee).toFixed(2)
      totalFee += fee
      totalNet += net
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET balance = balance + ? WHERE phone = ?',
          [net, row.owner],
          (uErr) => (uErr ? reject(uErr) : resolve(true)),
        )
      })
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE debts SET status = "vendue", buyer = ? WHERE id = ?',
          [buyerPhone, debtId],
          (dErr) => (dErr ? reject(dErr) : resolve(true)),
        )
      })
      results.push({ debtId, gross: amount, fee, net, status: 'vendue' })
    }
    batchOrders.delete(orderId)
    res.json({
      success: true,
      debts: results,
      totalGross: gross,
      totalFee: +totalFee.toFixed(2),
      totalNet: +totalNet.toFixed(2),
      feeRate: PLATFORM_FEE_PCT,
    })
  } catch (e) {
    console.error('Error /paypal/capture-order-batch:', e)
    res.status(500).json({ error: 'Erreur interne capture batch' })
  }
})

// ---------------------- Crypto (simulation) ------------------------------------
// Simple simulation (AUCUNE vraie blockchain): on prépare une adresse fictive et on confirme.
const cryptoSessions = new Map() // address -> { debtIds, total, buyer, exp }
function randomAddress() {
  return 'CRYPTO_' + Math.random().toString(36).slice(2, 12).toUpperCase()
}

app.post('/crypto/prepare', checkPin, (req, res) => {
  const db = req.app.get('db')
  const { debtIds } = req.body || {}
  const buyerPhone = req.query.phone
  if (!Array.isArray(debtIds) || debtIds.length === 0 || !buyerPhone)
    return res.status(400).json({ error: 'Paramètres manquants' })
  const placeholders = debtIds.map(() => '?').join(',')
  db.all(`SELECT * FROM debts WHERE id IN (${placeholders})`, debtIds, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Lecture dettes échouée' })
    const valid = rows.filter((d) => d.status === 'en_vente' && d.owner !== buyerPhone)
    if (valid.length === 0) return res.status(400).json({ error: 'Aucune dette achetable' })
    const total = valid.reduce((a, d) => a + Number(d.amount), 0)
    const address = randomAddress()
    cryptoSessions.set(address, {
      debtIds: valid.map((d) => d.id),
      total,
      buyer: buyerPhone,
      exp: Date.now() + 10 * 60 * 1000,
    })
    res.json({
      address,
      total: +total.toFixed(2),
      feeRate: PLATFORM_FEE_PCT,
      expiresInSec: 600,
      debts: valid.map((d) => ({ id: d.id, amount: d.amount })),
    })
  })
})

app.post('/crypto/confirm', checkPin, async (req, res) => {
  try {
    const db = req.app.get('db')
    const { address } = req.body || {}
    const buyerPhone = req.query.phone
    if (!address || !buyerPhone) return res.status(400).json({ error: 'Paramètres manquants' })
    const session = cryptoSessions.get(address)
    if (!session) return res.status(400).json({ error: 'Session inconnue' })
    if (session.exp < Date.now()) {
      cryptoSessions.delete(address)
      return res.status(400).json({ error: 'Session expirée' })
    }
    if (session.buyer !== buyerPhone) return res.status(400).json({ error: 'Acheteur invalide' })
    const results = []
    let totalFee = 0
    let totalNet = 0
    for (const debtId of session.debtIds) {
      const row = await new Promise((resolve) => {
        db.get('SELECT * FROM debts WHERE id = ?', [debtId], (err, r) => resolve(err ? null : r))
      })
      if (!row || row.status !== 'en_vente' || row.owner === buyerPhone) {
        results.push({ debtId, skipped: true })
        continue
      }
      const amount = Number(row.amount)
      const fee = +(amount * PLATFORM_FEE_PCT).toFixed(2)
      const net = +(amount - fee).toFixed(2)
      totalFee += fee
      totalNet += net
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET balance = balance + ? WHERE phone = ?',
          [net, row.owner],
          (uErr) => (uErr ? reject(uErr) : resolve(true)),
        )
      })
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE debts SET status = "vendue", buyer = ? WHERE id = ?',
          [buyerPhone, debtId],
          (dErr) => (dErr ? reject(dErr) : resolve(true)),
        )
      })
      results.push({ debtId, gross: amount, fee, net, status: 'vendue' })
    }
    cryptoSessions.delete(address)
    res.json({
      success: true,
      debts: results,
      totalGross: session.total,
      totalFee: +totalFee.toFixed(2),
      totalNet: +totalNet.toFixed(2),
      feeRate: PLATFORM_FEE_PCT,
      method: 'crypto-sim',
    })
  } catch (e) {
    console.error('Error /crypto/confirm:', e)
    res.status(500).json({ error: 'Erreur interne crypto confirm' })
  }
})
// -------------------------------------------------------------------------------

// Alias /api for existing balance route if not already namespaced
app.get('/api/balance/:phone', (req, res) => {
  // Forward internally to existing handler if duplicate
  const phone = req.params.phone
  db.get('SELECT balance, rub FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    res.json({ balance: user.balance, rub: user.rub || 0 })
  })
})

// Structured 404 JSON handler (keep last)
app.use((req, res) => {
  console.warn('[404]', req.method, req.originalUrl)
  res.status(404).json({ error: 'Ressource introuvable', path: req.originalUrl })
})

// (app.listen déclenché dynamiquement après migrations)
