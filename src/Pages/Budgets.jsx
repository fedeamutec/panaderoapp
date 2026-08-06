import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCurrency } from '../components/SalesTable'
import defaultClients from '../Data/BudgetClients.json'
import defaultProducts from '../Data/BudgetProducts.json'

const CLIENTS_KEY = 'panadero-budget-clients'
const PRODUCTS_KEY = 'panadero-budget-products'
const BRAND_KEY = 'panadero-budget-brand'
const BUDGETS_KEY = 'panadero-generated-budgets'

function readStored(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '')
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function clean(value) {
  return String(value ?? '').trim()
}

function parseDiscount(value) {
  const original = clean(value)
  const rates = original.match(/\d+(?:[.,]\d+)?/g)?.map((item) => Number(item.replace(',', '.'))) || []
  const factor = rates.reduce((current, rate) => current * (1 - rate / 100), 1)
  return {
    label: original || '0%',
    effective: Number(((1 - factor) * 100).toFixed(4)),
    factor,
  }
}

function escapeCsv(value) {
  const text = String(value ?? '').replace(/"/g, '""')
  return `"${text}"`
}

function downloadClientsCsv(clients) {
  const headers = ['Nombre', 'Razón social', 'CUIT / DNI', 'Condición fiscal', 'Dirección', 'Localidad', 'Código postal', 'Teléfono', 'Correo', 'Descuento']
  const rows = clients.map((client) => [
    client.name,
    client.legalName,
    client.cuit,
    client.taxCondition,
    client.address,
    client.locality,
    client.postalCode,
    client.phone,
    client.email,
    client.discount,
  ])
  const csv = `\ufeff${[headers, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `clientes-panadero-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}


function createClientId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function budgetTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
}

function Preview({ brand, client, items, number, draft = false }) {
  const total = items.reduce((sum, item) => sum + item.subtotal, 0)
  return (
    <div className="budget-paper">
      <header className="budget-paper-header">
        <div className="budget-paper-brand">
          {brand.logo && <img src={brand.logo} alt="" />}
          <div><strong>{brand.name || 'Nombre de fantasía'}</strong><small>{brand.subtitle || 'Presupuesto comercial'}</small></div>
        </div>
        <div className="budget-paper-number"><span>{draft ? 'BORRADOR DE PRESUPUESTO' : 'PRESUPUESTO'}</span><strong>N.º {String(number).padStart(6, '0')}</strong><small>{new Date().toLocaleDateString('es-AR')}</small></div>
      </header>

      <section className="budget-paper-client">
        <span>CLIENTE</span>
        <strong>{client?.legalName || 'Seleccioná un cliente'}</strong>
        <div>{client?.cuit ? `CUIT/DNI ${client.cuit}` : 'CUIT/DNI —'}</div>
        <div>{[client?.address, client?.locality].filter(Boolean).join(', ') || 'Dirección —'}</div>
      </section>

      <div className="budget-paper-table">
        <div className="budget-paper-row heading"><span>Código</span><span>Producto</span><span>Precio</span><span>Desc.</span><span>Precio neto</span><span>Cant.</span><span>Subtotal</span></div>
        {items.length ? items.map((item) => (
          <div className="budget-paper-row" key={item.rowId}>
            <span>{item.code}</span><span>{item.name}</span><span>{formatCurrency(item.price)}</span><span>{item.discountLabel}</span><span>{formatCurrency(item.discountedPrice)}</span><span>{item.quantity}</span><span>{formatCurrency(item.subtotal)}</span>
          </div>
        )) : <div className="budget-paper-empty">Agregá productos para comenzar el presupuesto.</div>}
      </div>

      <footer className="budget-paper-footer">
        <div><span>Validez</span><strong>{brand.validity || '10 días'}</strong><small>{brand.conditions || 'Precios sujetos a disponibilidad.'}</small></div>
        <div className="budget-paper-total"><span>TOTAL</span><strong>{formatCurrency(total)}</strong><small>Importe final sin desglose de IVA</small></div>
      </footer>
    </div>
  )
}


function TransportPreview({ brand, client, items, number }) {
  return (
    <div className="budget-paper transport-paper">
      <header className="budget-paper-header">
        <div className="budget-paper-brand">
          {brand.logo && <img src={brand.logo} alt="" />}
          <div><strong>{brand.name || 'Nombre de fantasía'}</strong><small>Comprobante de entrega</small></div>
        </div>
        <div className="budget-paper-number"><span>TRANSPORTE</span><strong>Presupuesto N.º {String(number).padStart(6, '0')}</strong><small>{new Date().toLocaleDateString('es-AR')}</small></div>
      </header>

      <section className="budget-paper-client">
        <span>DESTINATARIO</span>
        <strong>{client?.legalName || client?.name || 'Cliente'}</strong>
        <div>{client?.cuit ? `CUIT/DNI ${client.cuit}` : 'CUIT/DNI —'}</div>
        <div>{[client?.address, client?.locality].filter(Boolean).join(', ') || 'Dirección —'}</div>
      </section>

      <div className="transport-table">
        <div className="transport-row heading"><span>Código</span><span>Producto</span><span>Cantidad</span></div>
        {items.length ? items.map((item) => (
          <div className="transport-row" key={item.rowId || item.code}>
            <span>{item.code}</span><span>{item.name}</span><strong>{item.quantity}</strong>
          </div>
        )) : <div className="budget-paper-empty">No hay productos cargados.</div>}
      </div>

      <section className="transport-signatures">
        <div><span>Firma</span></div>
        <div><span>Aclaración</span></div>
        <div><span>DNI</span></div>
        <div><span>Fecha de entrega</span></div>
      </section>
      <footer className="transport-footer">Mercadería recibida conforme, correspondiente al presupuesto N.º {String(number).padStart(6, '0')}.</footer>
    </div>
  )
}

function Budgets() {
  const [clients, setClients] = useState(() => readStored(CLIENTS_KEY, defaultClients))
  const [products] = useState(() => readStored(PRODUCTS_KEY, defaultProducts))
  const [brand, setBrand] = useState(() => readStored(BRAND_KEY, { name: '', subtitle: '', validity: '10 días', conditions: '' }))
  const [selectedClientId, setSelectedClientId] = useState(() => readStored(CLIENTS_KEY, defaultClients)[0]?.id || '')
  const [clientQuery, setClientQuery] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [priceQuery, setPriceQuery] = useState('')
  const [items, setItems] = useState([])
  const [generatedBudgets, setGeneratedBudgets] = useState(() => readStored(BUDGETS_KEY, []))
  const [viewMode, setViewMode] = useState('new')
  const [confirmedBudget, setConfirmedBudget] = useState(null)
  const [selectedGeneratedId, setSelectedGeneratedId] = useState(() => readStored(BUDGETS_KEY, [])[0]?.id || '')
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [priceListOpen, setPriceListOpen] = useState(false)
  const [clientDraft, setClientDraft] = useState(null)
  const [printPayload, setPrintPayload] = useState(null)
  const clientInput = useRef(null)
  const productInput = useRef(null)

  const selectedClient = clients.find((client) => client.id === selectedClientId) || clients[0] || null
  const selectedGenerated = generatedBudgets.find((budget) => budget.id === selectedGeneratedId) || generatedBudgets[0] || null

  useEffect(() => {
    setClientDraft(selectedClient ? { ...selectedClient } : null)
  }, [selectedClientId, selectedClient])

  useEffect(() => {
    if (!printPayload) return undefined
    const timer = window.setTimeout(() => window.print(), 60)
    const clearPrint = () => setPrintPayload(null)
    window.addEventListener('afterprint', clearPrint, { once: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('afterprint', clearPrint)
    }
  }, [printPayload])

  const filteredClients = useMemo(() => {
    const query = normalize(clientQuery)
    if (!query) return clients
    return clients.filter((client) => [client.name, client.legalName, client.cuit, client.locality].some((value) => normalize(value).includes(query)))
  }, [clientQuery, clients])

  const productSuggestions = useMemo(() => {
    const query = normalize(productQuery)
    if (!query) return []
    return products.filter((product) => normalize(`${product.code} ${product.name} ${product.category}`).includes(query)).slice(0, 10)
  }, [productQuery, products])

  const visiblePrices = useMemo(() => {
    const query = normalize(priceQuery)
    if (!query) return products
    return products.filter((product) => normalize(`${product.code} ${product.name} ${product.category}`).includes(query))
  }, [priceQuery, products])

  const hasClientChanges = Boolean(clientDraft && selectedClient && JSON.stringify(clientDraft) !== JSON.stringify(selectedClient))

  const invalidateConfirmation = () => setConfirmedBudget(null)

  const selectClient = (clientId) => {
    setSelectedClientId(clientId)
    setItems([])
    setConfirmedBudget(null)
    setViewMode('new')
  }

  const addClient = () => {
    const id = createClientId()
    const newClient = {
      id,
      name: 'Nuevo cliente',
      legalName: '',
      cuit: '',
      taxCondition: '',
      address: '',
      locality: '',
      postalCode: '',
      phone: '',
      email: '',
      discount: '0%',
      discountFactor: 1,
      discountEffective: 0,
    }
    const nextClients = [newClient, ...clients]
    setClients(nextClients)
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(nextClients))
    setSelectedClientId(id)
    setClientDraft({ ...newClient })
    setClientQuery('')
    setItems([])
    setConfirmedBudget(null)
    setViewMode('new')
    setNotice('Cliente nuevo creado. Completá sus datos y presioná Guardar cliente.')
  }


  const deleteClient = () => {
    if (!selectedClient) return
    const label = selectedClient.legalName || selectedClient.name || 'este cliente'
    if (!window.confirm(`¿Eliminar a ${label}? Esta acción quitará al cliente de la lista, pero no borrará presupuestos ya confirmados.`)) return

    const nextClients = clients.filter((client) => client.id !== selectedClient.id)
    setClients(nextClients)
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(nextClients))
    setSelectedClientId(nextClients[0]?.id || '')
    setClientDraft(nextClients[0] ? { ...nextClients[0] } : null)
    setItems([])
    setConfirmedBudget(null)
    setNotice(`${label} fue eliminado de la base de clientes.`)
  }

  const createCurrentSnapshot = ({ draft = false } = {}) => ({
    number: confirmedBudget?.number || generatedBudgets.reduce((highest, budget) => Math.max(highest, Number(budget.number || 0)), 0) + 1,
    client: { ...(clientDraft || selectedClient || {}) },
    items: items.map((item) => ({ ...item })),
    brand: { ...brand },
    draft,
  })

  const printDraft = () => {
    if (!clientDraft && !selectedClient) {
      setNotice('Seleccioná un cliente antes de descargar el borrador.')
      return
    }
    setPrintPayload({ type: 'budget', data: createCurrentSnapshot({ draft: true }) })
  }

  const printConfirmedBudget = (budget = confirmedBudget) => {
    if (!budget) return
    setPrintPayload({ type: 'budget', data: { ...budget, draft: false } })
  }

  const printTransport = (budget = confirmedBudget) => {
    if (!budget) return
    setPrintPayload({ type: 'transport', data: budget })
  }

  const confirmBudget = () => {
    if (!clientDraft && !selectedClient) {
      setNotice('Seleccioná un cliente antes de confirmar el presupuesto.')
      return
    }
    if (!items.length) {
      setNotice('Agregá al menos un producto antes de confirmar el presupuesto.')
      return
    }

    const nextNumber = generatedBudgets.reduce((highest, budget) => Math.max(highest, Number(budget.number || 0)), 0) + 1
    const snapshot = {
      id: `budget-${Date.now()}`,
      number: nextNumber,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      client: { ...(clientDraft || selectedClient) },
      items: items.map((item) => ({ ...item })),
      brand: { ...brand },
      total: budgetTotal(items),
    }
    const nextBudgets = [snapshot, ...generatedBudgets]
    setGeneratedBudgets(nextBudgets)
    setSelectedGeneratedId(snapshot.id)
    setConfirmedBudget(snapshot)
    localStorage.setItem(BUDGETS_KEY, JSON.stringify(nextBudgets))
    setNotice(`Presupuesto N.º ${String(nextNumber).padStart(6, '0')} confirmado y guardado.`)
  }

  const openGeneratedBudget = (budget) => {
    setSelectedGeneratedId(budget.id)
  }

  const duplicateGeneratedBudget = (budget) => {
    const clientId = budget.client?.id
    if (clientId && clients.some((client) => client.id === clientId)) {
      setSelectedClientId(clientId)
    }
    setClientDraft({ ...(budget.client || {}) })
    setItems((budget.items || []).map((item, index) => ({ ...item, rowId: `${item.code}-${Date.now()}-${index}` })))
    setConfirmedBudget(null)
    setViewMode('new')
    setNotice('Presupuesto duplicado. Podés editarlo y confirmarlo como uno nuevo.')
  }

  const saveBrand = (next) => {
    invalidateConfirmation()
    setBrand(next)
    localStorage.setItem(BRAND_KEY, JSON.stringify(next))
  }

  const importClients = async (event) => {
    event.target.value = ''
    setNotice('La base inicial ya fue cargada desde el Excel. La importación directa de futuras actualizaciones queda para la próxima etapa.')
  }

  const importProducts = async (event) => {
    event.target.value = ''
    setNotice('La lista inicial ya fue cargada desde el Excel. La importación directa de futuras actualizaciones queda para la próxima etapa.')
  }

  const saveClient = () => {
    if (!clientDraft?.id) return
    invalidateConfirmation()
    const parsedDiscount = parseDiscount(clientDraft.discount)
    const updatedClient = {
      ...clientDraft,
      name: clean(clientDraft.name) || clean(clientDraft.legalName) || 'Cliente sin nombre',
      legalName: clean(clientDraft.legalName) || clean(clientDraft.name) || 'Cliente sin nombre',
      discount: parsedDiscount.label,
      discountFactor: parsedDiscount.factor,
      discountEffective: parsedDiscount.effective,
    }
    const nextClients = clients.map((client) => client.id === updatedClient.id ? updatedClient : client)
    setClients(nextClients)
    setClientDraft({ ...updatedClient })
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(nextClients))

    setItems((current) => current.map((item) => ({
      ...item,
      discountLabel: parsedDiscount.label,
      discountFactor: parsedDiscount.factor,
      discountedPrice: item.price * parsedDiscount.factor,
      subtotal: item.price * parsedDiscount.factor * item.quantity,
    })))
    setNotice('Los datos del cliente se guardaron correctamente.')
  }

  const addProduct = (product) => {
    invalidateConfirmation()
    const discount = parseDiscount(clientDraft?.discount || selectedClient?.discount)
    setItems((current) => {
      const existing = current.find((item) => item.code === product.code)
      if (existing) return current.map((item) => item.code === product.code ? { ...item, quantity: item.quantity + 1, subtotal: item.discountedPrice * (item.quantity + 1) } : item)
      const discountedPrice = product.price * discount.factor
      return [...current, {
        ...product,
        rowId: `${product.code}-${Date.now()}`,
        discountLabel: discount.label,
        discountFactor: discount.factor,
        discountedPrice,
        quantity: 1,
        subtotal: discountedPrice,
      }]
    })
    setProductQuery('')
  }

  const updateItem = (rowId, field, value) => {
    invalidateConfirmation()
    setItems((current) => current.map((item) => {
      if (item.rowId !== rowId) return item
      const next = { ...item, [field]: value }
      if (field === 'quantity') next.quantity = Math.max(1, Number(value) || 1)
      if (field === 'discountLabel') {
        const parsed = parseDiscount(value)
        next.discountFactor = parsed.factor
        next.discountedPrice = next.price * parsed.factor
      }
      next.subtotal = next.discountedPrice * next.quantity
      return next
    }))
  }

  const updateDraft = (field, value) => {
    invalidateConfirmation()
    setClientDraft((current) => current ? { ...current, [field]: value } : current)
  }

  return (
    <main className="budget-workspace">
      <header className="budget-topbar">
        <div className="budget-title-block"><span>Gestión comercial</span><h1>Presupuesto</h1><div className="budget-view-tabs"><button type="button" className={viewMode === 'new' ? 'active' : ''} onClick={() => setViewMode('new')}>Nuevo presupuesto</button><button type="button" className={viewMode === 'generated' ? 'active' : ''} onClick={() => setViewMode('generated')}>Presupuestos generados <small>{generatedBudgets.length}</small></button></div></div>
        <div className="budget-topbar-actions">
          <label className="ghost-button budget-file-button">Importar clientes<input ref={clientInput} type="file" accept=".xlsx,.xls" onChange={importClients} /></label>
          <button className="ghost-button" type="button" onClick={() => downloadClientsCsv(clients)}>Exportar clientes</button>
          <label className="ghost-button budget-file-button">Importar precios<input ref={productInput} type="file" accept=".xlsx,.xls" onChange={importProducts} /></label>
          <button className="ghost-button" type="button" onClick={() => setPriceListOpen(true)}>Ver lista de precios</button>
          <button className="primary-button" type="button" onClick={() => setSettingsOpen((current) => !current)}>Configurar marca</button>
        </div>
      </header>

      {notice && <button type="button" className="notice-bar" onClick={() => setNotice('')}><span>{notice}</span><strong>×</strong></button>}

      {settingsOpen && (
        <section className="budget-brand-settings">
          <label><span>Nombre de fantasía</span><input value={brand.name || ''} onChange={(event) => saveBrand({ ...brand, name: event.target.value })} placeholder="Ej. CR Argentina" /></label>
          <label><span>Bajada</span><input value={brand.subtitle || ''} onChange={(event) => saveBrand({ ...brand, subtitle: event.target.value })} placeholder="Fábrica y distribución" /></label>
          <label><span>Validez</span><input value={brand.validity || ''} onChange={(event) => saveBrand({ ...brand, validity: event.target.value })} /></label>
          <label className="brand-logo-upload"><span>Logo</span><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => saveBrand({ ...brand, logo: reader.result }); reader.readAsDataURL(file) }} /></label>
          <label className="brand-conditions"><span>Condiciones</span><input value={brand.conditions || ''} onChange={(event) => saveBrand({ ...brand, conditions: event.target.value })} placeholder="Entrega, pago y observaciones" /></label>
        </section>
      )}

      {viewMode === 'new' ? (
        <div className="budget-columns">
          <aside className="budget-clients-column">
            <div className="budget-column-heading"><div><span>Base comercial</span><strong>Clientes</strong></div><div className="budget-heading-actions"><small>{clients.length}</small><button type="button" className="budget-add-client" onClick={addClient}>＋ Agregar</button></div></div>
            <label className="budget-search"><span>⌕</span><input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Buscar cliente, CUIT…" /></label>
            <div className="budget-client-list">
              {filteredClients.length ? filteredClients.map((client) => (
                <button key={client.id} type="button" className={`budget-client-card ${selectedClient?.id === client.id ? 'active' : ''}`} onClick={() => selectClient(client.id)}>
                  <strong>{client.name}</strong><span>{client.legalName}</span><small>{client.cuit || 'Sin CUIT'} · {client.discount || '0%'}</small>
                </button>
              )) : <div className="budget-empty-list">No se encontraron clientes.</div>}
            </div>
          </aside>

          <section className="budget-editor-column">
            <div className="budget-column-heading budget-editor-heading">
              <div><span>Armado</span><strong>Datos y productos</strong></div>
              <div className="budget-client-actions">
                <button className="danger-ghost-button" type="button" disabled={!selectedClient} onClick={deleteClient}>Eliminar</button>
                <button className="ghost-button" type="button" disabled={!hasClientChanges} onClick={() => setClientDraft(selectedClient ? { ...selectedClient } : null)}>Deshacer</button>
                <button className="primary-button" type="button" disabled={!hasClientChanges} onClick={saveClient}>Guardar cliente</button>
              </div>
            </div>

            {clientDraft ? (
              <div className="budget-client-detail budget-client-form compact">
                <label><small>Nombre comercial</small><input value={clientDraft.name || ''} onChange={(event) => updateDraft('name', event.target.value)} /></label>
                <label><small>Razón social</small><input value={clientDraft.legalName || ''} onChange={(event) => updateDraft('legalName', event.target.value)} /></label>
                <label><small>CUIT / DNI</small><input value={clientDraft.cuit || ''} onChange={(event) => updateDraft('cuit', event.target.value)} /></label>
                <label><small>Condición fiscal</small><input value={clientDraft.taxCondition || ''} onChange={(event) => updateDraft('taxCondition', event.target.value)} /></label>
                <label className="budget-field-wide"><small>Dirección</small><input value={clientDraft.address || ''} onChange={(event) => updateDraft('address', event.target.value)} /></label>
                <label><small>Localidad</small><input value={clientDraft.locality || ''} onChange={(event) => updateDraft('locality', event.target.value)} /></label>
                <label><small>CP</small><input value={clientDraft.postalCode || ''} onChange={(event) => updateDraft('postalCode', event.target.value)} /></label>
                <label><small>Teléfono</small><input value={clientDraft.phone || ''} onChange={(event) => updateDraft('phone', event.target.value)} /></label>
                <label><small>Descuento</small><input value={clientDraft.discount || ''} onChange={(event) => updateDraft('discount', event.target.value)} /></label>
                <label className="budget-field-wide"><small>Correo</small><input value={clientDraft.email || ''} onChange={(event) => updateDraft('email', event.target.value)} /></label>
              </div>
            ) : <div className="budget-empty-editor">Seleccioná un cliente para editar sus datos.</div>}

            <div className="budget-product-picker">
              <label className="budget-search"><span>＋</span><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="Escribí código o producto…" disabled={!products.length || !selectedClient} /></label>
              {productSuggestions.length > 0 && <div className="budget-product-suggestions">{productSuggestions.map((product) => <button key={product.code} type="button" onClick={() => addProduct(product)}><span><strong>{product.code}</strong>{product.name}</span><small>{formatCurrency(product.price)}</small></button>)}</div>}
            </div>

            <div className="budget-item-editor">
              {items.map((item) => (
                <div className="budget-item-card" key={item.rowId}>
                  <div className="budget-item-name"><small>{item.code}</small><strong>{item.name}</strong></div>
                  <label><span>Precio</span><strong>{formatCurrency(item.price)}</strong></label>
                  <label><span>Descuento</span><input value={item.discountLabel} onChange={(event) => updateItem(item.rowId, 'discountLabel', event.target.value)} /></label>
                  <label><span>Precio neto</span><strong>{formatCurrency(item.discountedPrice)}</strong></label>
                  <label><span>Cantidad</span><input type="number" min="1" value={item.quantity} onChange={(event) => updateItem(item.rowId, 'quantity', event.target.value)} /></label>
                  <label><span>Subtotal</span><strong>{formatCurrency(item.subtotal)}</strong></label>
                  <button type="button" className="budget-remove-item" onClick={() => { invalidateConfirmation(); setItems((current) => current.filter((currentItem) => currentItem.rowId !== item.rowId)) }}>×</button>
                </div>
              ))}
              {!items.length && <div className="budget-empty-editor">Seleccioná un cliente y agregá productos desde la lista de precios.</div>}
            </div>
          </section>

          <section className="budget-preview-column">
            <div className="budget-column-heading"><div><span>Documento</span><strong>Vista previa</strong></div><div className="budget-preview-actions"><button className="ghost-button" type="button" onClick={printDraft}>Guardar borrador</button><button className="ghost-button budget-confirm-button" type="button" onClick={confirmBudget}>Confirmar</button><button className="ghost-button" type="button" disabled={!confirmedBudget} onClick={() => printTransport(confirmedBudget)}>Transporte</button><button className="primary-button" type="button" disabled={!confirmedBudget} onClick={() => printConfirmedBudget(confirmedBudget)}>PDF / Descargar</button></div></div>
            <div className="budget-preview-scroll"><Preview brand={brand} client={clientDraft || selectedClient} items={items} number={confirmedBudget?.number || generatedBudgets.reduce((highest, budget) => Math.max(highest, Number(budget.number || 0)), 0) + 1} /></div>
          </section>
        </div>
      ) : (
        <div className="generated-budget-layout">
          <aside className="generated-budget-list-column">
            <div className="budget-column-heading"><div><span>Historial</span><strong>Presupuestos generados</strong></div><small>{generatedBudgets.length}</small></div>
            <div className="generated-budget-list">
              {generatedBudgets.length ? generatedBudgets.map((budget) => (
                <button type="button" key={budget.id} className={`generated-budget-card ${selectedGenerated?.id === budget.id ? 'active' : ''}`} onClick={() => openGeneratedBudget(budget)}>
                  <span>N.º {String(budget.number).padStart(6, '0')}</span>
                  <strong>{budget.client?.legalName || budget.client?.name || 'Cliente'}</strong>
                  <small>{new Date(budget.createdAt).toLocaleDateString('es-AR')} · {formatCurrency(budget.total)}</small>
                </button>
              )) : <div className="budget-empty-list">Todavía no hay presupuestos confirmados.</div>}
            </div>
          </aside>
          <section className="generated-budget-detail-column">
            <div className="budget-column-heading"><div><span>Documento guardado</span><strong>{selectedGenerated ? `Presupuesto N.º ${String(selectedGenerated.number).padStart(6, '0')}` : 'Sin selección'}</strong></div>{selectedGenerated && <div className="budget-preview-actions"><button className="ghost-button" type="button" onClick={() => duplicateGeneratedBudget(selectedGenerated)}>Duplicar</button><button className="ghost-button" type="button" onClick={() => printTransport(selectedGenerated)}>Transporte</button><button className="primary-button" type="button" onClick={() => printConfirmedBudget(selectedGenerated)}>PDF / Descargar</button></div>}</div>
            <div className="budget-preview-scroll generated-preview-scroll">{selectedGenerated ? <Preview brand={selectedGenerated.brand || brand} client={selectedGenerated.client} items={selectedGenerated.items || []} number={selectedGenerated.number} /> : <div className="budget-empty-editor">Confirmá un presupuesto para verlo en el historial.</div>}</div>
          </section>
        </div>
      )}

      {printPayload && (
        <div className="print-only-document">
          {printPayload.type === 'transport'
            ? <TransportPreview brand={printPayload.data.brand || brand} client={printPayload.data.client} items={printPayload.data.items || []} number={printPayload.data.number} />
            : <Preview brand={printPayload.data.brand || brand} client={printPayload.data.client} items={printPayload.data.items || []} number={printPayload.data.number} draft={Boolean(printPayload.data.draft)} />}
        </div>
      )}

      {priceListOpen && (
        <div className="budget-modal-backdrop" role="presentation" onMouseDown={() => setPriceListOpen(false)}>
          <section className="budget-price-panel" role="dialog" aria-modal="true" aria-label="Lista de precios" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>Catálogo comercial</span><h2>Lista de precios</h2><small>{visiblePrices.length} de {products.length} productos</small></div>
              <button type="button" onClick={() => setPriceListOpen(false)} aria-label="Cerrar">×</button>
            </header>
            <label className="budget-search budget-price-search"><span>⌕</span><input autoFocus value={priceQuery} onChange={(event) => setPriceQuery(event.target.value)} placeholder="Buscar por código, producto o categoría…" /></label>
            <div className="budget-price-table">
              <div className="budget-price-row heading"><span>Código</span><span>Producto</span><span>Categoría</span><span>Precio lista / neto</span></div>
              {visiblePrices.map((product) => <div className="budget-price-row" key={product.code}><strong>{product.code}</strong><span>{product.name}</span><small>{product.category || 'Sin categoría'}</small><strong>{formatCurrency(product.price)}</strong></div>)}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default Budgets
