/**
 * Shared email template fragments.
 *
 * Used by EmailService, AuthService, and ContactService
 * to ensure consistent header / pre-footer / footer across all emails.
 */

const BASE_URL = 'https://tix.swiss-robotics.org';
const EVENT_URL = 'https://swissroboticsday.ch';
const SRD_LOGO = `${BASE_URL}/srd-logo-light.png`;
const SRATIX_LOGO = `${BASE_URL}/logo.png`;

/**
 * Dual-logo header: SRD event logo (left) + "Powered by SRAtix" (right).
 * Subtitle line sits below both logos.
 */
export function emailHeader(subtitle: string): string {
  return `
        <tr>
          <td style="padding: 24px 32px 0; background: #1a1a2e;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr>
                <td style="vertical-align: middle;" width="50%">
                  <a href="${EVENT_URL}" target="_blank" style="text-decoration: none;">
                    <img src="${SRD_LOGO}" alt="Swiss Robotics Day" height="52" style="height: 52px; width: auto; display: block;" />
                  </a>
                </td>
                <td style="vertical-align: middle; text-align: right;" width="50%">
                  <table role="presentation" cellspacing="0" cellpadding="0" style="margin-left: auto;">
                    <tr>
                      <td style="text-align: right;">
                        <span style="font-size: 10px; color: rgba(255,255,255,0.55); display: block; margin-bottom: 4px;">Powered by</span>
                        <a href="${BASE_URL}" target="_blank" style="text-decoration: none;">
                          <img src="${SRATIX_LOGO}" alt="SRAtix" height="22" style="height: 22px; width: auto; display: block; margin-left: auto;" />
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 32px 20px; background: #1a1a2e;">
            <p style="margin: 0; color: rgba(255,255,255,0.8); font-size: 14px;">${subtitle}</p>
          </td>
        </tr>`;
}

/**
 * Pre-footer dark band with a CTA button linking to the event site.
 */
export function emailPreFooter(): string {
  return `
        <tr>
          <td style="padding: 24px 32px; background: #1a1a2e; text-align: center;">
            <a href="${EVENT_URL}" target="_blank" style="display: inline-block; background: #ffffff; color: #1a1a2e; padding: 10px 28px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Visit swissroboticsday.ch</a>
          </td>
        </tr>`;
}

/**
 * Footer with linked branding.
 * @param variant 'public' | 'admin' — controls the "do not reply" wording.
 */
export function emailFooter(variant: 'public' | 'admin' = 'public'): string {
  const doNotReply =
    variant === 'admin'
      ? 'This is an automated notification. Do not reply.'
      : 'This is an automated message. Please do not reply to this email.';

  return `
        <tr>
          <td style="padding: 20px 32px; background: #f8f9fa; border-top: 1px solid #eee; font-size: 12px; color: #999;">
            <p style="margin: 0;"><a href="${EVENT_URL}" style="color: #999; text-decoration: underline;">Swiss Robotics Day</a> powered by the <a href="${BASE_URL}" style="color: #999; text-decoration: underline;">SRAtix Ticketing Platform</a></p>
            <p style="margin: 4px 0 0;">${doNotReply}</p>
          </td>
        </tr>`;
}

/**
 * Full HTML document wrapper for standard emails.
 * Combines header → body → pre-footer → footer into a complete template.
 */
export function emailShell(
  subtitle: string,
  body: string,
  variant: 'public' | 'admin' = 'public',
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background: #ffffff;">
        ${emailHeader(subtitle)}
        <tr>
          <td style="padding: 30px 40px;">
            ${body}
          </td>
        </tr>
        ${emailPreFooter()}
        ${emailFooter(variant)}
      </table>
    </body>
    </html>`;
}
