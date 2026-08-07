function formatCurrency(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}


function fiscalDocumentLabel(type, number) {
  const normalizedType = String(type || '').toUpperCase()
  const normalizedNumber = String(number || '').replace(/\s+/g, '')
  if (!normalizedNumber || normalizedNumber === 'SIN DATOS' || normalizedNumber === 'PENDIENTE') return '—'

  if (normalizedType.includes('CUIT') || normalizedType.includes('CUIL')) {
    const digits = normalizedNumber.replace(/\D/g, '')
    const formatted = digits.length === 11
      ? `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
      : normalizedNumber
    return `CUIT ${formatted}`
  }

  if (normalizedType.includes('DNI')) {
    const digits = normalizedNumber.replace(/\D/g, '')
    const formatted = digits ? Number(digits).toLocaleString('es-AR') : normalizedNumber
    return `DNI ${formatted}`
  }

  return '—'
}

function SalesTable({ sales, selectedSaleId, onSelectSale }) {
  return (
    <div className="sales-list" role="list">
      {sales.map((sale) => (
        <button
          key={sale.id}
          type="button"
          className={`sale-item ${selectedSaleId === sale.id ? 'selected' : ''}`}
          onClick={() => onSelectSale(sale.id)}
        >
          <span className={`sale-indicator ${sale.status}`} />

          <span className="sale-main">
            <span className="sale-title-line">
              <strong>{sale.customer}</strong>
              <small>#{sale.id}</small>
            </span>
            <span className="sale-meta">
              {fiscalDocumentLabel(sale.documentType, sale.documentNumber)}
            </span>
          </span>

          <span className="sale-side">
            <strong>{formatCurrency(sale.total)}</strong>
            <small className={sale.status}>{sale.statusLabel}</small>
          </span>
        </button>
      ))}
    </div>
  )
}

export { formatCurrency }
export default SalesTable
