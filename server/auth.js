import crypto from 'node:crypto'

const COOKIE_NAME = 'panadero_session'
const SESSION_DURATION_SECONDS = Number(process.env.PANADERO_SESSION_HOURS || 12) * 60 * 60

function getConfig() {
  const email = String(process.env.PANADERO_ADMIN_EMAIL || '').trim().toLowerCase()
  const password = String(process.env.PANADERO_ADMIN_PASSWORD || '')
  const secret = String(process.env.PANADERO_SESSION_SECRET || '')

  if (!email) throw new Error('Falta PANADERO_ADMIN_EMAIL.')
  if (!password || password.length < 8) throw new Error('PANADERO_ADMIN_PASSWORD debe tener al menos 8 caracteres.')
  if (secret.length < 32) throw new Error('PANADERO_SESSION_SECRET debe tener al menos 32 caracteres.')

  return { email, password, secret }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  if (leftBuffer.length !== rightBuffer.length) return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url')
}

function encodeSession(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded, secret)}`
}

function decodeSession(token, secret) {
  if (!token || !token.includes('.')) return null
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature || !safeEqual(signature, sign(encoded, secret))) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!payload?.email || !payload?.expiresAt || payload.expiresAt <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        if (index === -1) return [part, '']
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      })
  )
}

function cookieOptions(maxAge = SESSION_DURATION_SECONDS) {
  const secure = process.env.NODE_ENV === 'production'
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ].filter(Boolean)
}

export function authenticate(email, password) {
  const config = getConfig()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!safeEqual(normalizedEmail, config.email) || !safeEqual(String(password || ''), config.password)) {
    return null
  }

  return {
    email: config.email,
    name: 'Fede Amurin',
    role: 'Administrador',
  }
}

export function createSessionCookie(user) {
  const { secret } = getConfig()
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000
  const token = encodeSession({ email: user.email, name: user.name, role: user.role, expiresAt }, secret)
  const parts = cookieOptions()
  parts[0] = `${COOKIE_NAME}=${encodeURIComponent(token)}`
  return { header: parts.join('; '), expiresAt }
}

export function clearSessionCookie() {
  return cookieOptions(0).join('; ')
}

export function getSession(req) {
  const { secret } = getConfig()
  const cookies = parseCookies(req.headers.cookie)
  return decodeSession(cookies[COOKIE_NAME], secret)
}

export function requireAuth(req, res, next) {
  try {
    const session = getSession(req)
    if (!session) return res.status(401).json({ ok: false, error: 'Sesión no válida o vencida.' })
    req.user = session
    next()
  } catch (error) {
    console.error('Authentication configuration error:', error)
    res.status(503).json({ ok: false, error: 'El acceso de Panadero todavía no está configurado.' })
  }
}
