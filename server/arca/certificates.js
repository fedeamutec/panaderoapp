import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ARCA_ALIAS, ARCA_CUIT, ARCA_DATA_DIR, ARCA_ENV, ARCA_POINT_OF_SALE } from './config.js'

const execFileAsync = promisify(execFile)

export const keyPath = path.join(ARCA_DATA_DIR, `${ARCA_ALIAS}.key.pem`)
export const csrPath = path.join(ARCA_DATA_DIR, `${ARCA_ALIAS}.csr.pem`)
export const certPath = path.join(ARCA_DATA_DIR, `${ARCA_ALIAS}.crt.pem`)

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

async function readCertificateMetadata() {
  if (!(await exists(certPath))) return null
  try {
    const { stdout } = await execFileAsync('openssl', [
      'x509', '-in', certPath, '-noout', '-subject', '-issuer', '-serial', '-dates', '-fingerprint', '-sha256',
    ])
    const values = Object.fromEntries(
      stdout.trim().split(/\r?\n/).map((line) => {
        const separator = line.indexOf('=')
        return separator === -1 ? [line, ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
      })
    )
    return {
      subject: values.subject || null,
      issuer: values.issuer || null,
      serial: values.serial || null,
      validFrom: values.notBefore ? new Date(values.notBefore).toISOString() : null,
      validTo: values.notAfter ? new Date(values.notAfter).toISOString() : null,
      fingerprint: values['sha256 Fingerprint'] || null,
    }
  } catch {
    return null
  }
}

export async function getArcaStatus() {
  const [hasKey, hasCsr, hasCertificate, certificate] = await Promise.all([
    exists(keyPath),
    exists(csrPath),
    exists(certPath),
    readCertificateMetadata(),
  ])

  return {
    environment: ARCA_ENV,
    alias: ARCA_ALIAS,
    cuit: ARCA_CUIT,
    pointOfSale: ARCA_POINT_OF_SALE,
    dataDirectory: ARCA_DATA_DIR,
    hasKey,
    hasCsr,
    hasCertificate,
    readyForAuthorization: hasKey && hasCertificate,
    certificate,
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
      '-keyout', keyPath, '-out', csrPath, '-sha256', '-subj', subject,
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
    await fs.chmod(certPath, 0o600)
  } catch {
    await fs.rm(temporaryPath, { force: true })
    throw new Error('El certificado no pudo validarse con OpenSSL.')
  }

  return getArcaStatus()
}
