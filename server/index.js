import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import {
  createAuthorizationUrl,
  disconnect,
  exchangeAuthorizationCode,
  getOrderDetail,
  getOrders,
  getStatus,
  syncOrders,
} from './mercadolibre.js'
import { generateCsr, getArcaStatus, readCsr, saveCertificate } from './arca/certificates.js'
import { testArcaConnection } from './arca/wsaa.js'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const allowedOrigins = [...new Set([frontendUrl, 'https://panaderoapp.com', 'http://localhost:5173'])]

app.use(cors({ origin: allowedOrigins, credentials: false }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/arca/status', async (_req, res) => {
  try {
    res.json(await getArcaStatus())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/arca/csr', async (_req, res) => {
  try {
    res.json({ csr: await readCsr(), ...(await getArcaStatus()) })
  } catch (error) {
    res.status(404).json({ error: error.message })
  }
})

app.post('/api/arca/csr', async (_req, res) => {
  try {
    res.json(await generateCsr())
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.post('/api/arca/certificate', async (req, res) => {
  try {
    res.json(await saveCertificate(req.body?.certificate))
  } catch (error) {
    res.status(400).json({ error: error.message })
  }
})

app.post('/api/arca/test-connection', async (_req, res) => {
  try {
    res.json(await testArcaConnection())
  } catch (error) {
    console.error('ARCA test connection error:', error)
    res.status(502).json({
      ok: false,
      connected: false,
      error: error.message,
    })
  }
})

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

app.post('/api/mercadolibre/sync', async (req, res) => {
  try {
    const page = Number(req.query.page || req.body?.page || 1)
    const pageSize = Number(req.query.pageSize || req.body?.pageSize || 50)
    res.json(await syncOrders({ page, pageSize }))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

app.get('/api/mercadolibre/orders', async (_req, res) => {
  try { res.json(await getOrders()) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.get('/api/mercadolibre/order/:id', async (req, res) => {
  try { res.json(await getOrderDetail(req.params.id)) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.post('/api/mercadolibre/disconnect', async (_req, res) => {
  try { await disconnect(); res.json({ ok: true }) } catch (error) { res.status(500).json({ error: error.message }) }
})

app.listen(port, () => {
  console.log(`Panadero API: http://localhost:${port}`)
})
