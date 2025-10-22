// Serveur de test simple
import express from 'express'
const app = express()
const PORT = 3001

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Test server working' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur de test démarré sur http://localhost:${PORT}`)
  console.log('Test health endpoint: http://localhost:3001/health')
})

// Gestion d'erreur
process.on('uncaughtException', (err) => {
  console.error('Erreur non gérée:', err)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('Promise rejetée:', reason)
  process.exit(1)
})
