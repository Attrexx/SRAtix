import { Controller, Get, Param, Res, Header } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { EventsService } from './events.service';
import * as sanitizeHtml from 'sanitize-html';

/**
 * Legal Page Controller — serves event legal documents as public HTML pages.
 *
 * No authentication required. These pages are linked from consent checkboxes
 * in the registration form and open in a new tab.
 *
 * Route: GET /api/events/:id/legal/:slug
 * Slugs: terms-conditions, privacy-policy, code-of-conduct, photography-consent
 */
@Controller('events/:id/legal')
export class EventsLegalController {
  constructor(private readonly eventsService: EventsService) {}

  @Get(':slug')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  async getLegalPage(
    @Param('id') eventId: string,
    @Param('slug') slug: string,
    @Res() reply: FastifyReply,
  ) {
    try {
      const content = await this.eventsService.getLegalPage(eventId, slug);

      if (!content) {
        return reply
          .status(404)
          .type('text/html')
          .send(this.renderPage('Page Not Found', '<p>This legal document has not been configured yet.</p>'));
      }

      // Sanitize stored HTML to prevent XSS
      const safe = sanitizeHtml(content, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'img']),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ['src', 'alt', 'width', 'height'],
          a: ['href', 'target', 'rel'],
        },
      });

      const title = this.slugToTitle(slug);

      return reply
        .type('text/html')
        .send(this.renderPage(title, safe));
    } catch {
      return reply
        .status(404)
        .type('text/html')
        .send(this.renderPage('Page Not Found', '<p>This legal document is not available.</p>'));
    }
  }

  private slugToTitle(slug: string): string {
    const map: Record<string, string> = {
      'terms-conditions': 'Terms & Conditions',
      'terms_conditions': 'Terms & Conditions',
      'privacy-policy': 'Privacy Policy',
      'privacy_policy': 'Privacy Policy',
      'code-of-conduct': 'Code of Conduct',
      'code_of_conduct': 'Code of Conduct',
      'photography-consent': 'Photography / Media Consent',
      'photography_consent': 'Photography / Media Consent',
    };
    return map[slug] || slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private renderPage(title: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${this.escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 40px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.7; color: #1a1a2e;
      background: #f8f9fc;
    }
    .container {
      max-width: 760px; margin: 0 auto;
      background: #fff; border-radius: 12px;
      padding: 48px 40px; box-shadow: 0 1px 4px rgba(0,0,0,.08);
    }
    h1 { font-size: 1.8rem; margin: 0 0 24px; color: #0f172a; }
    h2 { font-size: 1.3rem; margin: 32px 0 12px; color: #1e293b; }
    h3 { font-size: 1.1rem; margin: 24px 0 8px; color: #334155; }
    p { margin: 0 0 16px; }
    ul, ol { margin: 0 0 16px; padding-left: 24px; }
    li { margin-bottom: 6px; }
    a { color: #6366f1; }
    @media (max-width: 600px) {
      body { padding: 20px 12px; }
      .container { padding: 28px 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${this.escHtml(title)}</h1>
    ${body}
  </div>
</body>
</html>`;
  }

  private escHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
