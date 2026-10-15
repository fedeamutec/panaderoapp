import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

const PANADERO_LOGO_WIDTH = 160
const PANADERO_LOGO_HEIGHT = 27
const PANADERO_LOGO_HEX = 'FFFF000000000000000000003F00000000000000FFFFC00000000000000000003F00000000000000FFFFE00000000000000000003F00000000000000FFFFF00000000000000000003F00000000000000FFFFF00000000000000000003F00000000000000FC07F80000000000000000003F00000000000000FC03F81FF01F9FC00FFC00FF3F01FF01F8F07FC0FC01F87FFC1FBFE01FFE01FFBF03FFC1FBF0FFF0FC01F8FFFE1FFFF07FFF03FFFF0FFFE1FFF3FFF8FC01F9FFFE1FFFF87FFF87FFFF0FFFF1FFF7FFFCFC03FBFCFF1FFFF8FF3FC7FFFF1FFFF1FFF7FFFEFC07FBF83F1FE3F8FC1FCFE0FF3F83F9FF8FE0FEFFFFF3F03F1FC1FCFC0FCFE07F3F01F9FC0FE07FFFFFF0003F9FC1FC000FCFC07F3F01F9FC0FC07FFFFFE003FF9F81FC00FFCFC07F7FFFFDFC1FC03FFFFFC03FFF9F81FC0FFFDFC03F7FFFFDFC1FC03FFFFF00FFFF9F81FC3FFFDFC03F7FFFFDFC1FC03FFFF801FFFF9F81FC7FFFDFC03F7FFFFDFC1FC03FFC0003FF3F9F81FCFF8FCFC07F7F0001FC1FC03FFC0003F03F9F81FDFC0FCFC07F3F0001FC0FC07FFC0007F03F9F81FDFC0FCFE07F3F01F9FC0FE07FFC0007F07F9F81FDFC1FCFF0FF3F83F9FC0FF0FEFC0007F9FFDF81FDFE7FF7FFFF1FFFF9FC07FFFEFC0003FFFFDF81FCFFFFF7FFFF0FFFF1FC03FFFCFC0003FFFFDF81FCFFFFF3FFFF0FFFE1FC03FFF8FC0001FFCFDF81FC7FF3F1FFBF03FFC1FC00FFF0FC00007F87DF80F81FC1F07E3F00FF00F8003FC0>'

function money(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number(value || 0))
}

function arcaDate(value) {
  const raw = String(value || '')
  if (/^\d{8}$/.test(raw)) return `${raw.slice(6, 8)}/${raw.slice(4, 6)}/${raw.slice(0, 4)}`
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString('es-AR')
}

function qrDate(value) {
  const raw = String(value || '')
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

function cleanText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, '')
}

function escapePdf(value) {
  return cleanText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function wrapText(value, maxLength = 88) {
  const words = cleanText(value).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length > maxLength && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }

  if (line) lines.push(line)
  return lines.length ? lines : ['—']
}

function createPdf(objects) {
  let pdf = '%PDF-1.4\n%Panadero\n'
  const offsets = [0]

  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })

  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`

  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }

  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

function readMercadoLibreStore() {
  const candidates = [
    process.env.ML_DATA_FILE,
    process.env.MERCADOLIBRE_DATA_FILE,
    path.join(process.cwd(), 'server', 'data', 'mercadolibre.json'),
    path.join(process.cwd(), 'data', 'mercadolibre.json'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      return JSON.parse(fs.readFileSync(candidate, 'utf8'))
    } catch {
      // Continue with the next possible location.
    }
  }

  return null
}

function findStoredOrder(invoice = {}, store = null) {
  const orderId = String(invoice.orderId || invoice.saleSnapshot?.id || '')
  if (!orderId || !store) return null
  const orders = Array.isArray(store.orders) ? store.orders : []
  return orders.find((order) => String(order?.id || order?.orderId || '') === orderId) || null
}

function sellerName(invoice = {}, store = null) {
  const snapshot = invoice.saleSnapshot || {}
  return (
    invoice.accountNickname ||
    invoice.account?.nickname ||
    invoice.sellerNickname ||
    invoice.seller?.nickname ||
    invoice.mercadoLibreAccount ||
    snapshot.account?.nickname ||
    snapshot.seller?.nickname ||
    snapshot.sellerNickname ||
    snapshot.accountNickname ||
    snapshot.accountName ||
    invoice.brand?.name ||
    store?.account?.nickname ||
    process.env.ML_ACCOUNT_NAME ||
    'PANADERO'
  )
}

function normalizeItem(item = {}) {
  const quantity = Math.max(1, Number(item.quantity || item.qty || 1))
  const vatRate = Number.isFinite(Number(item.vatRate)) ? Number(item.vatRate) : 21
  const unitPrice = Number(item.unitPrice ?? item.unit_price ?? item.price ?? item.totalPrice ?? 0)
  const netUnitPrice = Number(item.netUnitPrice ?? (unitPrice / (1 + vatRate / 100)))
  const listNetUnitPrice = Number(item.listNetUnitPrice ?? item.priceBeforeDiscount ?? netUnitPrice)
  const calculatedDiscount = listNetUnitPrice > 0
    ? Math.max(0, (1 - netUnitPrice / listNetUnitPrice) * 100)
    : 0
  const discountLabel = String(
    item.discountLabel ?? item.discount ?? `${String(Number(calculatedDiscount.toFixed(2))).replace('.', ',')}%`,
  )
  return {
    code:
      item.code ||
      item.sku ||
      item.sellerSku ||
      item.item?.seller_sku ||
      item.item?.id ||
      '',
    title:
      item.title ||
      item.name ||
      item.item?.title ||
      item.product?.title ||
      item.productName ||
      item.description ||
      'Producto',
    quantity,
    vatRate,
    discountLabel,
    listNetUnitPrice,
    netUnitPrice,
    netSubtotal: Number(item.netSubtotal ?? (netUnitPrice * quantity)),
    unitPrice,
    subtotal: Number(item.subtotal ?? (unitPrice * quantity)),
  }
}

function invoiceItems(invoice = {}, storedOrder = null) {
  const snapshot = invoice.saleSnapshot || {}
  const candidates = [
    snapshot.items,
    invoice.items,
    invoice.orderItems,
    snapshot.orderItems,
    storedOrder?.items,
    storedOrder?.orderItems,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate.map(normalizeItem)
  }

  const single =
    snapshot.item ||
    invoice.item ||
    snapshot.product ||
    invoice.product ||
    storedOrder?.item ||
    storedOrder?.product

  return single ? [normalizeItem(single)] : []
}

function documentTypeCode(buyer = {}) {
  const explicit = Number(buyer.documentTypeCode || buyer.docTypeCode)
  if (Number.isFinite(explicit) && explicit > 0) return explicit

  const type = String(buyer.documentType || '').toUpperCase()
  if (type.includes('CUIT')) return 80
  if (type.includes('CUIL')) return 86
  if (type.includes('CDI')) return 87
  if (type.includes('DNI')) return 96
  if (type.includes('PAS')) return 94

  const digits = onlyDigits(buyer.documentNumber)
  if (digits.length === 11) return 80
  if (digits.length === 7 || digits.length === 8) return 96
  return 99
}

function receiverDisplayName(buyer = {}) {
  return documentTypeCode(buyer) === 80
    ? (buyer.fiscalLegalName || buyer.name || 'Receptor CUIT')
    : (buyer.name || 'Consumidor final')
}

function invoiceNumber(voucher = {}) {
  const direct = Number(voucher.number || voucher.voucherNumber || voucher.cbteDesde || voucher.cbteHasta)
  if (Number.isFinite(direct) && direct > 0) return direct

  const formatted = String(voucher.formattedNumber || '')
  const parts = formatted.split('-')
  const last = Number(onlyDigits(parts.at(-1)))
  return Number.isFinite(last) && last > 0 ? last : 0
}

function invoiceIssuerCuit(invoice = {}) {
  const voucher = invoice.voucher || {}
  return onlyDigits(
    invoice.issuerCuit ||
      voucher.issuerCuit ||
      process.env.ARCA_CUIT ||
      process.env.CUIT ||
      '',
  )
}

function issuerFiscalAddress() {
  return cleanText(process.env.ARCA_FISCAL_ADDRESS || 'Santa Cruz 1219')
}

function buildArcaQrUrl(invoice = {}) {
  const voucher = invoice.voucher || {}
  const buyer = invoice.buyer || {}
  const documentNumber = onlyDigits(buyer.documentNumber)
  const issuerCuit = invoiceIssuerCuit(invoice)

  const payload = {
    ver: 1,
    fecha: qrDate(voucher.date || invoice.createdAt),
    cuit: Number(issuerCuit),
    ptoVta: Number(voucher.pointOfSale || 0),
    tipoCmp: Number(voucher.voucherType || 0),
    nroCmp: invoiceNumber(voucher),
    importe: Number(Number(voucher.amount || 0).toFixed(2)),
    moneda: voucher.currency || 'PES',
    ctz: Number(voucher.exchangeRate || 1),
    tipoCodAut: invoice.authorizationType === 'CAEA' ? 'A' : 'E',
    codAut: Number(onlyDigits(invoice.cae || invoice.caea)),
  }

  if (documentNumber) {
    payload.tipoDocRec = documentTypeCode(buyer)
    payload.nroDocRec = Number(documentNumber)
  }

  const requiredNumbers = [
    payload.cuit,
    payload.ptoVta,
    payload.tipoCmp,
    payload.nroCmp,
    payload.importe,
    payload.ctz,
    payload.codAut,
  ]

  if (requiredNumbers.some((value) => !Number.isFinite(value) || value <= 0)) return null

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  return `https://www.arca.gob.ar/fe/qr/?p=${encoded}`
}

function qrCommands(value, x, y, size) {
  if (!value) return []

  const qr = QRCode.create(value, {
    errorCorrectionLevel: 'M',
    version: undefined,
  })

  const modules = qr.modules
  const count = modules.size
  const quietZone = 4
  const total = count + quietZone * 2
  const cell = size / total
  const commands = ['0 g']

  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!modules.get(row, column)) continue
      const px = x + (column + quietZone) * cell
      const py = y + size - (row + quietZone + 1) * cell
      commands.push(`${px.toFixed(3)} ${py.toFixed(3)} ${cell.toFixed(3)} ${cell.toFixed(3)} re f`)
    }
  }

  return commands
}

export function buildInvoicePdf(invoice) {
  const voucher = invoice?.voucher || {}
  const buyer = invoice?.buyer || {}
  const snapshot = invoice?.saleSnapshot || {}
  const store = readMercadoLibreStore()
  const storedOrder = findStoredOrder(invoice, store)
  const items = invoiceItems(invoice, storedOrder)
  const commands = []
  const accountName = cleanText(sellerName(invoice, store)).toUpperCase()
  const qrUrl = buildArcaQrUrl(invoice)
  let y = 798

  const text = (value, x = 48, size = 10, bold = false) => {
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`)
    y -= size + 6
  }

  const line = () => {
    commands.push(`0.72 G 48 ${y} m 547 ${y} l S`)
    y -= 14
  }

  const row = (label, value) => {
    commands.push(`BT /F1 9 Tf 48 ${y} Td (${escapePdf(label)}) Tj ET`)
    commands.push(`BT /F2 10 Tf 235 ${y} Td (${escapePdf(value)}) Tj ET`)
    y -= 17
  }

  const drawAt = (value, x, atY, size = 7, bold = false) => {
    commands.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${atY} Td (${escapePdf(value)}) Tj ET`)
  }

  const drawRight = (value, right, atY, size = 7, bold = false) => {
    const cleaned = cleanText(value)
    const estimatedWidth = cleaned.length * size * (bold ? 0.54 : 0.5)
    drawAt(cleaned, Math.max(48, right - estimatedWidth), atY, size, bold)
  }

  text(accountName, 48, 22, true)
  text('Comprobante electronico autorizado por ARCA', 48, 9)
  y += 37
  text(voucher.voucherTypeDescription || 'Factura electronica', 360, 16, true)
  text(`Nro. ${voucher.formattedNumber || '—'}`, 360, 11, true)
  line()

  row('Punto de venta', String(voucher.pointOfSale || '—').padStart(4, '0'))
  row('CUIT emisor', invoiceIssuerCuit(invoice) || '—')
  row('Domicilio fiscal', issuerFiscalAddress())
  row('Fecha de emision', arcaDate(voucher.date || invoice.createdAt))
  row('CAE', invoice.cae || invoice.caea || '—')
  row('Vencimiento CAE', arcaDate(invoice.caeExpirationDate))
  if (invoice.orderId) {
    row('Venta Mercado Libre', `#${invoice.orderId}`)
  } else if (invoice.source === 'commercial') {
    row('Origen', 'Facturacion general · Panadero')
  }
  line()

  text('RECEPTOR', 48, 11, true)
  row('Razon social / Nombre', receiverDisplayName(buyer))
  row('Documento', [buyer.documentType, buyer.documentNumber].filter(Boolean).join(' ') || 'Sin identificar')
  row('Condicion IVA', invoice.receiverVatCondition?.description || buyer.taxCondition || (voucher.voucherType === 1 ? 'Responsable Inscripto' : 'Consumidor Final'))
  if (invoice.associatedInvoice?.voucher) {
    const associated = invoice.associatedInvoice.voucher
    row('Comprobante asociado', `${associated.voucherTypeDescription || 'Factura'} ${associated.formattedNumber || '—'}`)
  }
  if (invoice.reason) row('Motivo', invoice.reason)

  if (snapshot.address) {
    const address = [snapshot.address.addressLine, snapshot.address.city, snapshot.address.state]
      .filter(Boolean)
      .join(', ')
    row('Domicilio', address || '—')
  }

  line()
  text('DETALLE', 48, 11, true)

  if (items.length) {
    const tableLeft = 48
    const tableRight = 547
    const columnEdges = [48, 86, 218, 279, 324, 362, 423, 458, 547]
    const headerTop = y + 4
    const headerBottom = headerTop - 30

    commands.push(`0.94 g ${tableLeft} ${headerBottom} ${tableRight - tableLeft} ${headerTop - headerBottom} re f 0 g`)
    commands.push(`0.72 G ${tableLeft} ${headerTop} m ${tableRight} ${headerTop} l S`)
    commands.push(`0.72 G ${tableLeft} ${headerBottom} m ${tableRight} ${headerBottom} l S`)
    columnEdges.forEach((edge) => commands.push(`0.72 G ${edge} ${headerBottom} m ${edge} ${headerTop} l S`))

    drawAt('CODIGO', 51, headerBottom + 11, 6, true)
    drawAt('PRODUCTO', 89, headerBottom + 11, 6, true)
    drawRight('PRECIO NETO', 276, headerBottom + 17, 5.2, true)
    drawRight('(SIN DESCUENTO)', 276, headerBottom + 8, 4, true)
    drawRight('DESCUENTO', 321, headerBottom + 11, 4.7, true)
    drawRight('CANTIDAD', 359, headerBottom + 11, 4.8, true)
    drawRight('SUBTOTAL', 420, headerBottom + 11, 5.2, true)
    drawRight('IVA', 455, headerBottom + 11, 5.5, true)
    drawRight('SUBTOTAL', 544, headerBottom + 17, 5.5, true)
    drawRight('CON IVA', 544, headerBottom + 8, 5.5, true)

    let rowTop = headerBottom
    items.slice(0, 10).forEach((item) => {
      const quantity = Math.max(1, Number(item.quantity || 1))
      const vatRate = Number(item.vatRate || voucher.vatRate || 21)
      const listNetUnitPrice = Number(item.listNetUnitPrice ?? item.netUnitPrice ?? 0)
      const netSubtotal = Number(item.netSubtotal ?? (Number(item.netUnitPrice || 0) * quantity))
      const subtotalWithVat = Number(item.subtotal ?? (Number(item.unitPrice || 0) * quantity))
      const wrappedProduct = wrapText(item.title || 'Producto', 23)
      const productLines = wrappedProduct.slice(0, 2)
      if (wrappedProduct.length > 2) {
        productLines[1] = `${productLines[1].slice(0, Math.max(0, productLines[1].length - 3))}...`
      }
      const rowHeight = productLines.length > 1 ? 30 : 23
      const baseline = rowTop - 14
      const rowBottom = rowTop - rowHeight

      drawAt(cleanText(item.code || '').slice(0, 10) || '—', 51, baseline, 6.5)
      productLines.forEach((productLine, index) => drawAt(productLine, 89, baseline - index * 9, 6.2, index === 0))
      drawRight(money(listNetUnitPrice), 276, baseline, 5.9)
      drawRight(item.discountLabel || '0%', 321, baseline, 6.2)
      drawRight(String(quantity).replace('.', ','), 359, baseline, 6.3)
      drawRight(money(netSubtotal), 420, baseline, 5.9)
      drawRight(`${String(vatRate).replace('.', ',')}%`, 455, baseline, 6.2)
      drawRight(money(subtotalWithVat), 544, baseline, 6.3, true)
      commands.push(`0.86 G ${tableLeft} ${rowBottom} m ${tableRight} ${rowBottom} l S`)
      rowTop = rowBottom
    })
    y = rowTop - 12
  } else {
    text('Producto', 48, 9)
  }

  line()
  row('Importe neto gravado', money(voucher.netAmount))
  row(`IVA ${String(voucher.vatRate || 0).replace('.', ',')}%`, money(voucher.vatAmount))
  row('TOTAL', money(voucher.amount))
  y -= 4
  text(`Total: ${money(voucher.amount)}`, 350, 14, true)
  line()

  const qrSize = 118
  const qrX = 48
  const qrY = Math.max(55, y - qrSize + 8)

  if (qrUrl) {
    commands.push(...qrCommands(qrUrl, qrX, qrY, qrSize))
    commands.push(`BT /F2 8 Tf 180 ${qrY + 91} Td (QR fiscal ARCA) Tj ET`)
    commands.push(`BT /F1 8 Tf 180 ${qrY + 75} Td (Escanee para verificar los datos del comprobante.) Tj ET`)
    commands.push(`BT /F1 8 Tf 180 ${qrY + 59} Td (La consulta debe abrir un dominio oficial de ARCA.) Tj ET`)
  } else {
    commands.push(`BT /F2 9 Tf 48 ${qrY + 86} Td (QR fiscal no disponible) Tj ET`)
    commands.push(`BT /F1 8 Tf 48 ${qrY + 70} Td (Revise CUIT, CAE, punto de venta y numero de comprobante.) Tj ET`)
  }

  commands.push(`BT /F1 7 Tf 180 ${qrY + 24} Td (Documento electronico autorizado. Conserve el CAE y su vencimiento.) Tj ET`)

  // Small Panadero signature in the footer using the supplied wordmark.
  commands.push('q 0 g 92 0 0 21 48 20 cm /Logo Do Q')
  commands.push('BT /F1 7 Tf 148 27 Td (Gestion inteligente) Tj ET')

  const content = commands.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Logo 7 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${PANADERO_LOGO_WIDTH} /Height ${PANADERO_LOGO_HEIGHT} /ImageMask true /BitsPerComponent 1 /Decode [1 0] /Filter /ASCIIHexDecode /Length ${PANADERO_LOGO_HEX.length} >>\nstream\n${PANADERO_LOGO_HEX}\nendstream`,
  ]

  return createPdf(objects)
}
