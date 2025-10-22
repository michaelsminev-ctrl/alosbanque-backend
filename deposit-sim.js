import express from 'express'
const router = express.Router()

// POST /api/deposit-sim
router.post('/deposit-sim', (req, res) => {
  const { phone, amount } = req.body
  if (!phone || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Paramètres invalides' })
  }
  // Accès à la base SQLite
  const db = req.app.get('db')
  db.get('SELECT id, balance FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'Utilisateur non trouvé' })
    const newBalance = user.balance + amount
    db.run('UPDATE users SET balance = ? WHERE id = ?', [newBalance, user.id], function (err) {
      if (err) return res.status(500).json({ error: 'Erreur crédit' })
      db.run(
        'INSERT INTO transactions (user_id, type, amount) VALUES (?, ?, ?)',
        [user.id, 'depot', amount],
        function (err) {
          if (err) return res.status(500).json({ error: 'Erreur transaction' })
          res.json({ success: true, newBalance })
        },
      )
    })
  })
})

export default router
