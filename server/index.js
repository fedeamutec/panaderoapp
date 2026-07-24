import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import {
  createAuthorizationUrl,
  disconnect,
  exchangeAuthorizationCode,
  getOrders,
  getStatus,
  syncOrders,
} from './mercadolibre.js'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'

app.use(cors({ origin: [frontendUrl, 'https://panaderoapp.com'], credentials: false }))
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/mercadolibre/status', async (_req, res) => {
  try { res.json(await getStatus()) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/connect', async (_req, res) => {
  try { res.json({ url: await createAuthorizationUrl() }) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/callback', async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query
  if (error) return res.redirect(`${frontendUrl}/?ml=error&message=${encodeURIComponent(errorDescription || error)}`)
  try {
    if (!code) throw new Error('Mercado Libre no devolvió el código de autorización')
    await exchangeAuthorizationCode(String(code), String(state || ''))
    return res.redirect(`${frontendUrl}/?ml=connected`)
  } catch (exchangeError) {
    return res.redirect(`${frontendUrl}/?ml=error&message=${encodeURIComponent(exchangeError.message)}`)
  }
})

app.post('/api/mercadolibre/sync', async (_req, res) => {
  try { res.json(await syncOrders()) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/orders', async (_req, res) => {
  try { res.json(await getOrders()) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/mercadolibre/disconnect', async (_req, res) => {
  try { await disconnect(); res.json({ ok: true }) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.listen(port, () => {
  console.log(`Panadero API: http://localhost:${port}`)
})
