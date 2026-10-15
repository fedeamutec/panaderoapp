const DB_NAME = 'panadero-local-backups'
const DB_VERSION = 2
const STORE_NAME = 'snapshots'
const DATA_STORE_NAME = 'offline-data'
const RESTORE_PENDING_KEY = 'panadero-backup-restore-pending'
let persistenceRequested = false

const INDEXED_DATA_KEYS = new Set([
  'panadero-generated-budgets',
  'panadero-pending-budgets',
])

export const PANADERO_DATA_KEYS = [
  'panadero-budget-clients',
  'panadero-budget-products',
  'panadero-budget-brand',
  'panadero-budget-brands',
  'panadero-budget-active-brand',
  'panadero-generated-budgets',
  'panadero-pending-budgets',
  'panadero-budget-manual-products',
  'panadero-budget-bna-fx',
  'panadero-budget-default-profit',
  'panadero-budget-catalog-owner',
]

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Este navegador no ofrece almacenamiento local avanzado.'))
      return
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(DATA_STORE_NAME)) {
        database.createObjectStore(DATA_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el respaldo local.'))
  })
}

async function requestPersistentStorage() {
  if (persistenceRequested) return
  persistenceRequested = true
  try {
    await globalThis.navigator?.storage?.persist?.()
  } catch {
    // IndexedDB sigue disponible aunque el navegador no conceda persistencia especial.
  }
}

async function readIndexedValue(key) {
  const database = await openDatabase()
  const record = await new Promise((resolve, reject) => {
    const request = database.transaction(DATA_STORE_NAME, 'readonly').objectStore(DATA_STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('No se pudo leer el almacenamiento offline.'))
  })
  database.close()
  return record?.value ?? null
}

async function writeIndexedValue(key, value) {
  const database = await openDatabase()
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DATA_STORE_NAME, 'readwrite')
    transaction.objectStore(DATA_STORE_NAME).put({ key, value })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el almacenamiento offline.'))
  })
  database.close()
}

async function removeIndexedValue(key) {
  const database = await openDatabase()
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DATA_STORE_NAME, 'readwrite')
    transaction.objectStore(DATA_STORE_NAME).delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo limpiar el almacenamiento offline.'))
  })
  database.close()
}

export async function readLocalDataValue(key) {
  if (!INDEXED_DATA_KEYS.has(key)) return localStorage.getItem(key)

  const indexedValue = await readIndexedValue(key)
  if (indexedValue !== null) return indexedValue

  const legacyValue = localStorage.getItem(key)
  if (legacyValue !== null) {
    await writeIndexedValue(key, legacyValue)
    localStorage.removeItem(key)
  }
  return legacyValue
}

export async function writeLocalDataValue(key, value) {
  const serialized = String(value)
  if (!INDEXED_DATA_KEYS.has(key)) {
    localStorage.setItem(key, serialized)
    return
  }

  await writeIndexedValue(key, serialized)
  localStorage.removeItem(key)
}

async function removeLocalDataValue(key) {
  localStorage.removeItem(key)
  if (INDEXED_DATA_KEYS.has(key)) await removeIndexedValue(key)
}

export async function readLocalJson(key, fallback) {
  try {
    const stored = await readLocalDataValue(key)
    if (stored === null) return fallback
    const parsed = JSON.parse(stored)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export async function writeLocalJson(key, value) {
  await writeLocalDataValue(key, JSON.stringify(value))
}

async function readCurrentData() {
  const entries = await Promise.all(PANADERO_DATA_KEYS.map(async (key) => [key, await readLocalDataValue(key)]))
  return entries.reduce((data, [key, value]) => {
    if (value !== null) data[key] = value
    return data
  }, {})
}

async function backupPayload(reason = 'manual') {
  return {
    app: 'panadero',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    reason,
    data: await readCurrentData(),
  }
}

function validatePayload(payload) {
  if (!payload || payload.app !== 'panadero' || Number(payload.formatVersion) !== 1 || !payload.data || typeof payload.data !== 'object') {
    throw new Error('El archivo no es un respaldo válido de Panadero.')
  }

  for (const [key, value] of Object.entries(payload.data)) {
    if (!PANADERO_DATA_KEYS.includes(key) || typeof value !== 'string') {
      throw new Error('El respaldo contiene datos no reconocidos.')
    }
  }
  return payload
}

async function writeData(payload) {
  const valid = validatePayload(payload)
  await Promise.all(PANADERO_DATA_KEYS.map((key) => removeLocalDataValue(key)))
  await Promise.all(Object.entries(valid.data).map(([key, value]) => writeLocalDataValue(key, value)))
  localStorage.setItem(RESTORE_PENDING_KEY, new Date().toISOString())
  window.dispatchEvent(new CustomEvent('panadero:data-restored'))
}

export function hasPendingRestore() {
  return Boolean(localStorage.getItem(RESTORE_PENDING_KEY))
}

export function clearPendingRestore() {
  localStorage.removeItem(RESTORE_PENDING_KEY)
}

export async function createLocalSnapshot(reason = 'automatic') {
  await requestPersistentStorage()
  const payload = await backupPayload(reason)
  const database = await openDatabase()
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ id: 'latest', ...payload })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar el respaldo local.'))
  })
  database.close()
  return payload
}

export async function getLatestLocalSnapshot() {
  const database = await openDatabase()
  const snapshot = await new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('latest')
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('No se pudo leer el respaldo local.'))
  })
  database.close()
  return snapshot
}

export async function restoreLatestLocalSnapshot() {
  const snapshot = await getLatestLocalSnapshot()
  if (!snapshot) throw new Error('Todavía no hay un respaldo automático en esta computadora.')
  await writeData(snapshot)
  return snapshot
}

export async function downloadLocalBackup() {
  let payload
  try {
    payload = await createLocalSnapshot('manual-export')
  } catch {
    payload = await backupPayload('manual-export')
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const stamp = payload.createdAt.replace(/[:.]/g, '-').slice(0, 19)
  anchor.href = url
  anchor.download = `panadero-backup-${stamp}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return payload
}

export async function restoreLocalBackupFile(file) {
  if (!file) throw new Error('Seleccioná un archivo de respaldo.')
  let payload
  try {
    payload = JSON.parse(await file.text())
  } catch {
    throw new Error('No se pudo leer el archivo de respaldo.')
  }
  await writeData(payload)
  try {
    await createLocalSnapshot('file-restore')
  } catch {
    // El archivo ya fue restaurado; IndexedDB es una protección adicional.
  }
  return payload
}
