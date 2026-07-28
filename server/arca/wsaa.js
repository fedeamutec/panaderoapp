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
let cachedTicket = null
let inFlightTicket = null

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

function buildLoginTicketRequest() {
  const now = Date.now()
  const generationTime = new Date(now - 10 * 60 * 1000).toISOString()
  const expirationTime = new Date(now + 12 * 60 * 60 * 1000).toISOString()
  const uniqueId = Math.floor(now / 1000)

  return `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0">\n  <header>\n    <uniqueId>${uniqueId}</uniqueId>\n    <generationTime>${generationTime}</generationTime>\n    <expirationTime>${expirationTime}</expirationTime>\n  </header>\n  <service>${xmlEscape(ARCA_SERVICE)}</service>\n</loginTicketRequest>`
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

async function requestTicketFromWsaa(cmsBase64) {
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
    if (fault) throw new Error(`ARCA rechazó la autenticación: ${fault}`)
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
      service: ARCA_SERVICE,
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

function ticketIsUsable(ticket) {
  if (!ticket?.expirationTime) return false
  const expiration = new Date(ticket.expirationTime).getTime()
  return Number.isFinite(expiration) && expiration - Date.now() > WSAA_TOKEN_SAFETY_SECONDS * 1000
}

async function createTicket() {
  await assertCredentials()
  const traXml = buildLoginTicketRequest()
  const cmsBase64 = await signLoginTicketRequest(traXml)
  const ticket = await requestTicketFromWsaa(cmsBase64)
  cachedTicket = ticket
  return ticket
}

export async function getWsaaTicket({ forceRefresh = false } = {}) {
  if (!forceRefresh && ticketIsUsable(cachedTicket)) return cachedTicket
  if (!forceRefresh && inFlightTicket) return inFlightTicket

  inFlightTicket = createTicket()
  try {
    return await inFlightTicket
  } finally {
    inFlightTicket = null
  }
}

export function clearWsaaTicket() {
  cachedTicket = null
}

export async function testArcaConnection() {
  const ticket = await getWsaaTicket({ forceRefresh: true })
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
