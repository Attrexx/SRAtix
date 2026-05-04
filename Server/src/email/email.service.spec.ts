import { EmailService } from './email.service';
import type { EmailMessage, EmailTransport } from './email-transport.interface';

describe('EmailService order confirmation wording', () => {
  function setup() {
    const sent: EmailMessage[] = [];
    const transport: EmailTransport = {
      send: jest.fn(async (message: EmailMessage) => {
        sent.push(message);
        return { success: true, messageId: 'test-message' };
      }),
    };

    return { service: new EmailService(transport), sent };
  }

  const baseData = {
    customerName: 'Ada Lovelace',
    orderNumber: 'SRD-1001',
    totalFormatted: '49.00',
    currency: 'CHF',
    tickets: [{ typeName: 'Visitor Pass', quantity: 1, qrPayload: '' }],
    ticketCodes: ['ABC123'],
    apiBaseUrl: 'https://tix.swiss-robotics.org',
    eventName: 'Swiss Robotics Day',
    eventDate: '2026-11-06',
    eventVenue: 'Zurich',
  };

  it('uses singular English wording for one purchased ticket', async () => {
    const { service, sent } = setup();

    await service.sendOrderConfirmation('ada@example.com', baseData);

    expect(sent[0].subject).toBe('Your ticket for Swiss Robotics Day — Order SRD-1001');
    expect(sent[0].text).toContain('Ticket:\n  - Visitor Pass x1');
    expect(sent[0].text).toContain('Ticket Code:\n  ABC123');
    expect(sent[0].html).toContain('Your ticket for <strong>Swiss Robotics Day</strong> is confirmed.');
    expect(sent[0].html).toContain('Your Ticket Code');
  });

  it('uses plural English wording for multiple purchased tickets', async () => {
    const { service, sent } = setup();

    await service.sendOrderConfirmation('ada@example.com', {
      ...baseData,
      tickets: [{ typeName: 'Visitor Pass', quantity: 2, qrPayload: '' }],
      ticketCodes: ['ABC123', 'DEF456'],
    });

    expect(sent[0].subject).toBe('Your tickets for Swiss Robotics Day — Order SRD-1001');
    expect(sent[0].text).toContain('Tickets:\n  - Visitor Pass x2');
    expect(sent[0].text).toContain('Ticket Codes:\n  ABC123');
    expect(sent[0].html).toContain('Your tickets for <strong>Swiss Robotics Day</strong> are confirmed.');
    expect(sent[0].html).toContain('Your Ticket Codes');
  });

  it('uses localized singular wording when a checkout language is present', async () => {
    const { service, sent } = setup();

    await service.sendOrderConfirmation('ada@example.com', {
      ...baseData,
      language: 'fr',
    });

    expect(sent[0].subject).toBe('Votre billet pour Swiss Robotics Day — Commande SRD-1001');
    expect(sent[0].text).toContain('Billet:\n  - Visitor Pass x1');
    expect(sent[0].text).toContain('Code billet:\n  ABC123');
    expect(sent[0].html).toContain('Votre billet pour <strong>Swiss Robotics Day</strong> est confirmé.');
    expect(sent[0].html).toContain('Votre code billet');
  });
});
