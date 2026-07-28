import { useCallback, useEffect, useState } from 'react'
import Topbar from '../components/Topbar'

const API_BASE = 'https://api.panaderoapp.com/api'

async function api(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo comunicar con Panadero API')
  return payload
}

function ArcaSettings() {
  const [status, setStatus] = useState(null)
  const [csr, setCsr] = useState('')
  const [certificate, setCertificate] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)

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
    setNotice('CSR copiado. Volvé a WSASS y pegalo en el campo grande.')
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
      setNotice('Certificado guardado correctamente. El próximo paso será autorizar wsfe.')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoading(false)
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
          <span className={`arca-state ${complete ? 'ready' : ''}`}>{complete ? 'Certificado cargado' : 'En configuración'}</span>
        </div>

        <div className="setup-steps">
          <article className={`setup-card ${status?.hasCsr ? 'done' : 'active'}`}>
            <span className="step-number">1</span>
            <div>
              <h3>Generar identidad de Panadero</h3>
              <p>Panadero crea la clave privada y el CSR. La clave queda guardada únicamente en el backend.</p>
              {!status?.hasCsr ? (
                <button className="primary-button" type="button" onClick={generate} disabled={loading}>{loading ? 'Generando…' : 'Generar CSR'}</button>
              ) : (
                <span className="step-ok">✓ CSR generado</span>
              )}
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
        </div>
      </section>
    </main>
  )
}

export default ArcaSettings
