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
  console.error('Usage: node scripts/reset-pin.js <phone>')
  process.exit(1)
}

// Generate a 4-digit PIN
const newPin = Math.floor(Math.random() * 10000)
  .toString()
  .padStart(4, '0')

db.run('UPDATE users SET pin = ? WHERE phone = ?', [newPin, phone], function (err) {
  if (err) {
    console.error('Erreur mise à jour PIN:', err.message)
    process.exit(1)
  }
  if (this.changes === 0) {
    console.error('Utilisateur introuvable pour le téléphone:', phone)
    process.exit(2)
  }
  console.log(`Nouveau PIN pour ${phone}: ${newPin}`)
  db.close()
})
