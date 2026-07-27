function Topbar({ account, loading, onSync, onConnect, onDisconnect, section = 'ventas' }) {
  const connected = Boolean(account?.connected)
  const isInvoices = section === 'facturas'

  return (
    <header className="topbar">
      <div>
        <div className="breadcrumb">
          <span>Panadero</span>
          <span>/</span>
          <strong>{isInvoices ? 'Facturas' : 'Ventas'}</strong>
        </div>
        <h1>{isInvoices ? 'Registro de facturación' : 'Ventas'}</h1>
      </div>

      <div className="topbar-actions">
        <div className="connection-pill">
          <span className={`status-dot ${connected ? 'connected' : ''}`} />
          <span>
            <strong>Mercado Libre</strong>
            <small>{connected ? account.nickname : 'Sin conectar'}</small>
          </span>
        </div>

        {!isInvoices && (
          <button className="ghost-button" type="button" onClick={onSync} disabled={loading || !connected}>
            {loading ? 'Sincronizando…' : '↻ Sincronizar'}
          </button>
        )}
        <button
          className={connected ? 'ghost-button' : 'primary-button'}
          type="button"
          onClick={connected ? onDisconnect : onConnect}
          disabled={loading}
        >
          {connected ? 'Desconectar' : 'Conectar cuenta'}
        </button>
      </div>
    </header>
  )
}

export default Topbar
