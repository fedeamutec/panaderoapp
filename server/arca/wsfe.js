import {
  ARCA_CUIT,
  ARCA_ENV,
  ARCA_VAT_RATE,
  WSAA_REQUEST_TIMEOUT_MS,
} from './config.js'
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

function formatArcaDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return `${parts.year}${parts.month}${parts.day}`
}

function normalizeMoney(value, fieldName) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${fieldName} debe ser un número mayor que cero.`)
  }
  return Math.round((number + Number.EPSILON) * 100) / 100
}

export async function getReceiverVatConditions({ voucherClass = 'C' } = {}) {
  const normalizedClass = String(voucherClass || '').trim().toUpperCase()

  if (normalizedClass && !['A', 'B', 'C', 'M'].includes(normalizedClass)) {
    throw new Error('La clase de comprobante debe ser A, B, C o M.')
  }

  const { xml, events } = await callWsfe(
    'FEParamGetCondicionIvaReceptor',
    (ticket) => `${buildAuth(ticket)}\n<ClaseCmp>${xmlEscape(normalizedClass)}</ClaseCmp>`,
  )

  const conditions = extractBlocks(xml, 'CondicionIvaReceptor').map((block) => ({
    id: Number(extractTag(block, 'Id')),
    description: extractTag(block, 'Desc'),
    voucherClass: extractTag(block, 'Cmp_Clase'),
  }))

  return {
    ok: true,
    environment: ARCA_ENV,
    voucherClass: normalizedClass || null,
    conditions,
    events,
  }
}

export async function createTestInvoice({
  pointOfSale,
  amount,
  documentType = 99,
  documentNumber = 0,
  recipientVatConditionId = 5,
  confirmation,
}) {
  if (ARCA_ENV === 'production') {
    throw new Error('La factura de prueba está bloqueada en producción.')
  }

  if (confirmation !== 'EMITIR_FACTURA_C_DE_PRUEBA') {
    throw new Error('Falta la confirmación de seguridad para emitir la factura de prueba.')
  }

  const ptoVta = Number(pointOfSale)
  const total = normalizeMoney(amount, 'El importe')
  const docTipo = Number(documentType)
  const docNro = Number(documentNumber)
  const condicionIvaReceptorId = Number(recipientVatConditionId)
  const voucherType = 11

  if (!Number.isInteger(ptoVta) || ptoVta <= 0) {
    throw new Error('El punto de venta debe ser un número entero mayor que cero.')
  }
  if (!Number.isInteger(docTipo) || docTipo <= 0) {
    throw new Error('El tipo de documento debe ser un número entero mayor que cero.')
  }
  if (!Number.isInteger(docNro) || docNro < 0) {
    throw new Error('El número de documento debe ser un número entero igual o mayor que cero.')
  }
  if (!Number.isInteger(condicionIvaReceptorId) || condicionIvaReceptorId <= 0) {
    throw new Error('La condición frente al IVA del receptor no es válida.')
  }

  const lastVoucher = await getLastAuthorizedVoucher({
    pointOfSale: ptoVta,
    voucherType,
  })

  const voucherNumber = lastVoucher.nextVoucherNumber
  const voucherDate = formatArcaDate()
  const formattedTotal = total.toFixed(2)

  const { xml, events } = await callWsfe('FECAESolicitar', (ticket) => `${buildAuth(ticket)}
<FeCAEReq>
  <FeCabReq>
    <CantReg>1</CantReg>
    <PtoVta>${ptoVta}</PtoVta>
    <CbteTipo>${voucherType}</CbteTipo>
  </FeCabReq>
  <FeDetReq>
    <FECAEDetRequest>
      <Concepto>1</Concepto>
      <DocTipo>${docTipo}</DocTipo>
      <DocNro>${docNro}</DocNro>
      <CbteDesde>${voucherNumber}</CbteDesde>
      <CbteHasta>${voucherNumber}</CbteHasta>
      <CbteFch>${voucherDate}</CbteFch>
      <ImpTotal>${formattedTotal}</ImpTotal>
      <ImpTotConc>0.00</ImpTotConc>
      <ImpNeto>${formattedTotal}</ImpNeto>
      <ImpOpEx>0.00</ImpOpEx>
      <ImpTrib>0.00</ImpTrib>
      <ImpIVA>0.00</ImpIVA>
      <MonId>PES</MonId>
      <MonCotiz>1.000000</MonCotiz>
      <CondicionIVAReceptorId>${condicionIvaReceptorId}</CondicionIVAReceptorId>
    </FECAEDetRequest>
  </FeDetReq>
</FeCAEReq>`)

  const headerBlock = extractTag(xml, 'FeCabResp') || ''
  const detailBlock = extractBlocks(xml, 'FECAEDetResponse')[0] || ''
  const observations = extractMessages(detailBlock, 'Observaciones', 'Obs')

  const result = extractTag(detailBlock, 'Resultado') || extractTag(headerBlock, 'Resultado')
  const cae = extractTag(detailBlock, 'CAE')
  const caeExpirationDate = extractTag(detailBlock, 'CAEFchVto')

  if (result !== 'A' || !cae) {
    const observationMessage = observations
      .map((item) => `${item.code}: ${item.message}`)
      .join(' | ')

    throw new Error(
      observationMessage
        ? `ARCA no autorizó el comprobante: ${observationMessage}`
        : `ARCA no autorizó el comprobante. Resultado: ${result || 'sin informar'}.`,
    )
  }

  return {
    ok: true,
    environment: ARCA_ENV,
    authorized: true,
    voucher: {
      pointOfSale: ptoVta,
      voucherType,
      voucherTypeDescription: 'Factura C',
      voucherNumber,
      formattedNumber: `${String(ptoVta).padStart(4, '0')}-${String(voucherNumber).padStart(8, '0')}`,
      date: voucherDate,
      amount: total,
      currency: 'PES',
      documentType: docTipo,
      documentNumber: docNro,
      recipientVatConditionId: condicionIvaReceptorId,
    },
    cae,
    caeExpirationDate,
    processedAt: extractTag(headerBlock, 'FchProceso') || null,
    result,
    reprocessed: extractTag(headerBlock, 'Reproceso') === 'S',
    observations,
    events,
  }
}

function normalizeDocumentType(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'CUIT') return 80
  if (normalized === 'DNI') return 96
  return 99
}

function normalizeDocumentNumber(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits ? Number(digits) : 0
}

function resolveVoucherType({ requestedType, documentType, documentNumber }) {
  const normalized = String(requestedType || 'automatic').trim().toUpperCase()
  const hasCuit = documentType === 80 && String(documentNumber).length === 11

  if (normalized === 'A') {
    if (!hasCuit) {
      throw new Error('Para emitir Factura A el comprador debe tener un CUIT válido.')
    }
    return 1
  }

  if (normalized === 'B') return 6
  if (normalized !== 'AUTOMATIC') {
    throw new Error('El tipo de comprobante debe ser automatic, A o B.')
  }

  return hasCuit ? 1 : 6
}

function voucherDescription(voucherType) {
  return voucherType === 1 ? 'Factura A' : 'Factura B'
}

function recipientVatConditionIdFor({ voucherType }) {
  return voucherType === 1 ? 1 : 5
}

function calculateVatBreakdown(grossAmount) {
  const rate = Number(ARCA_VAT_RATE)

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('ARCA_VAT_RATE debe ser un porcentaje mayor que cero.')
  }

  const netAmount = Math.round((grossAmount / (1 + rate / 100) + Number.EPSILON) * 100) / 100
  const vatAmount = Math.round((grossAmount - netAmount + Number.EPSILON) * 100) / 100

  const rateToId = {
    0: 3,
    10.5: 4,
    21: 5,
    27: 6,
    5: 8,
    2.5: 9,
  }

  const vatId = rateToId[rate]
  if (!vatId) {
    throw new Error(`La alícuota ${rate}% no está configurada en Panadero.`)
  }

  return { rate, vatId, netAmount, vatAmount }
}

export async function createSaleInvoice({
  pointOfSale,
  amount,
  requestedType = 'automatic',
  documentType,
  documentNumber,
  confirmation,
}) {
  if (ARCA_ENV === 'production') {
    throw new Error(
      'La facturación de ventas está bloqueada en producción hasta instalar el certificado y punto de venta productivos.',
    )
  }

  if (!String(confirmation || '').startsWith('EMITIR_VENTA_')) {
    throw new Error('Falta la confirmación de seguridad para facturar la venta.')
  }

  const ptoVta = Number(pointOfSale)
  const total = normalizeMoney(amount, 'El importe')
  const docTipo = normalizeDocumentType(documentType)
  const docNro = normalizeDocumentNumber(documentNumber)
  const voucherType = resolveVoucherType({
    requestedType,
    documentType: docTipo,
    documentNumber: docNro,
  })
  const recipientVatConditionId = recipientVatConditionIdFor({ voucherType })
  const { rate, vatId, netAmount, vatAmount } = calculateVatBreakdown(total)

  if (!Number.isInteger(ptoVta) || ptoVta <= 0) {
    throw new Error('El punto de venta debe ser un número entero mayor que cero.')
  }

  const lastVoucher = await getLastAuthorizedVoucher({
    pointOfSale: ptoVta,
    voucherType,
  })

  const voucherNumber = lastVoucher.nextVoucherNumber
  const voucherDate = formatArcaDate()

  const { xml, events } = await callWsfe('FECAESolicitar', (ticket) => `${buildAuth(ticket)}
<FeCAEReq>
  <FeCabReq>
    <CantReg>1</CantReg>
    <PtoVta>${ptoVta}</PtoVta>
    <CbteTipo>${voucherType}</CbteTipo>
  </FeCabReq>
  <FeDetReq>
    <FECAEDetRequest>
      <Concepto>1</Concepto>
      <DocTipo>${docTipo}</DocTipo>
      <DocNro>${docNro}</DocNro>
      <CbteDesde>${voucherNumber}</CbteDesde>
      <CbteHasta>${voucherNumber}</CbteHasta>
      <CbteFch>${voucherDate}</CbteFch>
      <ImpTotal>${total.toFixed(2)}</ImpTotal>
      <ImpTotConc>0.00</ImpTotConc>
      <ImpNeto>${netAmount.toFixed(2)}</ImpNeto>
      <ImpOpEx>0.00</ImpOpEx>
      <ImpTrib>0.00</ImpTrib>
      <ImpIVA>${vatAmount.toFixed(2)}</ImpIVA>
      <MonId>PES</MonId>
      <MonCotiz>1.000000</MonCotiz>
      <CondicionIVAReceptorId>${recipientVatConditionId}</CondicionIVAReceptorId>
      <Iva>
        <AlicIva>
          <Id>${vatId}</Id>
          <BaseImp>${netAmount.toFixed(2)}</BaseImp>
          <Importe>${vatAmount.toFixed(2)}</Importe>
        </AlicIva>
      </Iva>
    </FECAEDetRequest>
  </FeDetReq>
</FeCAEReq>`)

  const headerBlock = extractTag(xml, 'FeCabResp') || ''
  const detailBlock = extractBlocks(xml, 'FECAEDetResponse')[0] || ''
  const observations = extractMessages(detailBlock, 'Observaciones', 'Obs')
  const result = extractTag(detailBlock, 'Resultado') || extractTag(headerBlock, 'Resultado')
  const cae = extractTag(detailBlock, 'CAE')
  const caeExpirationDate = extractTag(detailBlock, 'CAEFchVto')

  if (result !== 'A' || !cae) {
    const observationMessage = observations
      .map((item) => `${item.code}: ${item.message}`)
      .join(' | ')

    throw new Error(
      observationMessage
        ? `ARCA no autorizó el comprobante: ${observationMessage}`
        : `ARCA no autorizó el comprobante. Resultado: ${result || 'sin informar'}.`,
    )
  }

  return {
    ok: true,
    environment: ARCA_ENV,
    authorized: true,
    voucher: {
      pointOfSale: ptoVta,
      voucherType,
      voucherTypeDescription: voucherDescription(voucherType),
      voucherNumber,
      formattedNumber: `${String(ptoVta).padStart(4, '0')}-${String(voucherNumber).padStart(8, '0')}`,
      date: voucherDate,
      amount: total,
      netAmount,
      vatAmount,
      vatRate: rate,
      currency: 'PES',
      documentType: docTipo,
      documentNumber: docNro,
      recipientVatConditionId,
    },
    cae,
    caeExpirationDate,
    processedAt: extractTag(headerBlock, 'FchProceso') || null,
    result,
    reprocessed: extractTag(headerBlock, 'Reproceso') === 'S',
    observations,
    events,
  }
}
