console.log('=== SERVEUR DEBUG MINIMAL ===')

// Gestionnaires d'erreurs globaux
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err.message)
  console.error('Stack:', err.stack)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:', reason)
  process.exit(1)
})

process.on('exit', (code) => {
  console.log(`🛑 PROCESSUS SE TERMINE avec code: ${code}`)
})

process.on('beforeExit', (code) => {
  console.log(`⚠️ AVANT SORTIE avec code: ${code}`)
})

try {
  console.log('1. Import express...')
  const express = (await import('express')).default

  console.log('2. Création app...')
  const app = express()

  console.log('3. Configuration routes...')
  app.get('/health', (req, res) => {
    console.log('Request /health reçue à', new Date().toISOString())
    res.json({ ok: true, timestamp: Date.now() })
  })

  app.get('/balance/:phone', (req, res) => {
    console.log('Request /balance reçue pour:', req.params.phone)
    res.json({ balance: 1000, phone: req.params.phone })
  })

  console.log('4. Démarrage serveur...')
  const server = app.listen(3000, '0.0.0.0', () => {
    console.log('✅ SERVEUR DEBUG DÉMARRÉ SUR:')
    console.log('  - Local:   http://localhost:3000')
    console.log('  - Network: http://0.0.0.0:3000')
    console.log('  - Health:  http://localhost:3000/health')
  })

  server.on('error', (err) => {
    console.error('❌ ERREUR SERVEUR:', err.message)
    process.exit(1)
  })

  // Keep-alive
  const keepAlive = setInterval(() => {
    console.log('[KEEP-ALIVE]', new Date().toISOString())
  }, 30_000)

  console.log('5. Serveur configuré avec keep-alive interval:', keepAlive)
} catch (error) {
  console.error('❌ ERREUR FATALE:', error.message)
  console.error('Stack:', error.stack)
  process.exit(1)
}
