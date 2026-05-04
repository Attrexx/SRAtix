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
