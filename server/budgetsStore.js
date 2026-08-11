import fs from 'node:fs/promises'
import path from 'node:path'

const dataDir = path.join(process.cwd(), 'server', 'data')
const storePath = path.join(dataDir, 'budgets.json')

const emptyStore = {
  brand: { name: '', subtitle: '', validity: '10 días', conditions: '', logo: '' },
  nextNumber: 1,
  generatedBudgets: [],
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
    const generatedBudgets = Array.isArray(parsed.generatedBudgets) ? parsed.generatedBudgets : []
    const highest = generatedBudgets.reduce((max, item) => Math.max(max, Number(item?.number || 0)), 0)
    const requestedNext = Number(parsed.nextNumber || 1)
    return {
      ...emptyStore,
      ...parsed,
      brand: { ...emptyStore.brand, ...(parsed.brand || {}) },
      generatedBudgets,
      nextNumber: Math.max(1, highest + 1, Number.isFinite(requestedNext) ? requestedNext : 1),
    }
  } catch {
    await fs.writeFile(storePath, JSON.stringify(emptyStore, null, 2), 'utf8')
    return structuredClone(emptyStore)
  }
}

export async function writeBudgetsStore(nextStore) {
  await ensureStore()
  const temporaryPath = `${storePath}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(nextStore, null, 2), 'utf8')
  await fs.rename(temporaryPath, storePath)
  return nextStore
}

export async function updateBudgetsStore(updater) {
  const current = await readBudgetsStore()
  const next = await updater(current)
  return writeBudgetsStore(next)
}
