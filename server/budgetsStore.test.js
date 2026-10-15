import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const projectRoot = process.cwd()
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'panadero-budget-concurrency-'))

try {
  process.chdir(temporaryRoot)
  const moduleUrl = pathToFileURL(path.join(projectRoot, 'server', 'budgetsStore.js'))
  moduleUrl.searchParams.set('test', String(Date.now()))
  const { readBudgetsStore, updateBudgetsStore } = await import(moduleUrl.href)

  const account = 'concurrencia@panadero.test'
  await updateBudgetsStore(account, (current) => current)

  const confirmBudget = (id, waitBeforeSave = 0) => updateBudgetsStore(account, async (current) => {
    const activeBrand = current.brands[0]
    const number = 1
    const duplicate = current.generatedBudgets.find((item) => (
      (item?.brand?.id || item?.brandId) === activeBrand.id
      && Number(item?.number) === number
    ))

    if (duplicate) {
      const error = new Error('El número de presupuesto ya existe.')
      error.code = 'DUPLICATE_BUDGET_NUMBER'
      throw error
    }

    if (waitBeforeSave > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitBeforeSave))
    }

    const budget = {
      id,
      number,
      brandId: activeBrand.id,
      brand: activeBrand,
      status: 'confirmed',
    }

    return {
      ...current,
      brands: current.brands.map((brand) => brand.id === activeBrand.id
        ? { ...brand, nextNumber: 2 }
        : brand),
      generatedBudgets: [budget, ...current.generatedBudgets],
    }
  })

  const results = await Promise.allSettled([
    confirmBudget('equipo-windows', 40),
    confirmBudget('equipo-mac'),
  ])

  const saved = results.filter((result) => result.status === 'fulfilled')
  const rejected = results.filter((result) => result.status === 'rejected')

  assert.equal(saved.length, 1, 'Solo una computadora debe poder guardar el correlativo.')
  assert.equal(rejected.length, 1, 'La segunda computadora debe recibir un conflicto.')
  assert.equal(rejected[0].reason?.code, 'DUPLICATE_BUDGET_NUMBER')

  const finalState = await readBudgetsStore(account)
  assert.equal(finalState.generatedBudgets.length, 1, 'No debe perderse ni sobrescribirse el presupuesto guardado.')
  assert.equal(finalState.generatedBudgets[0].id, 'equipo-windows')
  assert.equal(finalState.generatedBudgets[0].number, 1)
  assert.equal(finalState.brands[0].nextNumber, 2)

  console.log('Budget concurrency tests passed.')
} finally {
  process.chdir(projectRoot)
  await fs.rm(temporaryRoot, { recursive: true, force: true })
}
