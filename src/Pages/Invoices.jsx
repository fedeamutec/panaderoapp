import { useEffect, useMemo, useState } from 'react'
import Topbar from '../components/Topbar'
import { formatCurrency } from '../components/SalesTable'

const API_BASE = 'https://api.panaderoapp.com/api'

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('es-AR')
}

function Invoices() {
  const [account, setAccount] = useState({ connected: false, nickname: '' })
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([
      api('/mercadolibre/status'),
      api('/arca/sale-invoices'),
    ])
      .then(([status, invoicePayload]) => {
        if (cancelled) return
        setAccount({
          connected: status.connected,
          nickname: status.account?.nickname || '',
          ...status.account,
        })
        setInvoices(invoicePayload.invoices || [])
      })
      .catch(() => {
        if (!cancelled) setNotice('No se pudo conectar con Panadero API.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () => [...invoices].reverse().map((invoice) => ({
      id: String(invoice.orderId),
      date: formatDate(invoice.createdAt),
      customer: invoice.buyer?.name || 'Consumidor final',
      state: invoice.saleSnapshot?.address?.state || 'Argentina',
      type: invoice.voucher?.voucherTypeDescription || 'Factura',
      number: invoice.voucher?.formattedNumber || '—',
      vatRate: Number(invoice.voucher?.vatRate || 0),
      vatAmount: Number(invoice.voucher?.vatAmount || 0),
      total: Number(invoice.voucher?.amount || 0),
    })),
    [invoices],
  )

  const handleConnect = async () => {
    setLoading(true)
    try {
      const { url } = await api('/mercadolibre/connect')
      window.location.assign(url)
    } catch (error) {
      setNotice(error.message)
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    if (!window.confirm('¿Desconectar la cuenta de Mercado Libre?')) return
    setLoading(true)
    try {
      await api('/mercadolibre/disconnect', { method: 'POST' })
      setAccount({ connected: false, nickname: '' })
      setNotice('Cuenta desconectada.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="workspace">
      <Topbar
        section="facturas"
        account={account}
        loading={loading}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />
      {notice && (
        <button className="notice-bar" type="button" onClick={() => setNotice('')}>
          <span>{notice}</span><strong>×</strong>
        </button>
      )}
      <section className="invoice-registry">
        <div className="registry-header">
          <div>
            <span className="detail-kicker">ARCA Producción</span>
            <h2>Comprobantes emitidos</h2>
            <p>Facturas autorizadas con CAE desde el punto de venta 0003.</p>
          </div>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead>
              <tr>
                <th>Fecha</th><th>Cliente</th><th>Jurisdicción</th><th>Tipo</th>
                <th>N.º factura</th><th>IVA %</th><th>Importe IVA</th><th>Total</th><th>Documento</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td><td>{row.customer}</td><td>{row.state}</td><td>{row.type}</td>
                  <td>{row.number}</td><td>{row.vatRate}%</td><td>{formatCurrency(row.vatAmount)}</td><td>{formatCurrency(row.total)}</td>
                  <td>
                    <div className="registry-actions">
                      <a className="registry-action-link" href={`${API_BASE}/arca/sale-invoices/${encodeURIComponent(row.id)}/pdf`} target="_blank" rel="noreferrer">Ver</a>
                      <a className="registry-action-link" href={`${API_BASE}/arca/sale-invoices/${encodeURIComponent(row.id)}/pdf?download=1`}>PDF</a>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan="9" className="registry-empty">Todavía no hay facturas emitidas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default Invoices
