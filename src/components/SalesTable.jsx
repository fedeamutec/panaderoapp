function formatCurrency(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(value)
}


function fiscalLabel(sale) {
  const type = String(sale?.documentType || '').trim().toUpperCase()
  const raw = String(sale?.documentNumber || '').replace(/\D/g, '')
  if (!raw) return '—'
  if (type === 'CUIT' && raw.length === 11) {
    return `CUIT ${raw.slice(0, 2)}-${raw.slice(2, 10)}-${raw.slice(10)}`
  }
  if (type === 'DNI') {
    return `DNI ${new Intl.NumberFormat('es-AR').format(Number(raw))}`
  }
  return `${type || 'Documento'} ${sale.documentNumber}`
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
              {fiscalLabel(sale)}
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
