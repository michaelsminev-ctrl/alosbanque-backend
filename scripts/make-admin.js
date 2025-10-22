import sqlite3Pkg from 'sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlite3 = sqlite3Pkg.verbose()
const dbPath = path.resolve(__dirname, '..', 'bank.db')
const db = new sqlite3.Database(dbPath)

const phone = process.argv[2]
if (!phone) {
  console.error('Usage: node scripts/make-admin.js <phone>')
  process.exit(1)
}

// Ensure is_admin column exists before updating
db.all('PRAGMA table_info(users)', (err, columns) => {
  if (err) {
    console.error('Erreur lecture schéma:', err.message)
    process.exit(1)
  }
  const hasIsAdmin = Array.isArray(columns) && columns.some((c) => c.name === 'is_admin')
  const ensureCol = hasIsAdmin
    ? Promise.resolve()
    : new Promise((resolve, reject) => {
        db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0', (e) => {
          if (e) reject(e)
          else resolve()
        })
      })

  ensureCol
    .then(() => {
      db.run('UPDATE users SET is_admin = 1 WHERE phone = ?', [phone], function (e2) {
        if (e2) {
          console.error('Erreur mise à jour:', e2.message)
          process.exit(1)
        }
        console.log(`Utilisateur ${phone} promu admin (${this.changes} ligne(s) modifiée(s)).`)
        db.close()
      })
    })
    .catch((e) => {
      console.error('Erreur migration is_admin:', e.message)
      process.exit(1)
    })
})
