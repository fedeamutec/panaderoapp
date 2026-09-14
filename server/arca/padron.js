import { ARCA_CUIT, ARCA_ENV, ARCA_PADRON_SERVICE, WSAA_REQUEST_TIMEOUT_MS } from './config.js'
import { getWsaaTicket } from './wsaa.js'

const PADRON_URL = ARCA_ENV === 'production'
  ? 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5'
  : 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5'
const PADRON_NAMESPACE = 'http://a5.soap.ws.server.puc.sr/'

export function normalizeCuit(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length === 11 ? digits : ''
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
  const match = String(xml).match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'))
  return match ? decodeXml(match[1].trim()) : ''
}

function buildEnvelope(ticket, cuit) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="${PADRON_NAMESPACE}">
  <soapenv:Body>
    <a5:getPersona_v2>
      <a5:token>${xmlEscape(ticket.token)}</a5:token>
      <a5:sign>${xmlEscape(ticket.sign)}</a5:sign>
      <a5:cuitRepresentada>${xmlEscape(ARCA_CUIT)}</a5:cuitRepresentada>
      <a5:idPersona>${xmlEscape(cuit)}</a5:idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`
}

export async function getPersonaByCuit(value) {
  const cuit = normalizeCuit(value)
  if (!cuit) throw new Error('El CUIT del receptor debe tener 11 dígitos.')

  const ticket = await getWsaaTicket({ service: ARCA_PADRON_SERVICE })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WSAA_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(PADRON_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `${PADRON_NAMESPACE}getPersona_v2`,
      },
      body: buildEnvelope(ticket, cuit),
      signal: controller.signal,
    })
    const xml = await response.text()
    const fault = extractTag(xml, 'faultstring') || extractTag(xml, 'faultcode')
    if (fault) throw new Error(`El padrón ARCA rechazó la consulta: ${fault}`)
    if (!response.ok) throw new Error(`El padrón ARCA respondió con HTTP ${response.status}.`)

    const legalName = extractTag(xml, 'denominacion') || extractTag(xml, 'Denominacion') || extractTag(xml, 'razonSocial')
    if (!legalName) throw new Error('El padrón ARCA no devolvió una razón social para ese CUIT.')
    return { cuit, legalName, source: 'arca-padron', service: ticket.service }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('El padrón ARCA tardó demasiado en responder.', { cause: error })
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
