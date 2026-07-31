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

export function buildInvoicePdf(invoice) {
  const voucher = invoice?.voucher || {}
  const buyer = invoice?.buyer || {}
  const snapshot = invoice?.saleSnapshot || {}
  const items = Array.isArray(snapshot.items) ? snapshot.items : []
  const commands = []
  let y = 800

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

  text('PANADERO', 48, 18, true)
  text('Comprobante electronico autorizado por ARCA', 48, 9)
  y += 34
  text(voucher.voucherTypeDescription || 'Factura electronica', 360, 16, true)
  text(`Nro. ${voucher.formattedNumber || '—'}`, 360, 11, true)
  line()

  row('Punto de venta', String(voucher.pointOfSale || '—').padStart(4, '0'))
  row('Fecha de emision', arcaDate(voucher.date || invoice.createdAt))
  row('CAE', invoice.cae || '—')
  row('Vencimiento CAE', arcaDate(invoice.caeExpirationDate))
  row('Venta Mercado Libre', `#${invoice.orderId || '—'}`)
  line()

  text('RECEPTOR', 48, 11, true)
  row('Razon social / Nombre', buyer.name || 'Consumidor final')
  row('Documento', [buyer.documentType, buyer.documentNumber].filter(Boolean).join(' ') || 'Sin identificar')
  row('Condicion IVA', voucher.voucherType === 1 ? 'Responsable Inscripto' : 'Consumidor Final')
  if (snapshot.address) {
    const address = [snapshot.address.addressLine, snapshot.address.city, snapshot.address.state].filter(Boolean).join(', ')
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
  row('TOTAL', money(voucher.amount), true)
  y -= 4
  text(`Total: ${money(voucher.amount)}`, 350, 14, true)
  line()

  text('Este documento representa un comprobante electronico autorizado.', 48, 8)
  text('Conserve el CAE y su fecha de vencimiento para la verificacion fiscal.', 48, 8)
  text('Generado por Panadero.', 48, 8)

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
