const VAT_CONDITION_IDS = {
  RESPONSABLE_INSCRIPTO: new Set([1]),
  MONOTRIBUTO: new Set([6]),
  EXENTO: new Set([4]),
  CONSUMIDOR_FINAL: new Set([5]),
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
}

function conditionParts(value) {
  if (value && typeof value === 'object') {
    return {
      id: Number(value.id || value.code || value.value),
      description: normalizeText(value.description || value.name || value.label || value.value),
    }
  }
  return { id: Number(value), description: normalizeText(value) }
}

function matchesCondition(item, ids, terms) {
  const parts = conditionParts(item)
  return ids.has(parts.id) || terms.some((term) => parts.description.includes(term))
}

export function matchReceiverVatCondition(conditions = [], taxCondition = '', invoiceType = 'B') {
  const className = String(invoiceType || 'B').toUpperCase()
  const source = conditionParts(taxCondition)

  if (className === 'A') {
    const isResponsible = VAT_CONDITION_IDS.RESPONSABLE_INSCRIPTO.has(source.id)
      || source.description.includes('RESPONSABLE INSCRIP')
      || source.description.includes('IVA RESPONSABLE')
    if (!isResponsible) {
      throw new Error('Factura A requiere un receptor Responsable Inscripto. Revisá la condición fiscal del cliente.')
    }
    return conditions.find((item) => matchesCondition(item, VAT_CONDITION_IDS.RESPONSABLE_INSCRIPTO, ['RESPONSABLE INSCRIP', 'IVA RESPONSABLE']))
  }

  if (VAT_CONDITION_IDS.MONOTRIBUTO.has(source.id) || source.description.includes('MONOTRIB')) {
    return conditions.find((item) => matchesCondition(item, VAT_CONDITION_IDS.MONOTRIBUTO, ['MONOTRIB']))
  }
  if (VAT_CONDITION_IDS.EXENTO.has(source.id) || source.description.includes('EXENT')) {
    return conditions.find((item) => matchesCondition(item, VAT_CONDITION_IDS.EXENTO, ['EXENT']))
  }
  if (VAT_CONDITION_IDS.CONSUMIDOR_FINAL.has(source.id) || source.description.includes('CONSUMIDOR') || source.description.includes('FINAL')) {
    return conditions.find((item) => matchesCondition(item, VAT_CONDITION_IDS.CONSUMIDOR_FINAL, ['CONSUMIDOR FINAL']))
  }

  throw new Error('Para Factura B completá la condición fiscal del cliente (Consumidor final, Monotributo o Exento) antes de emitir.')
}

export function resolveBillingVatCondition(value, invoiceType = 'B') {
  const source = conditionParts(value)
  const className = String(invoiceType || 'B').toUpperCase()
  const isResponsible = VAT_CONDITION_IDS.RESPONSABLE_INSCRIPTO.has(source.id)
    || source.description.includes('RESPONSABLE INSCRIP')
    || source.description.includes('IVA RESPONSABLE')
  const isMonotributo = VAT_CONDITION_IDS.MONOTRIBUTO.has(source.id) || source.description.includes('MONOTRIB')
  const isExento = VAT_CONDITION_IDS.EXENTO.has(source.id) || source.description.includes('EXENT')
  const isConsumidorFinal = VAT_CONDITION_IDS.CONSUMIDOR_FINAL.has(source.id)
    || source.description.includes('CONSUMIDOR')
    || source.description.includes('FINAL')

  if (className === 'A' && isResponsible) return { id: 1, description: 'Responsable Inscripto' }
  if (className === 'A') throw new Error('Factura A requiere que Mercado Libre informe un receptor Responsable Inscripto.')
  if (isMonotributo) return { id: 6, description: 'Monotributo' }
  if (isExento) return { id: 4, description: 'Exento' }
  if (isConsumidorFinal) return { id: 5, description: 'Consumidor Final' }
  throw new Error('Mercado Libre no informó una condición IVA reconocible para la venta.')
}

export function sanitizeFiscalValue(value) {
  const parts = conditionParts(value)
  return {
    id: Number.isInteger(parts.id) && parts.id > 0 ? parts.id : null,
    description: parts.description || null,
  }
}
