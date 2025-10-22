import sqlite3Pkg from 'sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlite3 = sqlite3Pkg.verbose()
const dbPath = path.resolve(__dirname, '..', 'bank.db')
const db = new sqlite3.Database(dbPath)

db.all(
  'SELECT id, phone, balance, rub, is_admin as isAdmin FROM users ORDER BY id ASC',
  (err, rows) => {
    if (err) {
      console.error('Erreur lecture DB:', err.message)
      process.exit(1)
    }
    if (!rows || rows.length === 0) {
      console.log('Aucun utilisateur enregistré.')
    } else {
      console.log('Utilisateurs enregistrés:')
      console.table(rows)
    }
    db.close()
  },
)
