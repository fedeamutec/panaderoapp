import assert from 'node:assert/strict'
import { fiscalDisplayData, normalizeBillingInfoResponse, selectFiscalLegalName } from './mercadolibre.js'
import { matchReceiverVatCondition, sanitizeFiscalValue } from './fiscalRules.js'
import {
  associatedVoucherFor,
  buildCreditNoteDetailXml,
  creditNoteTypeFor,
  originalInvoiceFiscalData,
} from './arca/wsfe.js'
import { normalizeCuit } from './arca/padron.js'

assert.equal(normalizeCuit('20-36607695-7'), '20366076957')
assert.equal(normalizeCuit('203660957'), '')

assert.equal(
  selectFiscalLegalName({
    documentType: 'CUIT',
    billingInfo: { billing_info: { business_name: 'ACME SRL' } },
  }),
  'ACME SRL',
)
assert.equal(
  selectFiscalLegalName({
    documentType: 'CUIT',
    billingInfo: { additional_info: [{ type: 'business_name', value: 'ACME SA' }] },
  }),
  'ACME SA',
)
assert.equal(selectFiscalLegalName({ documentType: 'DNI', billingInfo: { business_name: 'No usar' } }), '')
assert.deepEqual(normalizeBillingInfoResponse({
  billing_info: {
    business_name: 'ACME SRL',
    identification: { type: 'CUIT', number: '30-12345678-9' },
    additional_info: [{ type: 'taxpayer_type', value: { id: 1, description: 'IVA Responsable Inscripto' } }],
  },
}), {
  raw: {
    billing_info: {
      business_name: 'ACME SRL',
      identification: { type: 'CUIT', number: '30-12345678-9' },
      additional_info: [{ type: 'taxpayer_type', value: { id: 1, description: 'IVA Responsable Inscripto' } }],
    },
  },
  billing: {
    business_name: 'ACME SRL',
    identification: { type: 'CUIT', number: '30-12345678-9' },
    additional_info: [{ type: 'taxpayer_type', value: { id: 1, description: 'IVA Responsable Inscripto' } }],
  },
  additionalInfo: [{ type: 'taxpayer_type', value: { id: 1, description: 'IVA Responsable Inscripto' } }],
  legalName: 'ACME SRL',
  documentType: 'CUIT',
  documentNumber: '30123456789',
  taxpayerTypeId: 1,
  taxpayerDescription: 'IVA Responsable Inscripto',
})
assert.deepEqual(fiscalDisplayData({ documentType: 'CUIT', fiscalLegalName: 'ACME SRL', name: 'nickname' }), {
  label: 'Razón social',
  value: 'ACME SRL',
  displayName: 'ACME SRL',
})
assert.deepEqual(fiscalDisplayData({ documentType: 'DNI', name: 'Juan Perez' }), {
  label: 'Nombre',
  value: 'Juan Perez',
  displayName: 'Juan Perez',
})

const arcaConditions = [
  { id: 1, description: 'IVA Responsable Inscripto' },
  { id: 4, description: 'IVA Sujeto Exento' },
  { id: 5, description: 'Consumidor Final' },
  { id: 6, description: 'Responsable Monotributo' },
]
assert.equal(matchReceiverVatCondition(arcaConditions, { id: 1, description: 'Responsable Inscripto' }, 'A').id, 1)
assert.equal(matchReceiverVatCondition(arcaConditions, 'IVA Responsable Inscripto', 'A').id, 1)
assert.equal(matchReceiverVatCondition(arcaConditions, { id: 5, description: 'Consumidor Final' }, 'B').id, 5)
assert.throws(() => matchReceiverVatCondition(arcaConditions, '', 'A'), /Responsable Inscripto/)
assert.deepEqual(sanitizeFiscalValue({ id: 1, description: 'IVA Responsable Inscripto' }), {
  id: 1,
  description: 'IVA RESPONSABLE INSCRIPTO',
})

assert.deepEqual(associatedVoucherFor({ cae: '123', voucher: { voucherType: 1, pointOfSale: 3, voucherNumber: 42 } }), {
  type: 1,
  pointOfSale: 3,
  number: 42,
})
assert.equal(creditNoteTypeFor(1), 3)
assert.equal(creditNoteTypeFor(6), 8)
assert.equal(creditNoteTypeFor(11), 13)

const facturaA = {
  cae: '123',
  buyer: { taxCondition: 'Consumidor Final', documentNumber: '20123456789' },
  receiverVatCondition: { id: 1, description: 'Responsable Inscripto' },
  voucher: { voucherType: 1, pointOfSale: 3, voucherNumber: 42, documentType: 80, documentNumber: 20123456789, recipientVatConditionId: 1, amount: 121, netAmount: 100, vatAmount: 21, vatRate: 21 },
}
const facturaB = {
  cae: '456',
  buyer: { taxCondition: 'Consumidor Final', documentNumber: '12345678' },
  receiverVatCondition: { id: 5, description: 'Consumidor Final' },
  voucher: { voucherType: 6, pointOfSale: 3, voucherNumber: 43, documentType: 96, documentNumber: 12345678, recipientVatConditionId: 5, amount: 121, netAmount: 100, vatAmount: 21, vatRate: 21 },
}
assert.deepEqual(originalInvoiceFiscalData(facturaA), {
  conditionId: 1,
  conditionDescription: 'Responsable Inscripto',
  documentType: 80,
  documentNumber: 20123456789,
})
assert.deepEqual(originalInvoiceFiscalData(facturaB), {
  conditionId: 5,
  conditionDescription: 'Consumidor Final',
  documentType: 96,
  documentNumber: 12345678,
})
assert.throws(
  () => originalInvoiceFiscalData({ cae: '789', voucher: { voucherType: 1, documentType: 80, documentNumber: 20123456789 }, buyer: {} }),
  /condición IVA del receptor válida/,
)

const creditNoteXml = buildCreditNoteDetailXml({
  voucherNumber: 44,
  voucherDate: '20260915',
  pointOfSale: 3,
  voucherType: 3,
  total: 121,
  netAmount: 100,
  vatAmount: 21,
  vatId: 5,
  currency: 'PES',
  exchangeRate: 1,
  fiscalData: originalInvoiceFiscalData(facturaA),
  associated: { type: 1, pointOfSale: 3, number: 42 },
})
assert.match(creditNoteXml, /<CondicionIVAReceptorId>1<\/CondicionIVAReceptorId>/)
assert.match(creditNoteXml, /<DocTipo>80<\/DocTipo><DocNro>20123456789<\/DocNro>/)
assert.match(creditNoteXml, /<CbtesAsoc><CbteAsoc><Tipo>1<\/Tipo><PtoVta>3<\/PtoVta><Nro>42<\/Nro>/)

const creditNoteBXml = buildCreditNoteDetailXml({
  voucherNumber: 45,
  voucherDate: '20260915',
  total: 121,
  netAmount: 100,
  vatAmount: 21,
  vatId: 5,
  currency: 'PES',
  exchangeRate: 1,
  fiscalData: originalInvoiceFiscalData(facturaB),
  associated: { type: 6, pointOfSale: 3, number: 43 },
})
assert.match(creditNoteBXml, /<CondicionIVAReceptorId>5<\/CondicionIVAReceptorId>/)
assert.match(creditNoteBXml, /<DocTipo>96<\/DocTipo><DocNro>12345678<\/DocNro>/)

console.log('Fiscal helpers OK')
