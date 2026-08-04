import QRCode from 'qrcode'

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

function invoiceNumber(voucher = {}) {
  const direct = Number(voucher.number || voucher.voucherNumber || voucher.cbteDesde || voucher.cbteHasta)
  if (Number.isFinite(direct) && direct > 0) return direct

  const formatted = String(voucher.formattedNumber || '')
  const parts = formatted.split('-')
  const last = Number(onlyDigits(parts.at(-1)))
  return Number.isFinite(last) && last > 0 ? last : 0
}

function sellerName(invoice = {}) {
  const snapshot = invoice.saleSnapshot || {}
  return (
    invoice.accountNickname ||
    invoice.sellerNickname ||
    invoice.mercadoLibreAccount ||
    snapshot.account?.nickname ||
    snapshot.seller?.nickname ||
    snapshot.sellerNickname ||
    snapshot.accountNickname ||
    process.env.ML_ACCOUNT_NAME ||
    'CUENTA MERCADO LIBRE'
  )
}

function buildArcaQrUrl(invoice = {}) {
  const voucher = invoice.voucher || {}
  const buyer = invoice.buyer || {}
  const documentNumber = onlyDigits(buyer.documentNumber)
  const issuerCuit = onlyDigits(
    invoice.issuerCuit ||
      voucher.issuerCuit ||
      process.env.ARCA_CUIT ||
      process.env.CUIT ||
      '',
  )

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
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  const commands = []
  const accountName = cleanText(sellerName(invoice)).toUpperCase()
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

  text(accountName, 48, 22, true)
  text('Comprobante electronico autorizado por ARCA', 48, 9)
  y += 37
  text(voucher.voucherTypeDescription || 'Factura electronica', 360, 16, true)
  text(`Nro. ${voucher.formattedNumber || '—'}`, 360, 11, true)
  line()

  row('Punto de venta', String(voucher.pointOfSale || '—').padStart(4, '0'))
  row('Fecha de emision', arcaDate(voucher.date || invoice.createdAt))
  row('CAE', invoice.cae || invoice.caea || '—')
  row('Vencimiento CAE', arcaDate(invoice.caeExpirationDate))
  row('Venta Mercado Libre', `#${invoice.orderId || '—'}`)
  line()

  text('RECEPTOR', 48, 11, true)
  row('Razon social / Nombre', buyer.name || 'Consumidor final')
  row('Documento', [buyer.documentType, buyer.documentNumber].filter(Boolean).join(' ') || 'Sin identificar')
  row('Condicion IVA', voucher.voucherType === 1 ? 'Responsable Inscripto' : 'Consumidor Final')

  if (snapshot.address) {
    const address = [snapshot.address.addressLine, snapshot.address.city, snapshot.address.state]
      .filter(Boolean)
      .join(', ')
    row('Domicilio', address || '—')
  }

  line()
  text('DETALLE', 48, 11, true)

  if (items.length) {
    items.slice(0, 10).forEach((item) => {
      const quantity = Number(item.quantity || 1)
      const unitPrice = Number(item.unitPrice || 0)
      wrapText(`${quantity} x ${item.title || 'Producto'}`, 68).forEach((itemLine, index) => {
        text(itemLine, 48, index === 0 ? 9 : 8)
      })
      text(money(unitPrice * quantity), 430, 9, true)
      y += 15
    })
  } else {
    text('Venta de productos por Mercado Libre', 48, 9)
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
  const qrY = Math.max(42, y - qrSize + 8)

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
  commands.push(`BT /F1 6 Tf 470 24 Td (Panadero) Tj ET`)

  const content = commands.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ]

  return createPdf(objects)
}
