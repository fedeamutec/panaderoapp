import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export const ARCA_CUIT = String(process.env.ARCA_CUIT || '20366076957').replace(/\D/g, '')
export const ARCA_ENV = String(process.env.ARCA_ENV || 'testing').toLowerCase()
export const ARCA_ALIAS = process.env.ARCA_ALIAS || 'panadero-test'
export const ARCA_POINT_OF_SALE = Number(process.env.ARCA_POINT_OF_SALE || 3)
export const ARCA_SERVICE = process.env.ARCA_SERVICE || 'wsfe'
export const ARCA_DATA_DIR = process.env.ARCA_DATA_DIR
  ? path.resolve(process.env.ARCA_DATA_DIR)
  : path.join(currentDir, 'data')

export const WSAA_URL = ARCA_ENV === 'production'
  ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
  : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms'

export const WSAA_TOKEN_SAFETY_SECONDS = Number(process.env.WSAA_TOKEN_SAFETY_SECONDS || 300)
export const WSAA_REQUEST_TIMEOUT_MS = Number(process.env.WSAA_REQUEST_TIMEOUT_MS || 30000)
