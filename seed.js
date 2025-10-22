// Simple seeding script to create an admin user and sample debts
// Usage: node server/seed.js
import sqlite3 from 'sqlite3'
import { open } from 'sqlite'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'server', 'bank.db')

async function ensureSchema(db) {
  // Align with server.js schema. Only create if not exists; columns added by migrations inside server.js.
  await db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    pin TEXT NOT NULL,
    balance REAL DEFAULT 0,
    rub REAL DEFAULT 0,
    is_admin INTEGER DEFAULT 0
  );`)
  await db.exec(`CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    description TEXT,
    owner TEXT NOT NULL,
    buyer TEXT,
    status TEXT DEFAULT 'en_vente',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );`)
}

async function seed() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database })
  await ensureSchema(db)

  // Create or update admin
  const adminPhone = '+33000000001'
  const adminPin = '1234'
  let admin = await db.get('SELECT * FROM users WHERE phone = ?', adminPhone)
  if (!admin) {
    await db.run(
      'INSERT INTO users (phone,pin,balance,is_admin) VALUES (?,?,?,1)',
      adminPhone,
      adminPin,
      10000,
    )
    admin = await db.get('SELECT * FROM users WHERE phone = ?', adminPhone)
    console.log('Created admin user')
  } else {
    await db.run('UPDATE users SET pin = ?, is_admin = 1 WHERE id = ?', adminPin, admin.id)
    console.log('Admin user ensured')
  }

  // Sample non-admin users
  const samples = [
    { phone: '+33000000002', balance: 2500 },
    { phone: '+33000000003', balance: 800 },
    { phone: '+33000000004', balance: 15000 },
  ]
  for (const u of samples) {
    let row = await db.get('SELECT id FROM users WHERE phone = ?', u.phone)
    if (!row) {
      await db.run(
        'INSERT INTO users (phone,pin,balance,is_admin) VALUES (?,?,?,0)',
        u.phone,
        '1111',
        u.balance,
      )
      console.log('Created user', u.phone)
    }
  }

  // Insert sample debts if none (using owner phone references like server expectations)
  const existing = await db.get('SELECT COUNT(*) as c FROM debts')
  if (existing.c === 0) {
    const debtSamples = [
      { owner: adminPhone, amount: 500, description: 'Admin seed debt small' },
      { owner: '+33000000002', amount: 3200, description: 'Project financing tranche' },
      { owner: '+33000000003', amount: 120, description: 'Legacy micro-loan' },
      { owner: '+33000000004', amount: 8700, description: 'Equipment leasing arrangement' },
    ]
    for (const d of debtSamples) {
      await db.run(
        'INSERT INTO debts (amount, description, owner, status) VALUES (?,?,?,"en_vente")',
        d.amount,
        d.description,
        d.owner,
      )
    }
    console.log('Inserted sample debts')
  } else {
    console.log('Debts already present, skipping debt seeding')
  }

  console.log('Seeding complete. Admin login -> phone:', adminPhone, ' pin:', adminPin)
  await db.close()
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
