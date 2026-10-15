const DB_NAME = 'panadero-local-backups'
const DB_VERSION = 1
const STORE_NAME = 'snapshots'
const RESTORE_PENDING_KEY = 'panadero-backup-restore-pending'

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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('No se pudo abrir el respaldo local.'))
  })
}

function readCurrentData() {
  return PANADERO_DATA_KEYS.reduce((data, key) => {
    const value = localStorage.getItem(key)
    if (value !== null) data[key] = value
    return data
  }, {})
}

function backupPayload(reason = 'manual') {
  return {
    app: 'panadero',
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    reason,
    data: readCurrentData(),
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

function writeData(payload) {
  const valid = validatePayload(payload)
  PANADERO_DATA_KEYS.forEach((key) => localStorage.removeItem(key))
  Object.entries(valid.data).forEach(([key, value]) => localStorage.setItem(key, value))
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
  const payload = backupPayload(reason)
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
  writeData(snapshot)
  return snapshot
}

export async function downloadLocalBackup() {
  let payload
  try {
    payload = await createLocalSnapshot('manual-export')
  } catch {
    payload = backupPayload('manual-export')
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
  writeData(payload)
  try {
    await createLocalSnapshot('file-restore')
  } catch {
    // El archivo ya fue restaurado; IndexedDB es una protección adicional.
  }
  return payload
}
