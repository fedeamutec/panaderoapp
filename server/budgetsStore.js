import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const dataDir = path.join(process.cwd(), 'server', 'data')
const legacyStorePath = path.join(dataDir, 'budgets.json')
const usersDir = path.join(dataDir, 'budget-users')
const migrationPath = path.join(dataDir, 'budgets-migration.json')

const blankBrand = {
  id: '',
  name: '',
  subtitle: '',
  validity: '10 días',
  conditions: '',
  logo: '',
  nextNumber: 1,
}

const emptyStore = {
  brands: [],
  activeBrandId: '',
  generatedBudgets: [],
  clients: [],
  products: [],
  manualProducts: [],
  defaultProfit: 30,
  catalogInitialized: false,
}

function normalizeIdentity(identity) {
  const email = String(identity || '').trim().toLowerCase()
  if (!email) throw new Error('No se pudo identificar la cuenta de Panadero.')
  return email
}

function identityKey(identity) {
  return crypto.createHash('sha256').update(normalizeIdentity(identity)).digest('hex').slice(0, 24)
}

function accountStorePath(identity) {
  return path.join(usersDir, `${identityKey(identity)}.json`)
}

function normalizeBrand(brand = {}, fallbackId = '') {
  const id = String(brand.id || fallbackId || `brand-${Date.now()}`)
  const nextNumber = Number(brand.nextNumber || 1)
  return {
    ...blankBrand,
    ...brand,
    id,
    nextNumber: Number.isInteger(nextNumber) && nextNumber > 0 ? nextNumber : 1,
  }
}

function normalizeGeneratedBudget(item = {}) {
  const legacyNote = Array.isArray(item.debitNotes) && item.debitNotes.length
    ? item.debitNotes[item.debitNotes.length - 1]
    : null
  const debitNote = item.debitNote || legacyNote || null
  return {
    ...item,
    debitNote,
    hasDebitNote: Boolean(debitNote || item.hasDebitNote),
  }
}

function migrateStore(parsed = {}) {
  const generatedBudgets = Array.isArray(parsed.generatedBudgets)
    ? parsed.generatedBudgets.map(normalizeGeneratedBudget)
    : []

  let brands = Array.isArray(parsed.brands)
    ? parsed.brands.map((brand, index) => normalizeBrand(brand, `brand-${index + 1}`))
    : []

  // Compatibilidad con la versión anterior de una sola marca.
  if (!brands.length && parsed.brand) {
    brands = [normalizeBrand({ ...parsed.brand, nextNumber: parsed.nextNumber || 1 }, 'brand-1')]
  }

  if (!brands.length) {
    brands = [normalizeBrand({ name: '', subtitle: '', validity: '10 días', conditions: '', nextNumber: 1 }, 'brand-1')]
  }

  // Cada marca conserva su correlativo y nunca retrocede respecto del historial.
  brands = brands.map((brand) => {
    const highest = generatedBudgets.reduce((max, item) => {
      const itemBrandId = item?.brand?.id || item?.brandId || brands[0]?.id
      if (itemBrandId !== brand.id) return max
      return Math.max(max, Number(item?.number || 0))
    }, 0)
    return { ...brand, nextNumber: Math.max(Number(brand.nextNumber || 1), highest + 1) }
  })

  const requestedActive = String(parsed.activeBrandId || '')
  const activeBrandId = brands.some((brand) => brand.id === requestedActive)
    ? requestedActive
    : brands[0].id

  const clients = Array.isArray(parsed.clients) ? parsed.clients : []
  const products = Array.isArray(parsed.products) ? parsed.products : []
  const manualProducts = Array.isArray(parsed.manualProducts) ? parsed.manualProducts : []

  return {
    ...emptyStore,
    ...parsed,
    brands,
    activeBrandId,
    generatedBudgets,
    clients,
    products,
    manualProducts,
    defaultProfit: Number.isFinite(Number(parsed.defaultProfit)) ? Math.max(0, Number(parsed.defaultProfit)) : 30,
    catalogInitialized: parsed.catalogInitialized === true
      || clients.length > 0
      || products.length > 0
      || manualProducts.length > 0,
  }
}

async function ensureDirectories() {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.mkdir(usersDir, { recursive: true })
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(temporaryPath, filePath)
}

async function ensureAccountStore(identity) {
  await ensureDirectories()
  const targetPath = accountStorePath(identity)

  try {
    await fs.access(targetPath)
    return targetPath
  } catch {
    // Primera apertura de esta cuenta: continuar con migración segura.
  }

  const key = identityKey(identity)
  let migration = await readJson(migrationPath, null)

  // El histórico budgets.json se asigna UNA SOLA VEZ a la cuenta que ya estaba
  // usando Panadero. El archivo original queda intacto como respaldo.
  if (!migration?.legacyOwnerKey) {
    migration = {
      legacyOwnerKey: key,
      claimedAt: new Date().toISOString(),
      legacyFilePreserved: true,
    }
    await writeJsonAtomic(migrationPath, migration)
  }

  let initial = emptyStore
  if (migration.legacyOwnerKey === key) {
    const legacy = await readJson(legacyStorePath, null)
    if (legacy) initial = legacy
  }

  await writeJsonAtomic(targetPath, migrateStore(initial))
  return targetPath
}

export async function readBudgetsStore(identity) {
  const targetPath = await ensureAccountStore(identity)
  try {
    return migrateStore(await readJson(targetPath, emptyStore))
  } catch {
    // Nunca toca budgets.json, Mercado Libre, facturas ni certificados ARCA.
    const fallback = migrateStore(emptyStore)
    await writeJsonAtomic(targetPath, fallback)
    return fallback
  }
}

export async function writeBudgetsStore(identity, nextStore) {
  const targetPath = await ensureAccountStore(identity)
  const normalized = migrateStore(nextStore)
  await writeJsonAtomic(targetPath, normalized)
  return normalized
}

export async function updateBudgetsStore(identity, updater) {
  const current = await readBudgetsStore(identity)
  const next = await updater(current)
  return writeBudgetsStore(identity, next)
}
