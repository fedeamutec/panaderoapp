import { useEffect, useMemo, useRef, useState } from 'react'
import { formatCurrency } from '../components/SalesTable'
import defaultClients from '../Data/BudgetClients.json'
import defaultProducts from '../Data/BudgetProducts.json'

const CLIENTS_KEY = 'panadero-budget-clients'
const PRODUCTS_KEY = 'panadero-budget-products'
const BRAND_KEY = 'panadero-budget-brand'
const BUDGETS_KEY = 'panadero-generated-budgets'
const MANUAL_PRODUCTS_KEY = 'panadero-budget-manual-products'
const FX_KEY = 'panadero-budget-bna-fx'
const DEFAULT_PROFIT_KEY = 'panadero-budget-default-profit'
const CATALOG_OWNER_KEY = 'panadero-budget-catalog-owner'
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : 'https://api.panaderoapp.com/api'

const DEFAULT_BRAND = { id: 'brand-1', name: '', subtitle: '', validity: '10 días', conditions: '', logo: '', nextNumber: 1 }

function createBrandId() {
  return `brand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeBrandRecord(brand = {}, fallbackId = '') {
  const next = Number(brand.nextNumber || 1)
  return {
    ...DEFAULT_BRAND,
    ...brand,
    id: String(brand.id || fallbackId || createBrandId()),
    nextNumber: Number.isInteger(next) && next > 0 ? next : 1,
  }
}

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

function noticeTone(message) {
  const text = String(message || '').toLowerCase()
  if (/no se pudo|error|rechaz|fall|inválid|incorrect|vencid|duplicad.*existe/.test(text)) return 'error'
  if (/seleccioná|agregá|ingresá|completá|pendiente|revisar|todavía|falta|antes de/.test(text)) return 'warning'
  return 'success'
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

function numberValue(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : fallback
}

function calculateProductPricing(product, { fxSale = 0, profit = 0, discountFactor = 1 } = {}) {
  const currency = product.currency === 'USD' ? 'USD' : 'ARS'
  const basePrice = numberValue(product.basePrice ?? product.price)
  const vatRate = numberValue(product.vatRate, currency === 'USD' ? 21 : 0)
  const profitRate = numberValue(product.profitRate, profit)
  const convertedPrice = currency === 'USD' ? basePrice * numberValue(fxSale) : basePrice
  const priceWithVat = convertedPrice * (1 + vatRate / 100)
  const commercialPrice = priceWithVat * (1 + profitRate / 100)
  const discountedPrice = commercialPrice * discountFactor
  return { currency, basePrice, vatRate, profitRate, fxSale: currency === 'USD' ? numberValue(fxSale) : null, convertedPrice, priceWithVat, commercialPrice, discountedPrice }
}

function budgetTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
}

function Preview({ brand, client, items, number, draft = false, documentType = 'budget', authorized = false }) {
  const total = items.reduce((sum, item) => sum + item.subtotal, 0)
  const documentLabel = documentType === 'invoice-a' ? 'FACTURA A' : documentType === 'invoice-b' ? 'FACTURA B' : 'PRESUPUESTO'
  const subtitle = documentType === 'budget' ? (brand.subtitle || 'Presupuesto comercial') : authorized ? 'Comprobante electrónico autorizado por ARCA' : 'Vista previa · emisión ARCA pendiente'
  return (
    <div className="budget-paper">
      <header className="budget-paper-header">
        <div className="budget-paper-brand">
          {brand.logo && <img src={brand.logo} alt="" />}
          <div><strong>{brand.name || 'Nombre de fantasía'}</strong><small>{subtitle}</small></div>
        </div>
        <div className="budget-paper-number"><span>{draft ? `BORRADOR DE ${documentLabel}` : documentLabel}</span><strong>N.º {String(number).padStart(6, '0')}</strong><small>{new Date().toLocaleDateString('es-AR')}</small></div>
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
  const [products, setProducts] = useState(() => readStored(PRODUCTS_KEY, defaultProducts))
  const [manualProducts, setManualProducts] = useState(() => readStored(MANUAL_PRODUCTS_KEY, []))
  const [manualProductOpen, setManualProductOpen] = useState(false)
  const [manualProductDraft, setManualProductDraft] = useState({ code: '', name: '', category: 'Agregados', currency: 'ARS', basePrice: '', vatRate: 21, profitRate: 30 })
  const [defaultProfit, setDefaultProfit] = useState(() => numberValue(localStorage.getItem(DEFAULT_PROFIT_KEY), 30))
  const [fx, setFx] = useState(() => readStored(FX_KEY, { buy: 0, sell: 0, date: '', time: '', source: 'BNA', manual: false }))
  const [fxLoading, setFxLoading] = useState(false)
  const legacyBrand = readStored(BRAND_KEY, DEFAULT_BRAND)
  const [brands, setBrands] = useState(() => [normalizeBrandRecord(legacyBrand, 'brand-1')])
  const [activeBrandId, setActiveBrandId] = useState('brand-1')
  const [brandDraft, setBrandDraft] = useState(null)
  const [selectedClientId, setSelectedClientId] = useState(() => readStored(CLIENTS_KEY, defaultClients)[0]?.id || '')
  const [clientQuery, setClientQuery] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [priceQuery, setPriceQuery] = useState('')
  const [items, setItems] = useState([])
  const [documentType, setDocumentType] = useState('budget')
  const [commercialInvoice, setCommercialInvoice] = useState(null)
  const [invoiceSequence, setInvoiceSequence] = useState(null)
  const [invoiceSequenceLoading, setInvoiceSequenceLoading] = useState(false)
  const [invoiceEmitting, setInvoiceEmitting] = useState(false)
  const [generatedBudgets, setGeneratedBudgets] = useState(() => readStored(BUDGETS_KEY, []))
  const [nextNumber, setNextNumber] = useState(1)
  const [serverBudgetReady, setServerBudgetReady] = useState(false)
  const [viewMode, setViewMode] = useState('new')
  const [confirmedBudget, setConfirmedBudget] = useState(null)
  const [selectedGeneratedId, setSelectedGeneratedId] = useState(() => readStored(BUDGETS_KEY, [])[0]?.id || '')
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [priceListOpen, setPriceListOpen] = useState(false)
  const [clientsCollapsed, setClientsCollapsed] = useState(false)
  const [clientDraft, setClientDraft] = useState(null)
  const [printPayload, setPrintPayload] = useState(null)
  const clientInput = useRef(null)
  const productInput = useRef(null)

  const allProducts = useMemo(() => [...manualProducts, ...products], [manualProducts, products])
  const brand = useMemo(() => brands.find((item) => item.id === activeBrandId) || brands[0] || DEFAULT_BRAND, [brands, activeBrandId])

  const selectedClient = clients.find((client) => client.id === selectedClientId) || clients[0] || null
  const selectedGenerated = generatedBudgets.find((budget) => budget.id === selectedGeneratedId) || generatedBudgets[0] || null

  useEffect(() => {
    let cancelled = false
    const loadBudgetState = async () => {
      try {
        const response = await fetch(`${API_BASE}/budgets/state`, { credentials: 'include' })
        if (!response.ok) throw new Error(`No se pudo cargar la configuración de presupuestos (${response.status}).`)
        const data = await response.json()
        if (cancelled) return

        const serverBrands = Array.isArray(data.brands) && data.brands.length
          ? data.brands.map((item, index) => normalizeBrandRecord(item, `brand-${index + 1}`))
          : [normalizeBrandRecord(data.brand || legacyBrand, 'brand-1')]
        const serverActiveId = serverBrands.some((item) => item.id === data.activeBrandId)
          ? data.activeBrandId
          : serverBrands[0].id
        setBrands(serverBrands)
        setActiveBrandId(serverActiveId)
        const activeServerBrand = serverBrands.find((item) => item.id === serverActiveId) || serverBrands[0]
        setNextNumber(Number(activeServerBrand?.nextNumber || data.nextNumber || 1))
        localStorage.setItem(BRAND_KEY, JSON.stringify(activeServerBrand))

        if (Array.isArray(data.generatedBudgets)) {
          setGeneratedBudgets(data.generatedBudgets)
          setSelectedGeneratedId(data.generatedBudgets[0]?.id || '')
          localStorage.setItem(BUDGETS_KEY, JSON.stringify(data.generatedBudgets))
        }

        // Clientes/productos pertenecen a la cuenta autenticada. La copia antigua de
        // localStorage se migra una sola vez a la cuenta que ya usaba Panadero.
        const accountId = String(data.account || '')
        const catalogOwner = localStorage.getItem(CATALOG_OWNER_KEY) || ''
        const serverCatalogReady = data.catalogInitialized === true

        if (serverCatalogReady) {
          const serverClients = Array.isArray(data.clients) ? data.clients : []
          const serverProducts = Array.isArray(data.products) ? data.products : []
          const serverManualProducts = Array.isArray(data.manualProducts) ? data.manualProducts : []
          setClients(serverClients)
          setSelectedClientId(serverClients[0]?.id || '')
          setProducts(serverProducts)
          setManualProducts(serverManualProducts)
          localStorage.setItem(CLIENTS_KEY, JSON.stringify(serverClients))
          localStorage.setItem(PRODUCTS_KEY, JSON.stringify(serverProducts))
          localStorage.setItem(MANUAL_PRODUCTS_KEY, JSON.stringify(serverManualProducts))
          if (accountId) localStorage.setItem(CATALOG_OWNER_KEY, accountId)
        } else if (accountId && catalogOwner && catalogOwner !== accountId) {
          // Una cuenta nueva nunca hereda el catálogo local de otra sesión.
          setClients([])
          setSelectedClientId('')
          setProducts([])
          setManualProducts([])
          localStorage.setItem(CLIENTS_KEY, '[]')
          localStorage.setItem(PRODUCTS_KEY, '[]')
          localStorage.setItem(MANUAL_PRODUCTS_KEY, '[]')
          localStorage.setItem(CATALOG_OWNER_KEY, accountId)
        } else if (accountId) {
          localStorage.setItem(CATALOG_OWNER_KEY, accountId)
        }

        if (serverCatalogReady && Number.isFinite(Number(data.defaultProfit))) {
          setDefaultProfit(Number(data.defaultProfit))
          localStorage.setItem(DEFAULT_PROFIT_KEY, String(data.defaultProfit))
        }

      } catch (error) {
        console.warn('No se pudo cargar el estado online de presupuestos:', error)
      } finally {
        if (!cancelled) setServerBudgetReady(true)
      }
    }
    loadBudgetState()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!serverBudgetReady) return undefined
    const timer = window.setTimeout(async () => {
      try {
        await fetch(`${API_BASE}/budgets/settings`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clients, products, manualProducts, defaultProfit }),
        })
      } catch (error) {
        console.warn('No se pudo guardar el catálogo online de presupuestos:', error)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [serverBudgetReady, clients, products, manualProducts, defaultProfit])

  useEffect(() => {
    const loadFx = async () => {
      setFxLoading(true)
      try {
        const response = await fetch(`${API_BASE}/exchange/bna`)
        if (!response.ok) throw new Error('No se pudo obtener BNA')
        const data = await response.json()
        if (!data?.sell) throw new Error('Cotización incompleta')
        const next = { ...data, manual: false }
        setFx(next)
        localStorage.setItem(FX_KEY, JSON.stringify(next))
      } catch {
        // Conserva la última cotización guardada y permite editarla manualmente.
      } finally {
        setFxLoading(false)
      }
    }
    loadFx()
  }, [])

  useEffect(() => {
    if (documentType === 'budget') {
      setInvoiceSequence(null)
      setCommercialInvoice(null)
      return undefined
    }

    let cancelled = false
    const loadSequence = async () => {
      setInvoiceSequenceLoading(true)
      setCommercialInvoice(null)
      try {
        const invoiceType = documentType === 'invoice-a' ? 'A' : 'B'
        const response = await fetch(`${API_BASE}/arca/commercial-sequence?invoiceType=${invoiceType}`, {
          credentials: 'include',
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.error || 'No se pudo consultar la numeración de ARCA.')
        if (!cancelled) setInvoiceSequence(data)
      } catch (error) {
        if (!cancelled) {
          setInvoiceSequence(null)
          setNotice(error.message)
        }
      } finally {
        if (!cancelled) setInvoiceSequenceLoading(false)
      }
    }
    loadSequence()
    return () => { cancelled = true }
  }, [documentType])

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

    const scoreClient = (client) => {
      const fields = [
        { value: client.name, weight: 0 },
        { value: client.legalName, weight: 1 },
        { value: client.cuit, weight: 2 },
        { value: client.locality, weight: 3 },
      ]

      let bestScore = Number.POSITIVE_INFINITY

      fields.forEach(({ value, weight }) => {
        const normalizedValue = normalize(value)
        if (!normalizedValue) return

        if (normalizedValue === query) {
          bestScore = Math.min(bestScore, weight)
          return
        }

        if (normalizedValue.startsWith(query)) {
          bestScore = Math.min(bestScore, 10 + weight)
          return
        }

        const words = normalizedValue.split(/\s+/)
        if (words.some((word) => word.startsWith(query))) {
          bestScore = Math.min(bestScore, 20 + weight)
          return
        }

        const position = normalizedValue.indexOf(query)
        if (position >= 0) {
          bestScore = Math.min(bestScore, 30 + weight + position / 1000)
        }
      })

      return bestScore
    }

    return clients
      .map((client, index) => ({ client, index, score: scoreClient(client) }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((entry) => entry.client)
  }, [clientQuery, clients])

  const productSuggestions = useMemo(() => {
    const query = normalize(productQuery)
    if (!query) return []
    return allProducts.filter((product) => normalize(`${product.code} ${product.name} ${product.category}`).includes(query)).slice(0, 10)
  }, [productQuery, allProducts])

  const visiblePrices = useMemo(() => {
    const query = normalize(priceQuery)
    if (!query) return allProducts
    return allProducts.filter((product) => normalize(`${product.code} ${product.name} ${product.category}`).includes(query))
  }, [priceQuery, allProducts])

  const hasClientChanges = Boolean(clientDraft && selectedClient && JSON.stringify(clientDraft) !== JSON.stringify(selectedClient))

  const invalidateConfirmation = () => {
    setConfirmedBudget(null)
    setCommercialInvoice(null)
  }

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
    number: confirmedBudget?.number || nextNumber,
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

  const confirmBudget = async () => {
    if (!clientDraft && !selectedClient) {
      setNotice('Seleccioná un cliente antes de confirmar el presupuesto.')
      return
    }
    if (!items.length) {
      setNotice('Agregá al menos un producto antes de confirmar el presupuesto.')
      return
    }

    const requestedNumber = Number(nextNumber)
    if (!Number.isInteger(requestedNumber) || requestedNumber <= 0) {
      setNotice('Ingresá un número de presupuesto válido.')
      return
    }

    const snapshot = {
      id: `budget-${Date.now()}`,
      number: requestedNumber,
      createdAt: new Date().toISOString(),
      status: 'confirmed',
      client: { ...(clientDraft || selectedClient) },
      items: items.map((item) => ({ ...item })),
      brand: { ...brand },
      total: budgetTotal(items),
    }

    try {
      const response = await fetch(`${API_BASE}/budgets/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: requestedNumber, brandId: brand.id, budget: snapshot }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo confirmar el presupuesto.')

      const confirmed = data.budget || snapshot
      const nextBudgets = Array.isArray(data.generatedBudgets) ? data.generatedBudgets : [confirmed, ...generatedBudgets]
      setGeneratedBudgets(nextBudgets)
      setSelectedGeneratedId(confirmed.id)
      setConfirmedBudget(confirmed)
      if (Array.isArray(data.brands) && data.brands.length) {
        const nextBrands = data.brands.map((item, index) => normalizeBrandRecord(item, `brand-${index + 1}`))
        setBrands(nextBrands)
        const nextActive = data.activeBrandId || activeBrandId
        setActiveBrandId(nextActive)
        const nextBrand = nextBrands.find((item) => item.id === nextActive) || nextBrands[0]
        setNextNumber(Number(nextBrand?.nextNumber || data.nextNumber || requestedNumber + 1))
        localStorage.setItem(BRAND_KEY, JSON.stringify(nextBrand))
      } else {
        setNextNumber(Number(data.nextNumber) || requestedNumber + 1)
      }
      localStorage.setItem(BUDGETS_KEY, JSON.stringify(nextBudgets))
      setNotice(`Presupuesto N.º ${String(requestedNumber).padStart(6, '0')} confirmado y guardado online.`)
    } catch (error) {
      setNotice(error.message)
    }
  }

  const emitCommercialInvoice = async () => {
    const client = clientDraft || selectedClient
    if (!client) {
      setNotice('Seleccioná un cliente antes de emitir la factura.')
      return
    }
    if (!items.length) {
      setNotice('Agregá al menos un producto antes de emitir la factura.')
      return
    }

    const invoiceType = documentType === 'invoice-a' ? 'A' : documentType === 'invoice-b' ? 'B' : ''
    if (!invoiceType) return

    const total = budgetTotal(items)
    const documentLabel = `Factura ${invoiceType}`
    const expectedNumber = invoiceSequence?.formattedNextNumber || 'el próximo número disponible de ARCA'
    if (!window.confirm(`¿Emitir ${documentLabel} por ${formatCurrency(total)} en el punto de venta 0003?\n\nARCA asignará ${expectedNumber}. Esta acción solicita un CAE real y no se puede deshacer.`)) return

    const requestId = `general-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setInvoiceEmitting(true)
    try {
      const response = await fetch(`${API_BASE}/arca/commercial-invoice`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          confirmation: `EMITIR_FACTURA_${invoiceType}_${requestId}`,
          invoiceType,
          client,
          items,
          brand,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `No se pudo emitir la ${documentLabel}.`)

      setCommercialInvoice(data.invoice)
      setNotice(`${documentLabel} ${data.invoice?.voucher?.formattedNumber || ''} autorizada por ARCA. CAE ${data.invoice?.cae || ''}.`)
      try {
        const sequenceResponse = await fetch(`${API_BASE}/arca/commercial-sequence?invoiceType=${invoiceType}`, { credentials: 'include' })
        const nextSequence = await sequenceResponse.json().catch(() => ({}))
        if (sequenceResponse.ok) setInvoiceSequence(nextSequence)
      } catch {
        // La factura ya quedó autorizada; la numeración se refrescará al volver a entrar.
      }
    } catch (error) {
      setNotice(error.message)
    } finally {
      setInvoiceEmitting(false)
    }
  }

  const openCommercialInvoicePdf = () => {
    if (!commercialInvoice?.id) return
    window.open(`${API_BASE}/arca/commercial-invoices/${encodeURIComponent(commercialInvoice.id)}/pdf`, '_blank', 'noopener,noreferrer')
  }

  const createDebitNote = async (budget = confirmedBudget) => {
    if (!budget || budget.status !== 'confirmed') {
      setNotice('Primero confirmá el presupuesto para generar una nota de débito.')
      return
    }
    if (budget.debitNote) {
      setNotice('Este presupuesto ya tiene una nota de débito asociada.')
      return
    }

    const reason = window.prompt('Motivo de la nota de débito:', 'Ajuste comercial')
    if (reason === null) return

    const amountInput = window.prompt(
      'Importe de la nota de débito:',
      String(Number(budget.total || 0).toFixed(2)).replace('.', ','),
    )
    if (amountInput === null) return
    const amount = Number(String(amountInput).replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Ingresá un importe válido para la nota de débito.')
      return
    }

    if (!window.confirm(`¿Generar nota de débito por ${formatCurrency(amount)} para el presupuesto N.º ${String(budget.number).padStart(6, '0')}?`)) return

    try {
      const response = await fetch(`${API_BASE}/budgets/${encodeURIComponent(budget.id)}/debit-note`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: clean(reason) || 'Ajuste comercial' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo generar la nota de débito.')

      const updated = data.budget || budget
      const nextBudgets = Array.isArray(data.generatedBudgets)
        ? data.generatedBudgets
        : generatedBudgets.map((item) => item.id === updated.id ? updated : item)
      setGeneratedBudgets(nextBudgets)
      setSelectedGeneratedId(updated.id)
      setConfirmedBudget(updated)
      localStorage.setItem(BUDGETS_KEY, JSON.stringify(nextBudgets))
      setNotice(`Nota de débito registrada para el presupuesto N.º ${String(updated.number).padStart(6, '0')}.`)
    } catch (error) {
      setNotice(error.message)
    }
  }

  const cancelGeneratedBudget = async (budget) => {
    if (!budget || budget.status !== 'confirmed') {
      setNotice('Solo se puede cancelar un presupuesto confirmado.')
      return
    }
    if (budget.cancelledAt) {
      setNotice('Este presupuesto ya está cancelado.')
      return
    }
    const choice = window.prompt('Al cancelar, elegí el comprobante asociado: escribí C para Nota de crédito o D para Nota de débito.', 'C')
    if (choice === null) return
    const normalized = clean(choice).toUpperCase()
    const noteType = normalized.startsWith('D') ? 'debit' : normalized.startsWith('C') ? 'credit' : ''
    if (!noteType) {
      setNotice('Elegí C para Nota de crédito o D para Nota de débito.')
      return
    }
    const reason = window.prompt('Motivo de la cancelación:', 'Cancelación comercial')
    if (reason === null) return
    if (!window.confirm(`¿Cancelar el presupuesto N.º ${String(budget.number).padStart(6, '0')}? El presupuesto seguirá visible en el historial.`)) return
    try {
      const response = await fetch(`${API_BASE}/budgets/${encodeURIComponent(budget.id)}/cancel`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteType, reason: clean(reason) || 'Cancelación comercial' }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo cancelar el presupuesto.')
      const nextBudgets = data.generatedBudgets || generatedBudgets
      setGeneratedBudgets(nextBudgets)
      setSelectedGeneratedId(budget.id)
      localStorage.setItem(BUDGETS_KEY, JSON.stringify(nextBudgets))
      setNotice(`Presupuesto N.º ${String(budget.number).padStart(6, '0')} cancelado correctamente.`)
    } catch (error) { setNotice(error.message) }
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

  const openNewBrand = () => {
    setBrandDraft({ ...DEFAULT_BRAND, id: createBrandId(), name: '', subtitle: '', validity: '10 días', conditions: '', logo: '', nextNumber: 1 })
    setSettingsOpen(true)
  }

  const editActiveBrand = () => {
    setBrandDraft({ ...brand })
    setSettingsOpen(true)
  }

  const saveBrandDraft = async () => {
    if (!brandDraft) return
    const cleaned = normalizeBrandRecord({ ...brandDraft, name: clean(brandDraft.name) || 'Marca sin nombre' })
    const exists = brands.some((item) => item.id === cleaned.id)
    const nextBrands = exists
      ? brands.map((item) => item.id === cleaned.id ? cleaned : item)
      : [...brands, cleaned]
    try {
      const response = await fetch(`${API_BASE}/budgets/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: nextBrands, activeBrandId: cleaned.id }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar la marca.')
      const storedBrands = (Array.isArray(data.brands) && data.brands.length ? data.brands : nextBrands).map((item, index) => normalizeBrandRecord(item, `brand-${index + 1}`))
      setBrands(storedBrands)
      setActiveBrandId(cleaned.id)
      const stored = storedBrands.find((item) => item.id === cleaned.id) || cleaned
      setNextNumber(Number(stored.nextNumber || 1))
      localStorage.setItem(BRAND_KEY, JSON.stringify(stored))
      setBrandDraft(null)
      setSettingsOpen(false)
      setConfirmedBudget(null)
      setNotice(`${stored.name} fue guardada y quedó seleccionada.`)
    } catch (error) {
      setNotice(error.message)
    }
  }

  const selectBrand = async (brandId) => {
    const selected = brands.find((item) => item.id === brandId)
    if (!selected) return
    setActiveBrandId(brandId)
    setNextNumber(Number(selected.nextNumber || 1))
    setConfirmedBudget(null)
    localStorage.setItem(BRAND_KEY, JSON.stringify(selected))
    try {
      await fetch(`${API_BASE}/budgets/settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands, activeBrandId: brandId }),
      })
    } catch {
      // La selección local sigue disponible aunque el servidor esté temporalmente inaccesible.
    }
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
    const pricing = calculateProductPricing(product, { fxSale: fx.sell, profit: defaultProfit, discountFactor: discount.factor })
    if (product.currency === 'USD' && !pricing.fxSale) {
      setNotice('Ingresá una cotización de dólar venta antes de agregar productos en USD.')
      return
    }
    setItems((current) => {
      const existing = current.find((item) => item.code === product.code)
      if (existing) return current.map((item) => item.code === product.code ? { ...item, quantity: item.quantity + 1, subtotal: item.discountedPrice * (item.quantity + 1) } : item)
      return [...current, {
        ...product,
        ...pricing,
        price: pricing.commercialPrice,
        rowId: `${product.code}-${Date.now()}`,
        discountLabel: discount.label,
        discountFactor: discount.factor,
        quantity: 1,
        subtotal: pricing.discountedPrice,
      }]
    })
    setProductQuery('')
  }

  const saveManualProduct = () => {
    const code = clean(manualProductDraft.code)
    const name = clean(manualProductDraft.name)
    const basePrice = numberValue(manualProductDraft.basePrice)
    if (!code || !name || basePrice <= 0) {
      setNotice('Completá código, producto y un precio mayor a cero.')
      return
    }
    if (allProducts.some((product) => normalize(product.code) === normalize(code))) {
      setNotice('Ya existe un producto con ese código.')
      return
    }
    const product = {
      id: `manual-${Date.now()}`,
      code,
      name,
      category: clean(manualProductDraft.category) || 'Agregados',
      currency: manualProductDraft.currency === 'USD' ? 'USD' : 'ARS',
      basePrice,
      price: basePrice,
      vatRate: numberValue(manualProductDraft.vatRate, manualProductDraft.currency === 'USD' ? 21 : 0),
      profitRate: Math.max(0, numberValue(manualProductDraft.profitRate, defaultProfit)),
      manual: true,
    }
    const next = [product, ...manualProducts]
    setManualProducts(next)
    localStorage.setItem(MANUAL_PRODUCTS_KEY, JSON.stringify(next))
    setManualProductDraft({ code: '', name: '', category: 'Agregados', currency: 'ARS', basePrice: '', vatRate: 21, profitRate: defaultProfit })
    setManualProductOpen(false)
    setNotice(`${name} fue agregado al catálogo manual.`)
  }

  const updateFxSell = (value) => {
    const next = { ...fx, sell: numberValue(value), manual: true, date: new Date().toLocaleDateString('es-AR'), time: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) }
    setFx(next)
    localStorage.setItem(FX_KEY, JSON.stringify(next))
    invalidateConfirmation()
  }

  const updateDefaultProfit = (value) => {
    const next = Math.max(0, numberValue(value))
    setDefaultProfit(next)
    localStorage.setItem(DEFAULT_PROFIT_KEY, String(next))
  }


  const updateCatalogProduct = (product, field, value) => {
    const numericFields = new Set(['basePrice', 'vatRate', 'profitRate'])
    const nextValue = numericFields.has(field) ? Math.max(0, numberValue(value)) : value
    const updateOne = (candidate) => {
      const same = product.id ? candidate.id === product.id : candidate.code === product.code
      if (!same) return candidate
      const updated = { ...candidate, [field]: nextValue }
      if (field === 'basePrice') updated.price = nextValue
      if (field === 'currency' && nextValue === 'USD' && !Number(updated.vatRate)) updated.vatRate = 21
      return updated
    }

    if (product.manual) {
      const next = manualProducts.map(updateOne)
      setManualProducts(next)
      localStorage.setItem(MANUAL_PRODUCTS_KEY, JSON.stringify(next))
    } else {
      const next = products.map(updateOne)
      setProducts(next)
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(next))
    }
    invalidateConfirmation()
  }

  const deleteCatalogProduct = (product) => {
    if (!window.confirm(`¿Eliminar ${product.name || product.code} de la lista de precios?`)) return
    const keep = (candidate) => product.id ? candidate.id !== product.id : candidate.code !== product.code
    if (product.manual) {
      const next = manualProducts.filter(keep)
      setManualProducts(next)
      localStorage.setItem(MANUAL_PRODUCTS_KEY, JSON.stringify(next))
    } else {
      const next = products.filter(keep)
      setProducts(next)
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(next))
    }
    setItems((current) => current.filter((item) => item.code !== product.code))
    invalidateConfirmation()
    setNotice(`${product.name || product.code} fue eliminado de la lista de precios.`)
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
      if (field === 'profitRate' && next.currency === 'USD') {
        const pricing = calculateProductPricing(next, { fxSale: next.fxSale || fx.sell, profit: numberValue(value), discountFactor: next.discountFactor })
        Object.assign(next, pricing, { price: pricing.commercialPrice })
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
          <button className="ghost-button" type="button" onClick={() => { setManualProductDraft((current) => ({ ...current, profitRate: defaultProfit })); setManualProductOpen(true) }}>＋ Agregar producto</button>
          <button className="primary-button" type="button" onClick={openNewBrand}>Agregar marca</button>
        </div>
      </header>

      {notice && <button type="button" className={`notice-bar ${noticeTone(notice)}`} onClick={() => setNotice('')}><span>{notice}</span><strong>×</strong></button>}

      <section className="budget-fx-strip">
        <div className="commercial-document-tabs" aria-label="Tipo de documento">
          <button type="button" className={documentType === 'budget' ? 'active' : ''} onClick={() => setDocumentType('budget')}>Presupuesto</button>
          <button type="button" className={documentType === 'invoice-a' ? 'active' : ''} onClick={() => setDocumentType('invoice-a')}>Factura A</button>
          <button type="button" className={documentType === 'invoice-b' ? 'active' : ''} onClick={() => setDocumentType('invoice-b')}>Factura B</button>
        </div>
        <div className="budget-fx-source"><span>Dólar BNA · Billete</span><small>{fxLoading ? 'Actualizando…' : fx.manual ? 'Cotización manual' : [fx.date, fx.time].filter(Boolean).join(' · ') || 'Última cotización disponible'}</small></div>
        <div className="budget-fx-value"><span>Compra</span><strong>{fx.buy ? formatCurrency(fx.buy) : '—'}</strong></div>
        <label className="budget-fx-value editable"><span>Venta usada</span><input type="number" min="0" step="0.01" value={fx.sell || ''} onChange={(event) => updateFxSell(event.target.value)} placeholder="Cotización" /></label>
        <label className="budget-fx-value editable"><span>Ganancia USD predet.</span><div><input type="number" min="0" step="0.1" value={defaultProfit} onChange={(event) => updateDefaultProfit(event.target.value)} /><b>%</b></div></label>
        <small className="budget-fx-note">La cotización y la ganancia son internas y no aparecen en el PDF.</small>
      </section>

      {settingsOpen && brandDraft && (
        <section className="budget-brand-settings multi-brand-settings">
          <label><span>Nombre de fantasía</span><input value={brandDraft.name || ''} onChange={(event) => setBrandDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. CR Argentina" /></label>
          <label><span>Bajada</span><input value={brandDraft.subtitle || ''} onChange={(event) => setBrandDraft((current) => ({ ...current, subtitle: event.target.value }))} placeholder="Fábrica y distribución" /></label>
          <label><span>Validez</span><input value={brandDraft.validity || ''} onChange={(event) => setBrandDraft((current) => ({ ...current, validity: event.target.value }))} /></label>
          <label className="brand-logo-upload"><span>Logo</span><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setBrandDraft((current) => ({ ...current, logo: reader.result })); reader.readAsDataURL(file) }} /></label>
          <label className="brand-conditions"><span>Condiciones</span><input value={brandDraft.conditions || ''} onChange={(event) => setBrandDraft((current) => ({ ...current, conditions: event.target.value }))} placeholder="Entrega, pago y observaciones" /></label>
          <div className="brand-settings-actions"><button className="ghost-button" type="button" onClick={() => { setSettingsOpen(false); setBrandDraft(null) }}>Cancelar</button><button className="primary-button" type="button" onClick={saveBrandDraft}>Guardar marca</button></div>
        </section>
      )}

      {viewMode === 'new' ? (
        <div className={`budget-columns ${clientsCollapsed ? 'clients-collapsed' : ''}`}>
          <aside className={`budget-clients-column ${clientsCollapsed ? 'collapsed' : ''}`}>
            <div className="budget-column-heading"><div className="budget-clients-title"><span>Base comercial</span><strong>Clientes</strong></div><div className="budget-heading-actions">{!clientsCollapsed && <><small>{clients.length}</small><button type="button" className="budget-add-client" onClick={addClient}>＋ Agregar</button></>}<button type="button" className="budget-clients-collapse" onClick={() => setClientsCollapsed((value) => !value)} aria-label={clientsCollapsed ? 'Mostrar clientes' : 'Ocultar clientes'}>{clientsCollapsed ? '›' : '‹'}</button></div></div>
            {!clientsCollapsed && <><label className="budget-search"><span>⌕</span><input value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Buscar cliente, CUIT…" /></label>
            <div className="budget-client-list">
              {filteredClients.length ? filteredClients.map((client) => (
                <button key={client.id} type="button" className={`budget-client-card ${selectedClient?.id === client.id ? 'active' : ''}`} onClick={() => selectClient(client.id)}>
                  <strong>{client.name}</strong><span>{client.legalName}</span><small>{client.cuit || 'Sin CUIT'} · {client.discount || '0%'}</small>
                </button>
              )) : <div className="budget-empty-list">No se encontraron clientes.</div>}
            </div></>}
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
              {productSuggestions.length > 0 && <div className="budget-product-suggestions">{productSuggestions.map((product) => <button key={product.code} type="button" onClick={() => addProduct(product)}><span><strong>{product.code}</strong>{product.name}</span><small>{product.currency === 'USD' ? `USD ${Number(product.basePrice ?? product.price).toLocaleString('es-AR')}` : formatCurrency(product.price)}</small></button>)}</div>}
            </div>

            <div className="budget-item-editor">
              {items.map((item) => (
                <div className="budget-item-card" key={item.rowId}>
                  <div className="budget-item-name"><small>{item.code}{item.currency === 'USD' ? ' · USD' : ''}</small><strong>{item.name}</strong>{item.currency === 'USD' && <em>Catálogo USD {Number(item.basePrice).toLocaleString('es-AR', { maximumFractionDigits: 2 })}</em>}</div>
                  {item.currency === 'USD' && <label className="internal-price"><span>Dólar venta</span><strong>{formatCurrency(item.fxSale)}</strong></label>}
                  {item.currency === 'USD' && <label className="internal-price"><span>IVA</span><strong>{item.vatRate}%</strong></label>}
                  {item.currency === 'USD' && <label className="internal-price"><span>Ganancia</span><input type="number" min="0" step="0.1" value={item.profitRate} onChange={(event) => updateItem(item.rowId, 'profitRate', event.target.value)} /></label>}
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
            <div className="budget-column-heading budget-preview-heading"><div><span>Documento</span><strong>Vista previa</strong></div><div className="budget-preview-actions"><button className="ghost-button" type="button" onClick={printDraft}>Guardar borrador</button><button className="ghost-button budget-confirm-button" type="button" disabled={invoiceEmitting} onClick={documentType === 'budget' ? confirmBudget : emitCommercialInvoice}>{documentType === 'budget' ? 'Confirmar' : invoiceEmitting ? 'Emitiendo…' : 'Emitir en ARCA'}</button><button className="ghost-button" type="button" disabled={documentType !== 'budget' || !confirmedBudget} onClick={() => printTransport(confirmedBudget)}>Transporte</button><button className="primary-button" type="button" disabled={documentType === 'budget' ? !confirmedBudget : !commercialInvoice} onClick={documentType === 'budget' ? () => printConfirmedBudget(confirmedBudget) : openCommercialInvoicePdf}>PDF / Descargar</button></div></div>
            <div className="budget-brand-tabs" aria-label="Marcas de presupuesto">
              {brands.map((item) => <button key={item.id} type="button" className={item.id === brand.id ? 'active' : ''} onClick={() => selectBrand(item.id)}><span>{item.name || 'Sin nombre'}</span><small>N.º {String(item.id === brand.id ? nextNumber : item.nextNumber || 1).padStart(6, '0')}</small></button>)}
              <button type="button" className="brand-tab-edit" onClick={editActiveBrand}>Editar</button>
              <button type="button" className="brand-tab-add" onClick={openNewBrand}>＋</button>
            </div>
            {documentType === 'budget' ? (
              <div className={`budget-number-panel ${confirmedBudget?.debitNote ? 'has-debit-note' : ''}`}>
                <div>
                  <span>N.º presupuesto</span>
                  <small>{confirmedBudget?.debitNote ? 'Presupuesto con nota de débito' : confirmedBudget ? 'Presupuesto confirmado' : 'Podés editarlo antes de confirmar'}</small>
                </div>
                <div className="budget-number-actions">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={String(confirmedBudget?.number || nextNumber).padStart(6, '0')}
                    disabled={Boolean(confirmedBudget)}
                    onChange={(event) => {
                      const digits = event.target.value.replace(/\D/g, '')
                      const value = Number(digits)
                      if (Number.isInteger(value) && value > 0) setNextNumber(value)
                    }}
                    aria-label="Número de presupuesto"
                  />
                  <button
                    type="button"
                    className="ghost-button budget-debit-note-button"
                    disabled={!confirmedBudget || Boolean(confirmedBudget?.debitNote)}
                    onClick={() => createDebitNote(confirmedBudget)}
                  >
                    {confirmedBudget?.debitNote ? 'Nota de débito emitida' : 'Nota de débito'}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`budget-number-panel fiscal-number-panel ${commercialInvoice ? 'authorized' : ''}`}>
                <div>
                  <span>{documentType === 'invoice-a' ? 'Factura A' : 'Factura B'} · ARCA</span>
                  <small>{commercialInvoice ? `CAE ${commercialInvoice.cae}` : 'Punto de venta 0003 · numeración fiscal automática'}</small>
                </div>
                <div className="budget-number-actions">
                  <strong className="fiscal-sequence-number">
                    {commercialInvoice?.voucher?.formattedNumber || (invoiceSequenceLoading ? 'Consultando…' : invoiceSequence?.formattedNextNumber || '—')}
                  </strong>
                </div>
              </div>
            )}
            <div className="budget-preview-scroll"><Preview brand={brand} client={clientDraft || selectedClient} items={items} number={documentType === 'budget' ? (confirmedBudget?.number || nextNumber) : (commercialInvoice?.voucher?.formattedNumber || invoiceSequence?.formattedNextNumber || '—')} documentType={documentType} authorized={Boolean(commercialInvoice)} /></div>
          </section>
        </div>
      ) : (
        <div className="generated-budget-layout">
          <aside className="generated-budget-list-column">
            <div className="budget-column-heading"><div><span>Historial</span><strong>Presupuestos generados</strong></div><small>{generatedBudgets.length}</small></div>
            <div className="generated-budget-list">
              {generatedBudgets.length ? generatedBudgets.map((budget) => (
                <button type="button" key={budget.id} className={`generated-budget-card ${selectedGenerated?.id === budget.id ? 'active' : ''} ${budget.debitNote ? 'has-debit-note' : ''} ${budget.cancelledAt ? 'cancelled' : ''}`} onClick={() => openGeneratedBudget(budget)}>
                  <span>N.º {String(budget.number).padStart(6, '0')} {budget.cancelledAt ? `· CANCELADO · ${budget.cancellation?.noteType === 'debit' ? 'NOTA DE DÉBITO' : 'NOTA DE CRÉDITO'}` : budget.debitNote ? '· NOTA DE DÉBITO' : ''}</span>
                  <strong>{budget.client?.legalName || budget.client?.name || 'Cliente'}</strong>
                  <small>{new Date(budget.createdAt).toLocaleDateString('es-AR')} · {formatCurrency(budget.total)}</small>
                </button>
              )) : <div className="budget-empty-list">Todavía no hay presupuestos confirmados.</div>}
            </div>
          </aside>
          <section className="generated-budget-detail-column">
            <div className="budget-column-heading"><div><span>Documento guardado</span><strong>{selectedGenerated ? `Presupuesto N.º ${String(selectedGenerated.number).padStart(6, '0')}` : 'Sin selección'}</strong>{selectedGenerated?.debitNote && <small className="budget-debit-note-summary">Nota de débito · {formatCurrency(selectedGenerated.debitNote.amount)} · {selectedGenerated.debitNote.reason}</small>}</div>{selectedGenerated && <div className="budget-preview-actions"><button className="ghost-button" type="button" onClick={() => duplicateGeneratedBudget(selectedGenerated)}>Duplicar</button><button className="ghost-button budget-cancel-button" type="button" disabled={Boolean(selectedGenerated.cancelledAt)} onClick={() => cancelGeneratedBudget(selectedGenerated)}>{selectedGenerated.cancelledAt ? 'Cancelado' : 'Cancelar'}</button><button className="ghost-button" type="button" onClick={() => printTransport(selectedGenerated)}>Transporte</button><button className="primary-button" type="button" onClick={() => printConfirmedBudget(selectedGenerated)}>PDF / Descargar</button></div>}</div>
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

      {manualProductOpen && (
        <div className="budget-modal-backdrop" role="presentation" onMouseDown={() => setManualProductOpen(false)}>
          <section className="budget-manual-product-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>Catálogo propio</span><h2>Agregar producto</h2><small>Quedará separado de la lista importada.</small></div><button type="button" onClick={() => setManualProductOpen(false)}>×</button></header>
            <div className="budget-manual-form">
              <label><span>Código</span><input value={manualProductDraft.code} onChange={(event) => setManualProductDraft((current) => ({ ...current, code: event.target.value }))} /></label>
              <label className="wide"><span>Producto / título</span><input value={manualProductDraft.name} onChange={(event) => setManualProductDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label><span>Categoría</span><input value={manualProductDraft.category} onChange={(event) => setManualProductDraft((current) => ({ ...current, category: event.target.value }))} /></label>
              <label><span>Moneda</span><select value={manualProductDraft.currency} onChange={(event) => setManualProductDraft((current) => ({ ...current, currency: event.target.value, vatRate: event.target.value === 'USD' ? 21 : current.vatRate }))}><option value="ARS">Pesos ARS</option><option value="USD">Dólares USD</option></select></label>
              <label><span>Precio catálogo</span><input type="number" min="0" step="0.01" value={manualProductDraft.basePrice} onChange={(event) => setManualProductDraft((current) => ({ ...current, basePrice: event.target.value }))} /></label>
              <label><span>IVA</span><div className="suffix-input"><input type="number" min="0" step="0.1" value={manualProductDraft.vatRate} onChange={(event) => setManualProductDraft((current) => ({ ...current, vatRate: event.target.value }))} /><b>%</b></div></label>
              <label><span>Ganancia predeterminada</span><div className="suffix-input"><input type="number" min="0" step="0.1" value={manualProductDraft.profitRate} onChange={(event) => setManualProductDraft((current) => ({ ...current, profitRate: event.target.value }))} /><b>%</b></div></label>
            </div>
            <footer><button className="ghost-button" type="button" onClick={() => setManualProductOpen(false)}>Cancelar</button><button className="primary-button" type="button" onClick={saveManualProduct}>Guardar producto</button></footer>
          </section>
        </div>
      )}

      {priceListOpen && (
        <div className="budget-modal-backdrop" role="presentation" onMouseDown={() => setPriceListOpen(false)}>
          <section className="budget-price-panel" role="dialog" aria-modal="true" aria-label="Lista de precios" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>Catálogo comercial</span><h2>Lista de precios</h2><small>{visiblePrices.length} de {allProducts.length} productos · {manualProducts.length} agregados manualmente</small></div>
              <button type="button" onClick={() => setPriceListOpen(false)} aria-label="Cerrar">×</button>
            </header>
            <label className="budget-search budget-price-search"><span>⌕</span><input autoFocus value={priceQuery} onChange={(event) => setPriceQuery(event.target.value)} placeholder="Buscar por código, producto o categoría…" /></label>
            <div className="budget-price-table excel-mode">
              <div className="budget-price-row heading"><span>Código</span><span>Producto</span><span>Categoría</span><span>Moneda</span><span>Precio base</span><span>IVA</span><span>Ganancia</span><span></span></div>
              {visiblePrices.map((product) => (
                <div className={`budget-price-row editable-row ${product.manual ? 'manual' : ''}`} key={product.id || product.code}>
                  <input value={product.code || ''} onChange={(event) => updateCatalogProduct(product, 'code', event.target.value)} />
                  <div className="product-name-cell"><input value={product.name || ''} onChange={(event) => updateCatalogProduct(product, 'name', event.target.value)} />{product.manual && <small className="manual-tag">Agregado</small>}</div>
                  <input value={product.category || ''} onChange={(event) => updateCatalogProduct(product, 'category', event.target.value)} />
                  <select value={product.currency === 'USD' ? 'USD' : 'ARS'} onChange={(event) => updateCatalogProduct(product, 'currency', event.target.value)}><option value="ARS">ARS</option><option value="USD">USD</option></select>
                  <input type="number" min="0" step="0.01" value={product.basePrice ?? product.price ?? 0} onChange={(event) => updateCatalogProduct(product, 'basePrice', event.target.value)} />
                  <div className="suffix-input compact"><input type="number" min="0" step="0.1" value={product.vatRate ?? (product.currency === 'USD' ? 21 : 0)} onChange={(event) => updateCatalogProduct(product, 'vatRate', event.target.value)} /><b>%</b></div>
                  <div className="suffix-input compact"><input type="number" min="0" step="0.1" value={product.profitRate ?? (product.currency === 'USD' ? defaultProfit : 0)} onChange={(event) => updateCatalogProduct(product, 'profitRate', event.target.value)} /><b>%</b></div>
                  <button type="button" className="budget-delete-product" onClick={() => deleteCatalogProduct(product)} aria-label={`Eliminar ${product.name || product.code}`}>×</button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default Budgets
