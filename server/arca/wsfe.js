import { ARCA_CUIT, ARCA_ENV, WSAA_REQUEST_TIMEOUT_MS } from './config.js'
import { getWsaaTicket } from './wsaa.js'

const WSFE_URL = ARCA_ENV === 'production'
  ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
  : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'

const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/'

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
  return match ? decodeXml(match[1].trim()) : null
}

function extractBlocks(xml, tag) {
  return [...String(xml).matchAll(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'gi'))]
    .map((match) => match[1])
}

function extractMessages(xml, containerTag, itemTag) {
  const container = extractTag(xml, containerTag)
  if (!container) return []

  return extractBlocks(container, itemTag).map((block) => ({
    code: Number(extractTag(block, 'Code')),
    message: extractTag(block, 'Msg') || '',
  }))
}

function buildAuth(ticket) {
  return `<Auth>\n<Token>${xmlEscape(ticket.token)}</Token>\n<Sign>${xmlEscape(ticket.sign)}</Sign>\n<Cuit>${xmlEscape(ARCA_CUIT)}</Cuit>\n</Auth>`
}

function buildEnvelope(operation, body) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n  <soap:Body>\n    <${operation} xmlns="${WSFE_NAMESPACE}">\n${body}\n    </${operation}>\n  </soap:Body>\n</soap:Envelope>`
}

async function callWsfe(operation, bodyBuilder) {
  const ticket = await getWsaaTicket()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WSAA_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(WSFE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: `"${WSFE_NAMESPACE}${operation}"`,
      },
      body: buildEnvelope(operation, bodyBuilder(ticket)),
      signal: controller.signal,
    })

    const responseXml = await response.text()
    const fault = extractTag(responseXml, 'faultstring') || extractTag(responseXml, 'faultcode')
    if (fault) throw new Error(`WSFE rechazó la solicitud: ${fault}`)
    if (!response.ok) throw new Error(`WSFE respondió con HTTP ${response.status}.`)

    const errors = extractMessages(responseXml, 'Errors', 'Err')
    if (errors.length) {
      throw new Error(errors.map((item) => `${item.code}: ${item.message}`).join(' | '))
    }

    return {
      xml: responseXml,
      events: extractMessages(responseXml, 'Events', 'Evt'),
      ticket,
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('WSFE tardó demasiado en responder.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function getPointsOfSale() {
  const { xml, events, ticket } = await callWsfe('FEParamGetPtosVenta', (currentTicket) => buildAuth(currentTicket))

  const pointsOfSale = extractBlocks(xml, 'PtoVenta').map((block) => ({
    number: Number(extractTag(block, 'Nro')),
    emissionType: extractTag(block, 'EmisionTipo'),
    blocked: extractTag(block, 'Bloqueado'),
    disabledDate: extractTag(block, 'FchBaja') || null,
  }))

  return {
    ok: true,
    environment: ARCA_ENV,
    cuit: ARCA_CUIT,
    service: ticket.service,
    pointsOfSale,
    events,
  }
}

export async function getVoucherTypes() {
  const { xml, events } = await callWsfe('FEParamGetTiposCbte', (ticket) => buildAuth(ticket))

  const voucherTypes = extractBlocks(xml, 'CbteTipo').map((block) => ({
    id: Number(extractTag(block, 'Id')),
    description: extractTag(block, 'Desc'),
    validFrom: extractTag(block, 'FchDesde') || null,
    validTo: extractTag(block, 'FchHasta') || null,
  }))

  return { ok: true, environment: ARCA_ENV, voucherTypes, events }
}

export async function getLastAuthorizedVoucher({ pointOfSale, voucherType }) {
  const ptoVta = Number(pointOfSale)
  const cbteTipo = Number(voucherType)

  if (!Number.isInteger(ptoVta) || ptoVta <= 0) {
    throw new Error('El punto de venta debe ser un número entero mayor que cero.')
  }
  if (!Number.isInteger(cbteTipo) || cbteTipo <= 0) {
    throw new Error('El tipo de comprobante debe ser un número entero mayor que cero.')
  }

  const { xml, events } = await callWsfe('FECompUltimoAutorizado', (ticket) => `${buildAuth(ticket)}\n<PtoVta>${ptoVta}</PtoVta>\n<CbteTipo>${cbteTipo}</CbteTipo>`)

  const returnedPointOfSale = Number(extractTag(xml, 'PtoVta'))
  const returnedVoucherType = Number(extractTag(xml, 'CbteTipo'))
  const lastVoucherNumber = Number(extractTag(xml, 'CbteNro'))

  return {
    ok: true,
    environment: ARCA_ENV,
    pointOfSale: returnedPointOfSale,
    voucherType: returnedVoucherType,
    lastVoucherNumber,
    nextVoucherNumber: lastVoucherNumber + 1,
    events,
  }
}
