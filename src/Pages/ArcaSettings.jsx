import { useCallback, useEffect, useState } from 'react'
import Topbar from '../components/Topbar'

const API_BASE = 'https://api.panaderoapp.com/api'

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date)
}

function formatArcaDate(value) {
  if (!value) return '—'
  const raw = String(value).trim()

  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(6, 8)}/${raw.slice(4, 6)}/${raw.slice(0, 4)}`
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return raw

  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
  }).format(date)
}

function formatMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'

  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(amount)
}

function getInvoiceData(payload) {
  const source = payload?.invoice || payload?.result || payload?.data || payload?.response || payload || {}

  return {
    voucherNumber: source.voucherNumber ?? source.cbteNro ?? source.CbteDesde ?? source.number ?? null,
    formattedNumber: source.formattedNumber ?? source.invoiceNumber ?? source.comprobante ?? null,
    cae: source.cae ?? source.CAE ?? source.authorizationCode ?? null,
    caeExpirationDate: source.caeExpirationDate ?? source.CAEFchVto ?? source.caeDueDate ?? null,
    issueDate: source.issueDate ?? source.cbteFch ?? source.CbteFch ?? source.date ?? null,
    amount: source.amount ?? source.totalAmount ?? source.ImpTotal ?? null,
  }
}

function ArcaSettings() {
  const [status, setStatus] = useState(null)
  const [connection, setConnection] = useState(null)
  const [csr, setCsr] = useState('')
  const [certificate, setCertificate] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testAmount, setTestAmount] = useState('100')
  const [issuingInvoice, setIssuingInvoice] = useState(false)
  const [invoiceResult, setInvoiceResult] = useState(null)

  const loadStatus = useCallback(async () => {
    try {
      const result = await api('/arca/status')
      setStatus(result)
      if (result.hasCsr) {
        const csrResult = await api('/arca/csr')
        setCsr(csrResult.csr || '')
      }
    } catch (error) {
      setNotice(error.message)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const generate = async () => {
    setLoading(true)
    setNotice('')
    try {
      const result = await api('/arca/csr', { method: 'POST' })
      setStatus(result)
      setCsr(result.csr || '')
      setNotice('CSR generado. Copialo completo y pegalo en WSASS.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  const copyCsr = async () => {
    await navigator.clipboard.writeText(csr)
    setNotice('CSR copiado.')
  }

  const saveCertificate = async () => {
    setLoading(true)
    setNotice('')
    try {
      const result = await api('/arca/certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificate }),
      })
      setStatus(result)
      setCertificate('')
      setNotice('Certificado guardado correctamente.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setNotice('')
    setConnection(null)
    try {
      const result = await api('/arca/test-connection', { method: 'POST' })
      setConnection(result)
      setNotice('Conexión con ARCA comprobada correctamente.')
    } catch (error) {
      setConnection({ connected: false, error: error.message })
      setNotice(error.message)
    } finally {
      setTesting(false)
    }
  }

  const issueTestInvoice = async () => {
    const amount = Number(testAmount)

    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Ingresá un importe válido mayor a $0.')
      return
    }

    const confirmed = window.confirm(
      `Se emitirá una Factura C de prueba por ${formatMoney(amount)} en homologación.\n\n¿Querés continuar?`,
    )

    if (!confirmed) return

    setIssuingInvoice(true)
    setInvoiceResult(null)
    setNotice('')

    try {
      const result = await api('/arca/test-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointOfSale: 3,
          amount,
          documentType: 99,
          documentNumber: 0,
          recipientVatConditionId: 5,
          confirmation: 'EMITIR_FACTURA_C_DE_PRUEBA',
        }),
      })

      const invoice = getInvoiceData(result)
      setInvoiceResult({
        ok: true,
        ...invoice,
        amount: invoice.amount ?? amount,
      })
      setNotice('Factura C de prueba autorizada correctamente.')
    } catch (error) {
      setInvoiceResult({ ok: false, error: error.message })
      setNotice(error.message)
    } finally {
      setIssuingInvoice(false)
    }
  }

  const complete = Boolean(status?.hasCertificate)
  const connected = Boolean(connection?.connected)

  return (
    <main className="workspace">
      <Topbar section="arca" account={{ connected }} />

      {notice && (
        <button className="notice-bar" type="button" onClick={() => setNotice('')}>
          <span>{notice}</span>
          <strong>×</strong>
        </button>
      )}

      <section className="arca-setup">
        <div className="arca-heading">
          <div>
            <span className="eyebrow">Configuración</span>
            <h2>Conectar ARCA</h2>
            <p>Homologación · CUIT {status?.cuit || '20366076957'} · Punto de venta 0003</p>
          </div>
          <span className={`arca-state ${connected ? 'connected' : complete ? 'ready' : ''}`}>
            {connected ? 'Conectado' : complete ? 'Certificado cargado' : 'En configuración'}
          </span>
        </div>

        <div className="setup-steps">
          <article className={`setup-card ${status?.hasCsr ? 'done' : 'active'}`}>
            <span className="step-number">1</span>
            <div>
              <h3>Generar identidad de Panadero</h3>
              <p>Panadero crea la clave privada y el CSR. La clave queda guardada únicamente en el backend.</p>
              {!status?.hasCsr ? (
                <button className="primary-button" type="button" onClick={generate} disabled={loading}>
                  {loading ? 'Generando…' : 'Generar CSR'}
                </button>
              ) : <span className="step-ok">✓ CSR generado</span>}
            </div>
          </article>

          <article className={`setup-card ${csr ? 'active' : ''}`}>
            <span className="step-number">2</span>
            <div>
              <h3>Copiar en WSASS</h3>
              <p>Copiá el bloque completo y pegalo en “Solicitud de certificado en formato PKCS#10”.</p>
              {csr && <>
                <textarea className="arca-textarea csr-output" value={csr} readOnly />
                <button className="ghost-button" type="button" onClick={copyCsr}>Copiar CSR</button>
              </>}
            </div>
          </article>

          <article className={`setup-card ${status?.hasCsr ? 'active' : ''} ${complete ? 'done' : ''}`}>
            <span className="step-number">3</span>
            <div>
              <h3>Guardar certificado de ARCA</h3>
              <p>Después de crear el certificado en WSASS, copiá el resultado completo y pegalo acá.</p>
              {!complete ? <>
                <textarea className="arca-textarea" value={certificate} onChange={(event) => setCertificate(event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
                <button className="primary-button" type="button" onClick={saveCertificate} disabled={loading || !certificate.trim()}>Guardar certificado</button>
              </> : <span className="step-ok">✓ Certificado almacenado</span>}
            </div>
          </article>

          <article className={`setup-card ${complete ? 'active' : ''} ${connected ? 'done' : ''}`}>
            <span className="step-number">4</span>
            <div>
              <h3>Probar conexión con ARCA</h3>
              <p>Panadero firma una solicitud con el certificado, solicita un ticket WSAA y verifica el acceso al servicio WSFE.</p>
              <div className="arca-connection-actions">
                <button className="primary-button" type="button" onClick={testConnection} disabled={!complete || testing}>
                  {testing ? 'Conectando…' : 'Probar conexión'}
                </button>
              </div>
              {connection && (
                <div className={`arca-connection-result ${connected ? 'success' : 'error'}`}>
                  <strong>{connected ? 'Conectado con ARCA' : 'No se pudo conectar'}</strong>
                  {connected ? (
                    <dl>
                      <div><dt>Servicio</dt><dd>{connection.service || 'wsfe'}</dd></div>
                      <div><dt>Ambiente</dt><dd>{connection.environment === 'production' ? 'Producción' : 'Homologación'}</dd></div>
                      <div><dt>Token válido hasta</dt><dd>{formatDateTime(connection.expirationTime)}</dd></div>
                    </dl>
                  ) : <p>{connection.error}</p>}
                </div>
              )}
            </div>
          </article>

          <article className={`setup-card arca-test-invoice-card ${connected ? 'active' : ''} ${invoiceResult?.ok ? 'done' : ''}`}>
            <span className="step-number">5</span>
            <div>
              <div className="arca-test-title">
                <div>
                  <h3>Emitir Factura C de prueba</h3>
                  <p>Genera un comprobante únicamente en homologación usando el punto de venta 0003 y Consumidor Final.</p>
                </div>
                <span className="test-environment-badge">Homologación</span>
              </div>

              <div className="arca-test-form">
                <label className="arca-amount-field">
                  <span>Importe total</span>
                  <div>
                    <strong>$</strong>
                    <input type="number" min="0.01" step="0.01" inputMode="decimal" value={testAmount} onChange={(event) => setTestAmount(event.target.value)} disabled={issuingInvoice} />
                  </div>
                </label>

                <div className="arca-test-summary">
                  <span>Tipo de comprobante</span>
                  <strong>Factura C</strong>
                </div>

                <div className="arca-test-summary">
                  <span>Receptor</span>
                  <strong>Consumidor Final</strong>
                </div>

                <button className="primary-button arca-issue-button" type="button" onClick={issueTestInvoice} disabled={!connected || issuingInvoice}>
                  {issuingInvoice ? 'Solicitando CAE…' : 'Emitir factura de prueba'}
                </button>
              </div>

              {!connected && <p className="arca-test-help">Primero probá la conexión con ARCA para habilitar la emisión.</p>}

              {invoiceResult && (
                <div className={`arca-invoice-result ${invoiceResult.ok ? 'success' : 'error'}`}>
                  {invoiceResult.ok ? <>
                    <div className="arca-invoice-result-header">
                      <div>
                        <span>Comprobante autorizado</span>
                        <strong>{invoiceResult.formattedNumber || (invoiceResult.voucherNumber ? `0003-${String(invoiceResult.voucherNumber).padStart(8, '0')}` : 'Factura C')}</strong>
                      </div>
                      <span className="arca-authorized-badge">✓ Autorizada</span>
                    </div>
                    <dl>
                      <div><dt>CAE</dt><dd>{invoiceResult.cae || 'No informado'}</dd></div>
                      <div><dt>Vencimiento del CAE</dt><dd>{formatArcaDate(invoiceResult.caeExpirationDate)}</dd></div>
                      <div><dt>Fecha de emisión</dt><dd>{formatArcaDate(invoiceResult.issueDate)}</dd></div>
                      <div><dt>Importe</dt><dd>{formatMoney(invoiceResult.amount)}</dd></div>
                    </dl>
                  </> : <>
                    <strong>No se pudo emitir la factura de prueba</strong>
                    <p>{invoiceResult.error}</p>
                  </>}
                </div>
              )}
            </div>
          </article>
        </div>
      </section>
    </main>
  )
}

export default ArcaSettings
