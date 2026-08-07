import { ARCA_CUIT, ARCA_ENV, WSAA_REQUEST_TIMEOUT_MS } from './config.js'
import { getWsaaTicket } from './wsaa.js'

const PADRON_SERVICE = 'ws_sr_constancia_inscripcion'
const PADRON_URL = ARCA_ENV === 'production'
  ? 'https://aws.arca.gov.ar/sr-padron/webservices/personaServiceA5'
  : 'https://awshomo.arca.gov.ar/sr-padron/webservices/personaServiceA5'

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function decodeXml(value) {
  return String(value || '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function extractTag(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'))
  return match ? decodeXml(match[1].trim()) : null
}

function extractBlock(xml, tag) {
  const match = String(xml || '').match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'))
  return match ? match[1] : null
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '')
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function buildSoapEnvelope(ticket, idPersona) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a5="http://a5.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a5:getPersona_v2>
      <token>${xmlEscape(ticket.token)}</token>
      <sign>${xmlEscape(ticket.sign)}</sign>
      <cuitRepresentada>${xmlEscape(ARCA_CUIT)}</cuitRepresentada>
      <idPersona>${xmlEscape(idPersona)}</idPersona>
    </a5:getPersona_v2>
  </soapenv:Body>
</soapenv:Envelope>`
}

function parseTaxpayer(responseXml, cuit) {
  const fault = extractTag(responseXml, 'faultstring')
  if (fault) throw new Error(`ARCA Padrón rechazó la consulta: ${fault}`)

  const personaReturn = extractBlock(responseXml, 'personaReturn')
  if (!personaReturn) {
    const error = extractTag(responseXml, 'error')
    throw new Error(error ? `ARCA Padrón: ${error}` : 'ARCA Padrón respondió sin datos del contribuyente.')
  }

  const errorConstancia = extractBlock(personaReturn, 'errorConstancia')
  if (errorConstancia) {
    const error = extractTag(errorConstancia, 'error') || 'No se pudieron obtener los datos del contribuyente.'
    throw new Error(`ARCA Padrón: ${error}`)
  }

  const general = extractBlock(personaReturn, 'datosGenerales') || ''
  const domicilio = extractBlock(general, 'domicilioFiscal') || ''
  const razonSocial = normalizedText(extractTag(general, 'razonSocial'))
  const apellido = normalizedText(extractTag(general, 'apellido'))
  const nombre = normalizedText(extractTag(general, 'nombre'))
  const displayName = razonSocial || [apellido, nombre].filter(Boolean).join(' ').trim()

  if (!displayName) {
    throw new Error('ARCA Padrón respondió sin razón social o nombre del contribuyente.')
  }

  const taxIds = [...String(personaReturn).matchAll(/<(?:\w+:)?idImpuesto(?:\s[^>]*)?>([^<]+)<\/(?:\w+:)?idImpuesto>/gi)]
    .map((match) => Number(onlyDigits(match[1])))
    .filter(Number.isFinite)

  const vatCondition = taxIds.includes(30)
    ? 'Responsable inscripto'
    : taxIds.includes(20)
      ? 'Monotributista'
      : 'CUIT registrado en ARCA'

  return {
    cuit: onlyDigits(extractTag(general, 'idPersona') || cuit),
    name: displayName,
    legalName: razonSocial || null,
    firstName: nombre || null,
    lastName: apellido || null,
    personType: normalizedText(extractTag(general, 'tipoPersona')) || null,
    keyStatus: normalizedText(extractTag(general, 'estadoClave')) || null,
    taxIds,
    vatCondition,
    address: {
      addressLine: normalizedText(extractTag(domicilio, 'direccion')) || null,
      city: normalizedText(extractTag(domicilio, 'localidad')) || null,
      state: normalizedText(extractTag(domicilio, 'descripcionProvincia')) || null,
      zipCode: normalizedText(extractTag(domicilio, 'codPostal')) || null,
      type: normalizedText(extractTag(domicilio, 'tipoDomicilio')) || 'FISCAL',
    },
    source: 'arca_padron',
    checkedAt: new Date().toISOString(),
  }
}

export async function getTaxpayerByCuit(cuit) {
  const normalizedCuit = onlyDigits(cuit)
  if (normalizedCuit.length !== 11) {
    throw new Error('Para consultar ARCA Padrón se necesita un CUIT válido de 11 dígitos.')
  }

  const ticket = await getWsaaTicket({ service: PADRON_SERVICE })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), WSAA_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(PADRON_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      body: buildSoapEnvelope(ticket, normalizedCuit),
      signal: controller.signal,
    })

    const responseXml = await response.text()
    if (!response.ok) {
      const fault = extractTag(responseXml, 'faultstring')
      throw new Error(fault || `ARCA Padrón respondió con HTTP ${response.status}.`)
    }

    return parseTaxpayer(responseXml, normalizedCuit)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('ARCA Padrón tardó demasiado en responder.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
