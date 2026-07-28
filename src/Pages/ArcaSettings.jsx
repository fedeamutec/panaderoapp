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
  if (!value || String(value).length !== 8) return value || '—'
  const text = String(value)
  return `${text.slice(6, 8)}/${text.slice(4, 6)}/${text.slice(0, 4)}`
}

function formatMoney(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
  }).format(amount)
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
  const [issuingTestInvoice, setIssuingTestInvoice] = useState(false)
  const [testInvoiceResult, setTestInvoiceResult] = useState(null)

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

  useEffect(() => { loadStatus() }, [loadStatus])

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
      setNotice('Ingresá un importe mayor que cero.')
      return
    }

    const confirmed = window.confirm(
      `Se emitirá una Factura C de prueba por ${formatMoney(amount)} en homologación. Esta acción genera un comprobante nuevo. ¿Continuar?`,
    )

    if (!confirmed) return

    setIssuingTestInvoice(true)
    setTestInvoiceResult(null)
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

      setTestInvoiceResult(result)
      setNotice(`Factura ${result.voucher?.formattedNumber || ''} autorizada correctamente.`)
    } catch (error) {
      setTestInvoiceResult({ ok: false, error: error.message })
      setNotice(error.message)
    } finally {
      setIssuingTestInvoice(false)
    }
  }

  const complete = Boolean(status?.hasCertificate)

  return (
    <main className="workspace">
      <Topbar section="arca" account={{ connected: false }} />
      {notice && <button className="notice-bar" type="button" onClick={() => setNotice('')}><span>{notice}</span><strong>×</strong></button>}

      <section className="arca-setup">
        <div className="arca-heading">
          <div>
            <span className="eyebrow">Configuración</span>
            <h2>Conectar ARCA</h2>
            <p>Homologación · CUIT {status?.cuit || '20366076957'} · Punto de venta 0003</p>
          </div>
          <span className={`arca-state ${connection?.connected ? 'connected' : complete ? 'ready' : ''}`}>
            {connection?.connected ? 'Conectado' : complete ? 'Certificado cargado' : 'En configuración'}
          </span>
        </div>

        <div className="setup-steps">
          <article className={`setup-card ${status?.hasCsr ? 'done' : 'active'}`}>
            <span className="step-number">1</span>
            <div>
              <h3>Generar identidad de Panadero</h3>
              <p>Panadero crea la clave privada y el CSR. La clave queda guardada únicamente en el backend.</p>
              {!status?.hasCsr ? (
                <button className="primary-button" type="button" onClick={generate} disabled={loading}>{loading ? 'Generando…' : 'Generar CSR'}</button>
              ) : <span className="step-ok">✓ CSR generado</span>}
            </div>
          </article>

          <article className={`setup-card ${csr ? 'active' : ''}`}>
            <span className="step-number">2</span>
            <div>
              <h3>Copiar en WSASS</h3>
              <p>Copiá el bloque completo y pegalo en “Solicitud de certificado en formato PKCS#10”.</p>
              {csr && <><textarea className="arca-textarea csr-output" value={csr} readOnly /><button className="ghost-button" type="button" onClick={copyCsr}>Copiar CSR</button></>}
            </div>
          </article>

          <article className={`setup-card ${status?.hasCsr ? 'active' : ''} ${complete ? 'done' : ''}`}>
            <span className="step-number">3</span>
            <div>
              <h3>Guardar certificado de ARCA</h3>
              <p>Después de crear el certificado en WSASS, copiá el resultado completo y pegalo acá.</p>
              {!complete ? <><textarea className="arca-textarea" value={certificate} onChange={(event) => setCertificate(event.target.value)} placeholder="-----BEGIN CERTIFICATE-----" /><button className="primary-button" type="button" onClick={saveCertificate} disabled={loading || !certificate.trim()}>Guardar certificado</button></> : <span className="step-ok">✓ Certificado almacenado</span>}
            </div>
          </article>

          <article className={`setup-card ${complete ? 'active' : ''} ${connection?.connected ? 'done' : ''}`}>
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
                <div className={`arca-connection-result ${connection.connected ? 'success' : 'error'}`}>
                  <strong>{connection.connected ? 'Conectado con ARCA' : 'No se pudo conectar'}</strong>
                  {connection.connected ? (
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

          <article className={`setup-card ${connection?.connected ? 'active' : ''} ${testInvoiceResult?.ok ? 'done' : ''}`}>
            <span className="step-number">5</span>
            <div>
              <h3>Emitir Factura C de prueba</h3>
              <p>
                Genera un comprobante real dentro del ambiente de homologación. Se emitirá a Consumidor Final,
                sin documento, usando el punto de venta 0003.
              </p>

              <div className="test-invoice-controls">
                <label className="test-amount-field">
                  <span>Importe de prueba</span>
                  <div>
                    <strong>$</strong>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={testAmount}
                      onChange={(event) => setTestAmount(event.target.value)}
                      disabled={!connection?.connected || issuingTestInvoice}
                    />
                  </div>
                </label>

                <button
                  className="primary-button"
                  type="button"
                  onClick={issueTestInvoice}
                  disabled={!connection?.connected || issuingTestInvoice || !testAmount}
                >
                  {issuingTestInvoice ? 'Emitiendo…' : 'Emitir Factura C de prueba'}
                </button>
              </div>

              <small className="test-invoice-warning">
                Cada prueba autorizada consume el próximo número de comprobante en homologación.
              </small>

              {testInvoiceResult && (
                <div className={`test-invoice-result ${testInvoiceResult.ok ? 'success' : 'error'}`}>
                  {testInvoiceResult.ok ? (
                    <>
                      <div className="test-invoice-result-heading">
                        <div>
                          <span>Factura autorizada</span>
                          <strong>{testInvoiceResult.voucher?.formattedNumber || '—'}</strong>
                        </div>
                        <span className="cae-badge">CAE aprobado</span>
                      </div>

                      <dl>
                        <div><dt>Tipo</dt><dd>{testInvoiceResult.voucher?.voucherTypeDescription || 'Factura C'}</dd></div>
                        <div><dt>Importe</dt><dd>{formatMoney(testInvoiceResult.voucher?.amount)}</dd></div>
                        <div><dt>CAE</dt><dd className="mono-value">{testInvoiceResult.cae || '—'}</dd></div>
                        <div><dt>Vencimiento CAE</dt><dd>{formatArcaDate(testInvoiceResult.caeExpirationDate)}</dd></div>
                        <div><dt>Ambiente</dt><dd>{testInvoiceResult.environment === 'production' ? 'Producción' : 'Homologación'}</dd></div>
                      </dl>
                    </>
                  ) : (
                    <>
                      <strong>No se pudo emitir la factura</strong>
                      <p>{testInvoiceResult.error}</p>
                    </>
                  )}
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
