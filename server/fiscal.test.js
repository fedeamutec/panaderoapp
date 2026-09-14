import assert from 'node:assert/strict'
import { selectFiscalLegalName } from './mercadolibre.js'
import { associatedVoucherFor, creditNoteTypeFor } from './arca/wsfe.js'
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

assert.deepEqual(associatedVoucherFor({ cae: '123', voucher: { voucherType: 1, pointOfSale: 3, voucherNumber: 42 } }), {
  type: 1,
  pointOfSale: 3,
  number: 42,
})
assert.equal(creditNoteTypeFor(1), 3)
assert.equal(creditNoteTypeFor(6), 8)
assert.equal(creditNoteTypeFor(11), 13)

console.log('Fiscal helpers OK')
