import sqlite3Pkg from 'sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sqlite3 = sqlite3Pkg.verbose()
const dbPath = path.resolve(__dirname, '..', 'bank.db')
const db = new sqlite3.Database(dbPath)

const phone = process.argv[2]
const newPin = process.argv[3]
if (!phone || !newPin) {
  console.error('Usage: node scripts/set-pin.js <phone> <newPin>')
  process.exit(1)
}
if (!/^\d{4,8}$/.test(newPin)) {
  console.error('PIN invalide: utilisez 4 à 8 chiffres (ex: 041020)')
  process.exit(2)
}

db.run('UPDATE users SET pin = ? WHERE phone = ?', [newPin, phone], function (err) {
  if (err) {
    console.error('Erreur mise à jour PIN:', err.message)
    process.exit(1)
  }
  if (this.changes === 0) {
    console.error('Utilisateur introuvable pour le téléphone:', phone)
    process.exit(2)
  }
  console.log(`PIN mis à jour pour ${phone}: ${newPin}`)
  db.close()
})
