import { useEffect, useState } from 'react'
import Topbar from '../components/Topbar'
import { formatCurrency } from '../components/SalesTable'

const API_BASE = 'https://api.panaderoapp.com/api'

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function Invoices() {
  const [account, setAccount] = useState({ connected: false, nickname: '' })
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const rows = []

  useEffect(() => {
    api('/mercadolibre/status')
      .then((status) => setAccount({ connected: status.connected, nickname: status.account?.nickname || '', ...status.account }))
      .catch(() => setNotice('No se pudo conectar con Panadero API.'))
  }, [])

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
      <Topbar section="facturas" account={account} loading={loading} onConnect={handleConnect} onDisconnect={handleDisconnect} />
      {notice && <button className="notice-bar" type="button" onClick={() => setNotice('')}><span>{notice}</span><strong>×</strong></button>}
      <section className="invoice-registry">
        <div className="registry-header">
          <div>
            <span className="detail-kicker">Preparado para ARCA</span>
            <h2>Comprobantes emitidos</h2>
            <p>Cuando conectemos ARCA, cada factura aparecerá automáticamente en esta tabla.</p>
          </div>
        </div>
        <div className="registry-table-wrap">
          <table className="registry-table">
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Jurisdicción</th><th>Tipo</th><th>N.º factura</th><th>IVA %</th><th>Importe IVA</th><th>Total</th></tr></thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.id}><td>{row.date}</td><td>{row.customer}</td><td>{row.state}</td><td>{row.type}</td><td>{row.number}</td><td>{row.vatRate}%</td><td>{formatCurrency(row.vatAmount)}</td><td>{formatCurrency(row.total)}</td></tr>
              )) : <tr><td colSpan="8" className="registry-empty">Todavía no hay facturas emitidas. La estructura ya quedó lista para recibir los datos de ARCA.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default Invoices
