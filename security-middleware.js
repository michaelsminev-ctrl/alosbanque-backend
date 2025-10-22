/**
 * MIDDLEWARE DE SÉCURISATION AVANCÉE
 * Protection contre les hackers, injections SQL, XSS, CSRF, DoS
 */

const rateLimit = require('express-rate-limit')
const helmet = require('helmet')
const validator = require('validator')
const DOMPurify = require('isomorphic-dompurify')

// Configuration de sécurité ultra-renforcée
const securityConfig = {
  rateLimiting: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limite à 100 requêtes par fenêtre
    message: {
      error: 'Trop de requêtes',
      message: 'Limite de débit dépassée. Réessayez dans 15 minutes.',
      code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
  },

  inputValidation: {
    maxLength: 1000,
    allowedCharacters: /^[a-zA-Z0-9\s\-_.@!?,:;()\[\]{}'"À-ÿ]*$/,
    forbiddenPatterns: [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /eval\s*\(/gi,
      /document\./gi,
      /window\./gi,
      /\${/g,
      /<%/g,
      /%>/g,
      /(union|select|insert|delete|drop|create|alter|exec|execute)\s+/gi,
    ],
  },
}

/**
 * Middleware de limitation de débit
 */
const createRateLimit = (options = {}) => {
  return rateLimit({
    ...securityConfig.rateLimiting,
    ...options,
  })
}

/**
 * Middleware de sécurisation Helmet
 */
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
})

/**
 * Sanitisation avancée des inputs
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return ''

  // 1. Limitation de longueur
  if (input.length > securityConfig.inputValidation.maxLength) {
    throw new Error(`Input trop long (max ${securityConfig.inputValidation.maxLength} caractères)`)
  }

  // 2. Suppression des caractères de contrôle
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '')

  // 3. Vérification des patterns interdits
  for (const pattern of securityConfig.inputValidation.forbiddenPatterns) {
    if (pattern.test(sanitized)) {
      throw new Error('Contenu malveillant détecté')
    }
  }

  // 4. Vérification des caractères autorisés
  if (!securityConfig.inputValidation.allowedCharacters.test(sanitized)) {
    throw new Error('Caractères non autorisés détectés')
  }

  // 5. Purification DOMPurify
  sanitized = DOMPurify.sanitize(sanitized, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  })

  // 6. Échappement HTML
  sanitized = validator.escape(sanitized)

  return sanitized.trim()
}

/**
 * Validation des données de mise
 */
function validateBetData(data) {
  const errors = []

  // Validation du montant
  if (!data.amount || !validator.isFloat(data.amount.toString(), { min: 0.01, max: 10000 })) {
    errors.push('Montant de mise invalide')
  }

  // Validation de l'ID joueur
  if (!data.playerId || !validator.isAlphanumeric(data.playerId.replace(/[-_]/g, ''))) {
    errors.push('ID joueur invalide')
  }

  // Validation du nom du joueur
  if (data.playerName) {
    try {
      data.playerName = sanitizeInput(data.playerName)
      if (data.playerName.length < 2 || data.playerName.length > 20) {
        errors.push('Nom de joueur invalide (2-20 caractères)')
      }
    } catch (error) {
      errors.push('Nom de joueur contient du contenu malveillant')
    }
  }

  if (errors.length > 0) {
    throw new Error(`Données invalides: ${errors.join(', ')}`)
  }

  return data
}

/**
 * Validation des messages de chat
 */
function validateChatMessage(data) {
  const errors = []

  // Validation du message
  if (!data.text) {
    errors.push('Message vide')
  } else {
    try {
      data.text = sanitizeInput(data.text)
      if (data.text.length < 1 || data.text.length > 150) {
        errors.push('Message invalide (1-150 caractères)')
      }
    } catch (error) {
      errors.push('Message contient du contenu malveillant')
    }
  }

  // Validation de l'ID joueur
  if (!data.playerId || !validator.isAlphanumeric(data.playerId.replace(/[-_]/g, ''))) {
    errors.push('ID joueur invalide')
  }

  // Validation du nom du joueur
  if (data.playerName) {
    try {
      data.playerName = sanitizeInput(data.playerName)
    } catch (error) {
      errors.push('Nom de joueur contient du contenu malveillant')
    }
  }

  if (errors.length > 0) {
    throw new Error(`Message invalide: ${errors.join(', ')}`)
  }

  return data
}

/**
 * Middleware de détection d'attaques
 */
function detectAttacks(req, res, next) {
  const suspiciousPatterns = [
    /\.\.\//g,
    /etc\/passwd/gi,
    /cmd\.exe/gi,
    /powershell/gi,
    /bash/gi,
    /rm\s+-rf/gi,
    /<iframe/gi,
    /<embed/gi,
    /<object/gi,
  ]

  const requestData = JSON.stringify({
    query: req.query,
    body: req.body,
    headers: req.headers,
  })

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestData)) {
      console.error(
        `🚨 ATTAQUE DÉTECTÉE: ${pattern} - IP: ${req.ip} - User-Agent: ${req.get('User-Agent')}`,
      )
      return res.status(403).json({
        error: 'Activité suspecte détectée',
        code: 'SUSPICIOUS_ACTIVITY',
        timestamp: new Date().toISOString(),
      })
    }
  }

  next()
}

/**
 * Middleware de logging sécurisé
 */
function securityLogger(req, res, next) {
  const startTime = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - startTime
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      statusCode: res.statusCode,
      duration: duration,
      contentLength: res.get('Content-Length') || 0,
    }

    // Log des requêtes suspectes
    if (res.statusCode >= 400 || duration > 5000) {
      console.warn('🔍 REQUÊTE SUSPECTE:', logData)
    }
  })

  next()
}

/**
 * Protection CSRF
 */
function csrfProtection(req, res, next) {
  // Vérifier l'origine pour les requêtes sensibles
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.get('Origin') || req.get('Referer')
    const allowedOrigins = [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5174',
    ]

    if (!origin || !allowedOrigins.some((allowed) => origin.startsWith(allowed))) {
      console.error(`🚨 CSRF DÉTECTÉ: Origin non autorisée: ${origin} - IP: ${req.ip}`)
      return res.status(403).json({
        error: 'Origine non autorisée',
        code: 'CSRF_DETECTED',
      })
    }
  }

  next()
}

module.exports = {
  createRateLimit,
  securityHeaders,
  sanitizeInput,
  validateBetData,
  validateChatMessage,
  detectAttacks,
  securityLogger,
  csrfProtection,
}
