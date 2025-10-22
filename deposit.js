// Express route for Stripe payment intent
import express from 'express'
import Stripe from 'stripe'
import cors from 'cors'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'your_stripe_secret_key_here', {
  apiVersion: '2022-11-15',
})
const router = express.Router()
router.use(cors())
router.use(express.json())

// POST /api/deposit
router.post('/deposit', async (req, res) => {
  const { amount, card, name } = req.body
  if (!amount || !card || !name) return res.status(400).json({ error: 'Paramètres manquants' })
  try {
    // Validation et parsing sécurisé de la date d'expiration
    let expMonth = 0,
      expYear = 0
    if (typeof card.expiry === 'string' && card.expiry.includes('/')) {
      const [mm, yy] = card.expiry.split('/')
      expMonth = parseInt(mm, 10)
      expYear = parseInt(yy.length === 2 ? '20' + yy : yy, 10)
    }
    if (!expMonth || !expYear) {
      return res.status(400).json({ error: "Date d'expiration invalide (MM/AA)" })
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency: 'eur',
      payment_method_data: {
        type: 'card',
        card: {
          number: card.number,
          exp_month: expMonth,
          exp_year: expYear,
          cvc: card.cvc,
        },
        billing_details: { name },
      },
      confirm: true,
    })
    res.json({ success: true, paymentIntentId: paymentIntent.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
