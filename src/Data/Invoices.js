export const demoInvoices = [
  {
    orderId: '84522',
    createdAt: '2026-03-14T15:22:00.000Z',
    cae: '70412345678901',
    buyer: { name: 'CR Argentina SRL' },
    saleSnapshot: { address: { state: 'Buenos Aires' } },
    voucher: {
      voucherTypeDescription: 'Factura A',
      formattedNumber: '0003-00000142',
      vatRate: 21,
      vatAmount: 32842.15,
      amount: 189200,
    },
  },
  {
    orderId: '84518',
    createdAt: '2026-03-12T09:10:00.000Z',
    cae: '70412345678902',
    buyer: { name: 'Juan Pérez' },
    saleSnapshot: { address: { state: 'Córdoba' } },
    voucher: {
      voucherTypeDescription: 'Factura B',
      formattedNumber: '0003-00000141',
      vatRate: 21,
      vatAmount: 5632.23,
      amount: 32450,
    },
  },
  {
    orderId: '84509',
    createdAt: '2026-03-08T18:45:00.000Z',
    cae: '70412345678903',
    buyer: { name: 'Taller Norte' },
    saleSnapshot: { address: { state: 'Santa Fe' } },
    voucher: {
      voucherTypeDescription: 'Factura B',
      formattedNumber: '0003-00000140',
      vatRate: 10.5,
      vatAmount: 8013.21,
      amount: 84300,
    },
  },
]
