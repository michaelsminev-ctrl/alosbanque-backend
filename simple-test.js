console.log('=== DEMARRAGE TEST NODE.JS ===')

try {
  console.log('1. Import express...')
  const express = await import('express')
  console.log('2. Creation app...')
  const app = express.default()

  console.log('3. Configuration route health...')
  app.get('/health', (req, res) => {
    console.log('Request /health reçue')
    res.json({ ok: true, timestamp: Date.now() })
  })

  console.log('4. Demarrage serveur sur port 3001...')
  const server = app.listen(3001, '127.0.0.1', () => {
    console.log('✅ SERVEUR DEMARRE avec succès sur http://127.0.0.1:3001')
    console.log('Testez avec: http://localhost:3001/health')
  })

  // Gestion d'erreur serveur
  server.on('error', (err) => {
    console.error('❌ ERREUR SERVEUR:', err.message)
    process.exit(1)
  })

  // Maintenir le processus vivant
  process.on('SIGINT', () => {
    console.log('\n🛑 Arrêt du serveur...')
    server.close(() => {
      console.log('✅ Serveur arrêté proprement')
      process.exit(0)
    })
  })
} catch (error) {
  console.error('❌ ERREUR CRITIQUE:', error.message)
  console.error('Stack:', error.stack)
  process.exit(1)
}
