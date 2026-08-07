import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { certPath, keyPath } from './certificates.js'
import {
  ARCA_CUIT,
  ARCA_ENV,
  ARCA_SERVICE,
  WSAA_REQUEST_TIMEOUT_MS,
  WSAA_TOKEN_SAFETY_SECONDS,
  WSAA_URL,
} from './config.js'

const execFileAsync = promisify(execFile)
const cachedTickets = new Map()
const inFlightTickets = new Map()

function ticketCachePath(service) {
  const safeService = String(service || ARCA_SERVICE).replace(/[^a-zA-Z0-9._-]+/g, '-')
  return path.join(path.dirname(certPath), `wsaa-ticket-${ARCA_ENV}-${safeService}.json`)
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function decodeXml(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function extractTag(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match ? decodeXml(match[1].trim()) : null
}

function extractSoapFault(xml) {
  return extractTag(xml, 'faultstring') || extractTag(xml, 'faultcode') || null
}

function buildLoginTicketRequest(service) {
  const now = Date.now()
  const generationTime = new Date(now - 10 * 60 * 1000).toISOString()
  const expirationTime = new Date(now + 12 * 60 * 60 * 1000).toISOString()
  const uniqueId = Math.floor(now / 1000)

  return `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0">\n  <header>\n    <uniqueId>${uniqueId}</uniqueId>\n    <generationTime>${generationTime}</generationTime>\n    <expirationTime>${expirationTime}</expirationTime>\n  </header>\n  <service>${xmlEscape(service)}</service>\n</loginTicketRequest>`
}

async function assertCredentials() {
  try {
    await Promise.all([fs.access(keyPath), fs.access(certPath)])
  } catch {
    throw new Error('No se encontraron la clave privada y el certificado de ARCA.')
  }
}

async function signLoginTicketRequest(traXml) {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'panadero-wsaa-'))
  const traPath = path.join(tempDirectory, 'login-ticket-request.xml')
  const cmsPath = path.join(tempDirectory, 'login-ticket-request.cms')

  try {
    await fs.writeFile(traPath, traXml, 'utf8')
    await execFileAsync('openssl', [
      'smime', '-sign',
      '-in', traPath,
      '-signer', certPath,
      '-inkey', keyPath,
      '-outform', 'DER',
      '-nodetach',
      '-binary',
      '-out', cmsPath,
    ])
    const cms = await fs.readFile(cmsPath)
    return cms.toString('base64')
  } catch (error) {
    const detail = String(error?.stderr || error?.message || '').trim()
    throw new Error(`No se pudo firmar la solicitud para ARCA${detail ? `: ${detail}` : '.'}`)
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true })
  }
}

function buildSoapEnvelope(cmsBase64) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">\n  <soapenv:Header/>\n  <soapenv:Body>\n    <wsaa:loginCms>\n      <wsaa:in0>${cmsBase64}</wsaa:in0>\n    </wsaa:loginCms>\n  </soapenv:Body>\n</soapenv:Envelope>`
}

async function requestTicketFromWsaa(cmsBase64, service) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WSAA_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(WSAA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      body: buildSoapEnvelope(cmsBase64),
      signal: controller.signal,
    })

    const responseXml = await response.text()
    const fault = extractSoapFault(responseXml)
    if (fault) {
      const duplicateTicket = /ya posee un TA valido/i.test(fault)
      if (duplicateTicket) {
        throw new Error(`ARCA informa que ya existe un ticket válido para ${service}, pero Panadero no tiene una copia local. Esperá a que venza el ticket anterior y probá nuevamente.`)
      }
      throw new Error(`ARCA rechazó la autenticación para ${service}: ${fault}`)
    }
    if (!response.ok) throw new Error(`ARCA respondió con HTTP ${response.status}.`)

    const loginCmsReturn = extractTag(responseXml, 'loginCmsReturn')
    if (!loginCmsReturn) throw new Error('ARCA respondió sin un ticket de acceso válido.')

    const token = extractTag(loginCmsReturn, 'token')
    const sign = extractTag(loginCmsReturn, 'sign')
    const generationTime = extractTag(loginCmsReturn, 'generationTime')
    const expirationTime = extractTag(loginCmsReturn, 'expirationTime')

    if (!token || !sign || !expirationTime) {
      throw new Error('La respuesta de ARCA no contiene token, firma o vencimiento.')
    }

    return {
      token,
      sign,
      generationTime,
      expirationTime,
      service,
      environment: ARCA_ENV,
      cuit: ARCA_CUIT,
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('ARCA tardó demasiado en responder.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function ticketIsUsable(ticket, service) {
  if (!ticket?.token || !ticket?.sign || !ticket?.expirationTime) return false
  if (String(ticket.service) !== String(service)) return false
  if (String(ticket.environment) !== String(ARCA_ENV)) return false
  if (String(ticket.cuit) !== String(ARCA_CUIT)) return false

  const expiration = new Date(ticket.expirationTime).getTime()
  return Number.isFinite(expiration) && expiration - Date.now() > WSAA_TOKEN_SAFETY_SECONDS * 1000
}

async function readPersistedTicket(service) {
  try {
    const ticket = JSON.parse(await fs.readFile(ticketCachePath(service), 'utf8'))
    return ticketIsUsable(ticket, service) ? ticket : null
  } catch {
    return null
  }
}

async function persistTicket(ticket) {
  const targetPath = ticketCachePath(ticket.service)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(ticket, null, 2), { mode: 0o600 })
  await fs.rename(temporaryPath, targetPath)
}

async function removePersistedTicket(service) {
  await fs.rm(ticketCachePath(service), { force: true })
}

async function createTicket(service) {
  await assertCredentials()
  const traXml = buildLoginTicketRequest(service)
  const cmsBase64 = await signLoginTicketRequest(traXml)
  const ticket = await requestTicketFromWsaa(cmsBase64, service)
  cachedTickets.set(service, ticket)
  await persistTicket(ticket)
  return ticket
}

export async function getWsaaTicket({ forceRefresh = false, service = ARCA_SERVICE } = {}) {
  const normalizedService = String(service || ARCA_SERVICE).trim()
  const cachedTicket = cachedTickets.get(normalizedService)
  if (!forceRefresh && ticketIsUsable(cachedTicket, normalizedService)) return cachedTicket

  if (!forceRefresh) {
    const persistedTicket = await readPersistedTicket(normalizedService)
    if (persistedTicket) {
      cachedTickets.set(normalizedService, persistedTicket)
      return persistedTicket
    }
  }

  const existingRequest = inFlightTickets.get(normalizedService)
  if (existingRequest) return existingRequest

  const request = createTicket(normalizedService)
  inFlightTickets.set(normalizedService, request)
  try {
    return await request
  } finally {
    inFlightTickets.delete(normalizedService)
  }
}

export async function clearWsaaTicket({ service } = {}) {
  if (service) {
    const normalizedService = String(service).trim()
    cachedTickets.delete(normalizedService)
    await removePersistedTicket(normalizedService)
    return
  }

  const services = new Set([ARCA_SERVICE, ...cachedTickets.keys()])
  cachedTickets.clear()
  await Promise.all([...services].map((item) => removePersistedTicket(item)))
}

export async function testArcaConnection() {
  const ticket = await getWsaaTicket()
  return {
    ok: true,
    connected: true,
    message: 'Conectado correctamente con ARCA.',
    environment: ticket.environment,
    service: ticket.service,
    cuit: ticket.cuit,
    generationTime: ticket.generationTime,
    expirationTime: ticket.expirationTime,
    tokenFingerprint: crypto.createHash('sha256').update(ticket.token).digest('hex').slice(0, 12),
  }
}
