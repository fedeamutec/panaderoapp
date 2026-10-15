import assert from 'node:assert/strict'

class FakeLocalStorage {
  constructor(limitBytes) {
    this.limitBytes = limitBytes
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null
  }

  setItem(key, value) {
    const normalizedKey = String(key)
    const normalizedValue = String(value)
    const next = new Map(this.values)
    next.set(normalizedKey, normalizedValue)
    const bytes = [...next.entries()].reduce((total, [entryKey, entryValue]) => total + Buffer.byteLength(entryKey + entryValue), 0)
    if (bytes > this.limitBytes) throw new Error('QuotaExceededError')
    this.values = next
  }

  removeItem(key) {
    this.values.delete(String(key))
  }
}

class FakeIndexedDb {
  constructor() {
    this.version = 0
    this.stores = new Map()
  }

  open(_name, version) {
    const request = {}
    queueMicrotask(() => {
      const database = this.database()
      request.result = database
      if (version > this.version) {
        this.version = version
        request.onupgradeneeded?.()
      }
      request.onsuccess?.()
    })
    return request
  }

  database() {
    return {
      objectStoreNames: {
        contains: (name) => this.stores.has(name),
      },
      createObjectStore: (name, { keyPath }) => {
        this.stores.set(name, { keyPath, records: new Map() })
      },
      transaction: (name) => {
        const transaction = {}
        const store = this.stores.get(name)
        if (!store) throw new Error(`Missing object store: ${name}`)
        transaction.objectStore = () => ({
          get: (key) => {
            const result = {}
            queueMicrotask(() => {
              result.result = store.records.get(key)
              result.onsuccess?.()
            })
            return result
          },
          put: (record) => {
            store.records.set(record[store.keyPath], structuredClone(record))
            queueMicrotask(() => transaction.oncomplete?.())
          },
          delete: (key) => {
            store.records.delete(key)
            queueMicrotask(() => transaction.oncomplete?.())
          },
        })
        return transaction
      },
      close: () => {},
    }
  }
}

const localStorage = new FakeLocalStorage(5 * 1024 * 1024)
const indexedDB = new FakeIndexedDb()
globalThis.localStorage = localStorage
globalThis.window = { indexedDB, dispatchEvent: () => true }
globalThis.CustomEvent = class CustomEvent {
  constructor(type) {
    this.type = type
  }
}

const {
  createLocalSnapshot,
  readLocalJson,
  restoreLatestLocalSnapshot,
  writeLocalJson,
} = await import('./localBackup.js')

const historyKey = 'panadero-generated-budgets'
const legacyHistory = [{ id: 'legacy', payload: 'a'.repeat(4 * 1024 * 1024) }]
localStorage.setItem(historyKey, JSON.stringify(legacyHistory))

const migratedHistory = await readLocalJson(historyKey, [])
assert.equal(migratedHistory[0].id, 'legacy')
assert.equal(localStorage.getItem(historyKey), null, 'La migración debe liberar localStorage solo después de guardar en IndexedDB.')

const largerHistory = [{ id: 'indexed', payload: 'b'.repeat(7 * 1024 * 1024) }]
await writeLocalJson(historyKey, largerHistory)
assert.equal((await readLocalJson(historyKey, []))[0].id, 'indexed')
assert.equal(localStorage.getItem(historyKey), null, 'El historial grande no debe volver a localStorage.')

await createLocalSnapshot('test')
await writeLocalJson(historyKey, [])
await restoreLatestLocalSnapshot()
assert.equal((await readLocalJson(historyKey, []))[0].id, 'indexed', 'El respaldo automático debe restaurar datos almacenados en IndexedDB.')

console.log('Offline storage migration tests passed.')
