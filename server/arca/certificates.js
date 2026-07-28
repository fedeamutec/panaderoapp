import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ARCA_ALIAS, ARCA_CUIT, ARCA_DATA_DIR, ARCA_ENV, ARCA_POINT_OF_SALE } from './config.js'

const execFileAsync = promisify(execFile)
const keyPath = path.join(ARCA_DATA_DIR, `${ARCA_ALIAS}.key.pem`)
const csrPath = path.join(ARCA_DATA_DIR, `${ARCA_ALIAS}.csr.pem`)
const certPath = path.join(ARCA_DATA_DIR, `${ARCA_ALIAS}.crt.pem`)

async function ensureDataDir() {
  await fs.mkdir(ARCA_DATA_DIR, { recursive: true })
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function getArcaStatus() {
  const [hasKey, hasCsr, hasCertificate] = await Promise.all([
    exists(keyPath),
    exists(csrPath),
    exists(certPath),
  ])

  return {
    environment: ARCA_ENV,
    alias: ARCA_ALIAS,
    cuit: ARCA_CUIT,
    pointOfSale: ARCA_POINT_OF_SALE,
    hasKey,
    hasCsr,
    hasCertificate,
    readyForAuthorization: hasKey && hasCsr && hasCertificate,
  }
}

export async function generateCsr() {
  await ensureDataDir()

  if (await exists(keyPath)) {
    throw new Error('Ya existe una clave privada para este alias. Por seguridad no se reemplazó.')
  }

  const subject = `/C=AR/CN=${ARCA_ALIAS}/serialNumber=CUIT ${ARCA_CUIT}`
  try {
    await execFileAsync('openssl', [
      'req', '-new', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath,
      '-out', csrPath,
      '-sha256',
      '-subj', subject,
    ])
    await fs.chmod(keyPath, 0o600)
  } catch (error) {
    throw new Error(`No se pudo generar el CSR: ${error.stderr || error.message}`)
  }

  return { csr: await fs.readFile(csrPath, 'utf8'), ...(await getArcaStatus()) }
}

export async function readCsr() {
  if (!(await exists(csrPath))) throw new Error('Todavía no se generó el CSR.')
  return fs.readFile(csrPath, 'utf8')
}

export async function saveCertificate(certificatePem) {
  const normalized = String(certificatePem || '').trim()
  if (!normalized.includes('BEGIN CERTIFICATE') || !normalized.includes('END CERTIFICATE')) {
    throw new Error('El certificado no tiene formato PEM válido.')
  }

  await ensureDataDir()
  const temporaryPath = `${certPath}.tmp`
  await fs.writeFile(temporaryPath, `${normalized}\n`, { mode: 0o600 })

  try {
    await execFileAsync('openssl', ['x509', '-in', temporaryPath, '-noout', '-subject', '-dates'])
    await fs.rename(temporaryPath, certPath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw new Error('El certificado no pudo validarse con OpenSSL.')
  }

  return getArcaStatus()
}
