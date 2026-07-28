import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export const ARCA_CUIT = String(process.env.ARCA_CUIT || '20366076957').replace(/\D/g, '')
export const ARCA_ENV = process.env.ARCA_ENV || 'testing'
export const ARCA_ALIAS = process.env.ARCA_ALIAS || 'panadero-test'
export const ARCA_POINT_OF_SALE = Number(process.env.ARCA_POINT_OF_SALE || 3)
export const ARCA_DATA_DIR = process.env.ARCA_DATA_DIR
  ? path.resolve(process.env.ARCA_DATA_DIR)
  : path.join(currentDir, 'data')
