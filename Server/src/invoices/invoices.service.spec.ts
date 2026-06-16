import { InvoicesService } from './invoices.service';

describe('InvoicesService invoice description formatting', () => {
  it('strips markup and decodes common entities for line item descriptions', () => {
    const service = new InvoicesService({} as any, { get: jest.fn() } as any);

    expect((service as any).cleanInvoiceDescription('<strong>Booth</strong>&nbsp;&amp; staff tickets'))
      .toBe('Booth & staff tickets');
  });

  it('caps long descriptions for compact invoice rows', () => {
    const service = new InvoicesService({} as any, { get: jest.fn() } as any);

    expect((service as any).cleanInvoiceDescription('x'.repeat(300))).toHaveLength(240);
  });
});

describe('InvoicesService shared PDF renderer', () => {
  const baseModel = {
    invoiceNumber: 'SRD-26-0001',
    lang: 'en',
    currency: 'CHF',
    issuer: {
      companyName: 'Swiss Robotics Association',
      street: 'c/o EPFL', city: 'Lausanne', postalCode: '1015',
      country: 'Switzerland', vatNumber: '',
    },
    billTo: {
      name: 'Jane Buyer', email: 'jane@example.com', street: '', city: '',
      postalCode: '', country: '', companyName: 'Acme Robotics', vatNumber: '',
    },
    refLines: ['Order: LOG-2026-0001', 'Event: Swiss Robotics Day 2026'],
    lineItems: [{ desc: 'Booth table', qty: 2, unitCents: 5000, totalCents: 10000 }],
    subtotalCents: 10000,
    discountCents: 0,
    discountLabel: '',
    totalCents: 10000,
    paidAt: new Date('2026-06-16T00:00:00Z'),
    footerText: 'Swiss Robotics Day',
    qrReference: 'LOG-2026-0001',
    qrMessage: 'LOG-2026-0001 — Swiss Robotics Day 2026',
  };

  it('renders a valid, non-empty PDF from a normalized model (used by both order + logistics invoices)', async () => {
    const service = new InvoicesService({} as any, { get: jest.fn() } as any);

    const pdf = await (service as any).renderInvoicePdf(baseModel);

    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(500);
    // Every PDF starts with the %PDF- magic header.
    expect(Buffer.from(pdf.slice(0, 5)).toString('latin1')).toBe('%PDF-');
  });
});

describe('InvoicesService invoice number stability', () => {
  /**
   * Build a stateful Prisma double whose `invoice_counter` Setting and the
   * order's `meta` persist across calls — exactly what makes a repeated render
   * either reuse or bump the number. `getOrder` returns the live order object so
   * the second generate call sees the meta the first one persisted.
   */
  function buildPrisma(orderModel: 'order' | 'logisticsOrder', getOrder: () => any) {
    let counter = 0;
    const setting = {
      findFirst: jest.fn(async () =>
        counter === 0 ? null : { id: 's1', scope: 'global', key: 'invoice_counter', value: { count: counter } },
      ),
      create: jest.fn(async ({ data }: any) => {
        counter = data.value.count;
        return data;
      }),
      update: jest.fn(async ({ data }: any) => {
        counter = data.value.count;
        return data;
      }),
    };
    const model = {
      findUnique: jest.fn(async () => getOrder()),
      update: jest.fn(async ({ data }: any) => {
        getOrder().meta = data.meta;
        return getOrder();
      }),
    };
    return { setting, [orderModel]: model } as any;
  }

  it('returns the same invoice number across repeated renders of one paid ticket order', async () => {
    const order: any = {
      id: 'order-1', status: 'paid', orderNumber: 'SRD-2026-0001',
      currency: 'CHF', totalCents: 10000, paidAt: new Date('2026-06-16T00:00:00Z'),
      billingAddress: null, customerName: 'Jane Buyer', customerEmail: 'jane@example.com',
      notes: null, meta: { invoiceToken: 'tok-1' }, items: [], tickets: [], attendee: null,
      event: {
        id: 'event-1', name: 'Swiss Robotics Day 2026',
        startDate: new Date('2026-11-01T00:00:00Z'),
        venue: null, venueAddress: null, currency: 'CHF', meta: {}, org: { name: 'SRA' },
      },
    };
    const prisma = buildPrisma('order', () => order);
    const service = new InvoicesService(prisma, { get: jest.fn() } as any);

    const first = await service.generateInvoice('order-1');
    const second = await service.generateInvoice('order-1');

    expect(first.invoiceNumber).toBe(second.invoiceNumber);
    // Number generated (counter consumed) exactly once, then reused.
    expect(prisma.setting.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.order.update).toHaveBeenCalledTimes(1);
    // Persisted to meta without clobbering the existing invoiceToken.
    expect(order.meta.invoiceNumber).toBe(first.invoiceNumber);
    expect(order.meta.invoiceToken).toBe('tok-1');
  });

  it('returns the same invoice number across repeated renders of one paid logistics order', async () => {
    const order: any = {
      id: 'log-1', status: 'paid', orderNumber: 'LOG-2026-0001',
      currency: 'CHF', totalCents: 5000, paidAt: new Date('2026-06-16T00:00:00Z'),
      customerName: 'Acme Robotics', customerEmail: 'ops@acme.test',
      meta: {}, items: [],
      event: {
        name: 'Swiss Robotics Day 2026', startDate: new Date('2026-11-01T00:00:00Z'),
        venue: null, venueAddress: null, currency: 'CHF', meta: {},
      },
      org: { name: 'Acme Robotics', contactEmail: 'ops@acme.test' },
    };
    const prisma = buildPrisma('logisticsOrder', () => order);
    const service = new InvoicesService(prisma, { get: jest.fn() } as any);

    const first = await service.generateLogisticsInvoice('log-1');
    const second = await service.generateLogisticsInvoice('log-1');

    expect(first.invoiceNumber).toBe(second.invoiceNumber);
    expect(prisma.setting.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.logisticsOrder.update).toHaveBeenCalledTimes(1);
    expect(order.meta.invoiceNumber).toBe(first.invoiceNumber);
  });
});
