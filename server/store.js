import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
const storePath = path.join(dataDir, 'mercadolibre.json')

const emptyStore = { account: null, tokens: null, orders: [], states: {} }

async function ensureStore() {
  await fs.mkdir(dataDir, { recursive: true })
  try {
    await fs.access(storePath)
  } catch {
    await fs.writeFile(storePath, JSON.stringify(emptyStore, null, 2))
  }
}

export async function readStore() {
  await ensureStore()
  try {
    return { ...emptyStore, ...JSON.parse(await fs.readFile(storePath, 'utf8')) }
  } catch {
    await fs.writeFile(storePath, JSON.stringify(emptyStore, null, 2))
    return structuredClone(emptyStore)
  }
}

export async function writeStore(nextStore) {
  await ensureStore()
  await fs.writeFile(storePath, JSON.stringify(nextStore, null, 2))
  return nextStore
}

export async function updateStore(updater) {
  const current = await readStore()
  const next = await updater(current)
  return writeStore(next)
}
