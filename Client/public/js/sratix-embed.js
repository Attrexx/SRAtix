/**
 * SRAtix Client — Embed Widget
 *
 * Initializes SRAtix ticket widgets on pages with [sratix_*] shortcodes.
 * Communicates with the SRAtix Server API to render ticket selection,
 * registration forms, and attendee self-service.
 *
 * Config is provided via wp_localize_script as `sratixConfig`.
 */
(function () {
  'use strict';

  const config = window.sratixConfig || {};

  if (!config.apiUrl || !config.eventId) {
    console.warn('[SRAtix] Missing apiUrl or eventId in config');
    return;
  }

  /**
   * Fetch JSON from the SRAtix Server API.
   */
  async function apiFetch(endpoint, options = {}) {
    const url = config.apiUrl.replace(/\/$/, '') + '/' + endpoint.replace(/^\//, '');
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`SRAtix API error: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Initialize the ticket selection widget.
   */
  async function initTicketsWidget() {
    const container = document.getElementById('sratix-tickets-widget');
    if (!container) return;

    const eventId = container.dataset.eventId || config.eventId;
    const layout = container.dataset.layout || 'cards';

    try {
      // Fetch public ticket types for this event
      const ticketTypes = await apiFetch(`events/${eventId}/ticket-types/public`);

      if (!ticketTypes || ticketTypes.length === 0) {
        container.innerHTML = '<p class="sratix-info">No tickets available at this time.</p>';
        return;
      }

      container.innerHTML = renderTicketTypes(ticketTypes, layout);
      bindTicketActions(container, eventId);
    } catch (err) {
      console.error('[SRAtix] Failed to load tickets:', err);
      container.innerHTML = '<p class="sratix-error">Unable to load tickets. Please try again later.</p>';
    }
  }

  /**
   * Render ticket type cards.
   */
  function renderTicketTypes(types, layout) {
    const className = layout === 'list' ? 'sratix-list' : 'sratix-cards';

    return `<div class="${className}">
      ${types
        .map(
          (t) => `
        <div class="sratix-ticket-card" data-ticket-type-id="${t.id}">
          <h3>${escHtml(t.name)}</h3>
          ${t.description ? `<p class="sratix-desc">${escHtml(t.description)}</p>` : ''}
          <div class="sratix-price">
            ${t.priceCents === 0 ? 'Free' : formatPrice(t.priceCents, t.currency)}
          </div>
          ${
            t.quantity !== null && t.sold >= t.quantity
              ? '<span class="sratix-badge sratix-badge--sold-out">Sold Out</span>'
              : '<button class="sratix-btn sratix-btn--primary" data-action="select">Select</button>'
          }
        </div>
      `
        )
        .join('')}
    </div>`;
  }

  /**
   * Bind click handlers for ticket selection.
   */
  function bindTicketActions(container, eventId) {
    container.querySelectorAll('[data-action="select"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.sratix-ticket-card');
        const ticketTypeId = card.dataset.ticketTypeId;

        // TODO: Open registration form modal or redirect to checkout
        // For now, log the selection
        console.log('[SRAtix] Selected ticket type:', ticketTypeId, 'for event:', eventId);
        alert('Ticket selection will open the registration form. (Coming in Phase 2)');
      });
    });
  }

  /**
   * Initialize the "My Tickets" self-service widget.
   */
  async function initMyTicketsWidget() {
    const container = document.getElementById('sratix-my-tickets-widget');
    if (!container) return;

    // TODO: Authenticate user and fetch their tickets
    container.innerHTML = '<p class="sratix-info">Your tickets will appear here after purchase.</p>';
  }

  /**
   * Initialize the schedule widget.
   */
  async function initScheduleWidget() {
    const container = document.getElementById('sratix-schedule-widget');
    if (!container) return;

    // TODO: Fetch sessions from Server API
    container.innerHTML = '<p class="sratix-info">Event schedule will be published soon.</p>';
  }

  /* ── Helpers ── */

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatPrice(cents, currency) {
    const amount = (cents / 100).toFixed(2);
    return `${currency} ${amount}`;
  }

  /* ── Init on DOM ready ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initTicketsWidget();
    initMyTicketsWidget();
    initScheduleWidget();
  }
})();
