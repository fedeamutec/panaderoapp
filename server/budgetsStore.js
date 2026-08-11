import fs from 'node:fs/promises'
import path from 'node:path'

const dataDir = path.join(process.cwd(), 'server', 'data')
const storePath = path.join(dataDir, 'budgets.json')

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

function migrateStore(parsed = {}) {
  const generatedBudgets = Array.isArray(parsed.generatedBudgets) ? parsed.generatedBudgets : []
  let brands = Array.isArray(parsed.brands) ? parsed.brands.map((brand, index) => normalizeBrand(brand, `brand-${index + 1}`)) : []

  // Compatibilidad con la versión anterior de una sola marca.
  if (!brands.length && parsed.brand) {
    brands = [normalizeBrand({ ...parsed.brand, nextNumber: parsed.nextNumber || 1 }, 'brand-1')]
  }

  if (!brands.length) {
    brands = [normalizeBrand({ name: '', subtitle: '', validity: '10 días', conditions: '', nextNumber: 1 }, 'brand-1')]
  }

  // El correlativo pertenece a cada marca. Se corrige usando presupuestos ya guardados de esa marca.
  brands = brands.map((brand) => {
    const highest = generatedBudgets.reduce((max, item) => {
      const itemBrandId = item?.brand?.id || item?.brandId || brands[0]?.id
      if (itemBrandId !== brand.id) return max
      return Math.max(max, Number(item?.number || 0))
    }, 0)
    return { ...brand, nextNumber: Math.max(brand.nextNumber, highest + 1) }
  })

  const requestedActive = String(parsed.activeBrandId || '')
  const activeBrandId = brands.some((brand) => brand.id === requestedActive) ? requestedActive : brands[0].id

  return { brands, activeBrandId, generatedBudgets }
}

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true })
  try {
    await fs.access(storePath)
  } catch {
    await fs.writeFile(storePath, JSON.stringify(emptyStore, null, 2), 'utf8')
  }
}

export async function readBudgetsStore() {
  await ensureStore()
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'))
    return migrateStore(parsed)
  } catch {
    await fs.writeFile(storePath, JSON.stringify(emptyStore, null, 2), 'utf8')
    return migrateStore(emptyStore)
  }
}

export async function writeBudgetsStore(nextStore) {
  await ensureStore()
  const normalized = migrateStore(nextStore)
  const temporaryPath = `${storePath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(normalized, null, 2), 'utf8')
  await fs.rename(temporaryPath, storePath)
  return normalized
}

export async function updateBudgetsStore(updater) {
  const current = await readBudgetsStore()
  const next = await updater(current)
  return writeBudgetsStore(next)
}
