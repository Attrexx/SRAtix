/**
 * SRAtix Client — Embed Widget
 *
 * Initializes SRAtix ticket widgets on pages with [sratix_*] shortcodes.
 * Communicates with the SRAtix Server API to render ticket selection,
 * registration forms, and attendee self-service.
 *
 * Config is provided via wp_localize_script as `sratixConfig`.
 *
 * Purchase flow:
 *   Ticket card → Quantity modal → Registration form → Stripe Checkout
 *   On return with ?sratix_success=1 → success banner
 */
(function () {
  'use strict';

  const config = window.sratixConfig || {};
  const t = (typeof sratixI18n !== 'undefined') ? sratixI18n.t : function (k) { return k; };

  if (!config.apiUrl || !config.eventId) {
    console.warn('[SRAtix] Missing apiUrl or eventId in config');
    return;
  }

  const API_BASE = config.apiUrl.replace(/\/$/, '');
  const EVENT_ID = config.eventId;

  // ─── API helpers ─────────────────────────────────────────────────────────────

  async function apiFetch(endpoint, options = {}) {
    const url = API_BASE + '/' + endpoint.replace(/^\//, '');
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || `SRAtix API error: ${res.status}`);
    }
    return body;
  }

  // ─── Ticket widget ────────────────────────────────────────────────────────────

  async function initTicketsWidget() {
    const container = document.getElementById('sratix-tickets-widget');
    if (!container) return;

    const eventId = container.dataset.eventId || EVENT_ID;
    const layout = container.dataset.layout || 'cards';

    try {
      const ticketTypes = await apiFetch(`events/${eventId}/ticket-types/public`);
      if (!ticketTypes || ticketTypes.length === 0) {
        container.innerHTML = `<p class="sratix-info">${escHtml(t('tickets.noTickets'))}</p>`;
        return;
      }
      container.innerHTML = renderTicketCards(ticketTypes, layout);
      bindSelectButtons(container, eventId, ticketTypes);
    } catch (err) {
      console.error('[SRAtix] Failed to load tickets:', err);
      container.innerHTML = `<p class="sratix-error">${escHtml(t('tickets.loadError'))}</p>`;
    }
  }

  function renderTicketCards(types, layout) {
    const cls = layout === 'list' ? 'sratix-list' : 'sratix-cards';
    return `<div class="${cls}">${types.map(renderCard).join('')}</div>`;
  }

  function renderCard(tt) {
    const soldOut = tt.soldOut || (tt.available !== null && tt.available <= 0);
    const priceHtml = tt.priceCents === 0
      ? `<span class="sratix-price-free">${escHtml(t('tickets.free'))}</span>`
      : `<div class="sratix-price">${formatPrice(tt.priceCents, tt.currency)}</div>`;
    const availHtml = tt.available !== null && !soldOut
      ? `<span class="sratix-avail">${escHtml(t('tickets.remaining', { n: tt.available }))}</span>`
      : '';
    const btn = soldOut
      ? `<span class="sratix-badge sratix-badge--sold-out">${escHtml(t('tickets.soldOut'))}</span>`
      : `<button class="sratix-btn sratix-btn--primary" data-action="select" data-ticket-type-id="${escAttr(tt.id)}">${escHtml(t('tickets.select'))}</button>`;

    return `<div class="sratix-ticket-card" data-ticket-type-id="${escAttr(tt.id)}">
      <h3>${escHtml(tt.name)}</h3>
      ${tt.description ? `<p class="sratix-desc">${escHtml(tt.description)}</p>` : ''}
      ${priceHtml}${availHtml}
      ${btn}
    </div>`;
  }

  function bindSelectButtons(container, eventId, ticketTypes) {
    container.querySelectorAll('[data-action="select"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ticketTypeId;
        const tt = ticketTypes.find((item) => item.id === id);
        if (tt) openQuantityModal(eventId, tt);
      });
    });
  }

  // ─── Quantity modal (Stage A) ─────────────────────────────────────────────────

  function openQuantityModal(eventId, tt) {
    const maxQty = Math.min(
      tt.maxPerOrder || 10,
      tt.available !== null ? tt.available : 99,
    );
    const modal = createModalShell('sratix-modal-qty');

    modal.innerHTML = `
      <div class="sratix-modal-box">
        <button class="sratix-modal-close" aria-label="${escAttr(t('modal.close'))}">&times;</button>
        <h2 class="sratix-modal-title">${escHtml(tt.name)}</h2>
        <div class="sratix-modal-body">
          <div class="sratix-qty-row">
            <span class="sratix-label">${escHtml(t('qty.quantity'))}</span>
            <div class="sratix-qty-stepper">
              <button class="sratix-qty-btn" id="sratix-qty-dec" aria-label="${escAttr(t('qty.decrease'))}">−</button>
              <span class="sratix-qty-val" id="sratix-qty-val">1</span>
              <button class="sratix-qty-btn" id="sratix-qty-inc" aria-label="${escAttr(t('qty.increase'))}">+</button>
            </div>
          </div>
          <div class="sratix-price-row" id="sratix-price-display"></div>
          <div class="sratix-promo-row">
            <label class="sratix-label" for="sratix-promo-input">${escHtml(t('qty.promoLabel'))} <span style="font-weight:400;opacity:.7">${escHtml(t('qty.promoOptional'))}</span></label>
            <div class="sratix-promo-field">
              <input class="sratix-input" id="sratix-promo-input" type="text" placeholder="${escAttr(t('qty.promoPlaceholder'))}" autocomplete="off" />
              <button class="sratix-btn sratix-btn--outline" id="sratix-promo-apply">${escHtml(t('qty.promoApply'))}</button>
            </div>
            <p class="sratix-promo-msg" id="sratix-promo-msg"></p>
          </div>
          <p class="sratix-error" id="sratix-qty-error" style="display:none"></p>
        </div>
        <div class="sratix-modal-footer">
          <button class="sratix-btn sratix-btn--ghost" id="sratix-qty-cancel">${escHtml(t('qty.cancel'))}</button>
          <button class="sratix-btn sratix-btn--primary" id="sratix-qty-continue">${escHtml(t('qty.continue'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let qty = 1;
    let discountCents = 0;
    let promoCode = '';

    const valEl    = modal.querySelector('#sratix-qty-val');
    const decBtn   = modal.querySelector('#sratix-qty-dec');
    const incBtn   = modal.querySelector('#sratix-qty-inc');
    const priceEl  = modal.querySelector('#sratix-price-display');
    const promoInput  = modal.querySelector('#sratix-promo-input');
    const promoApply  = modal.querySelector('#sratix-promo-apply');
    const promoMsg    = modal.querySelector('#sratix-promo-msg');
    const errorEl     = modal.querySelector('#sratix-qty-error');

    function updateDisplay() {
      valEl.textContent = qty;
      decBtn.disabled = qty <= 1;
      incBtn.disabled = qty >= maxQty;
      const subtotal = tt.priceCents * qty;
      const final = Math.max(0, subtotal - discountCents);
      if (tt.priceCents === 0) {
        priceEl.textContent = t('tickets.free');
      } else if (discountCents > 0) {
        priceEl.innerHTML = `<s>${formatPrice(subtotal, tt.currency)}</s> → <strong>${formatPrice(final, tt.currency)}</strong> ${escHtml(t('qty.afterDiscount'))}`;
      } else {
        priceEl.textContent = `${formatPrice(subtotal, tt.currency)} ${t('qty.total')}`;
      }
    }

    decBtn.addEventListener('click', () => { if (qty > 1) { qty--; updateDisplay(); } });
    incBtn.addEventListener('click', () => { if (qty < maxQty) { qty++; updateDisplay(); } });

    promoApply.addEventListener('click', async () => {
      const code = promoInput.value.trim();
      if (!code) return;
      promoApply.disabled = true;
      promoMsg.textContent = t('qty.promoValidating');
      promoMsg.className = 'sratix-promo-msg';
      try {
        const res = await apiFetch(
          `promo-codes/validate?code=${encodeURIComponent(code)}&eventId=${EVENT_ID}&ticketTypeId=${tt.id}&totalCents=${tt.priceCents * qty}`,
        );
        if (res.valid) {
          discountCents = res.discountCents || 0;
          promoCode = code;
          promoMsg.textContent = t('qty.promoApplied', { amount: formatPrice(discountCents, tt.currency) });
          promoMsg.className = 'sratix-promo-msg sratix-promo-msg--ok';
        } else {
          discountCents = 0; promoCode = '';
          promoMsg.textContent = res.message || t('qty.promoInvalid');
          promoMsg.className = 'sratix-promo-msg sratix-promo-msg--err';
        }
      } catch {
        promoMsg.textContent = t('qty.promoError');
        promoMsg.className = 'sratix-promo-msg sratix-promo-msg--err';
      }
      promoApply.disabled = false;
      updateDisplay();
    });

    modal.querySelector('#sratix-qty-cancel').addEventListener('click', closeModal);
    modal.querySelector('.sratix-modal-close').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    modal.querySelector('#sratix-qty-continue').addEventListener('click', () => {
      errorEl.style.display = 'none';
      if (qty < 1 || qty > maxQty) {
        errorEl.textContent = t('qty.rangeError', { max: maxQty });
        errorEl.style.display = '';
        return;
      }
      closeModal();
      openRegistrationModal(eventId, tt, qty, promoCode, discountCents);
    });

    updateDisplay();
    requestAnimationFrame(() => modal.classList.add('sratix-modal--visible'));
  }

  // ─── Registration modal (Stage B) ────────────────────────────────────────────

  function openRegistrationModal(eventId, tt, qty, promoCode, discountCents) {
    const subtotal  = tt.priceCents * qty;
    const finalPrice = Math.max(0, subtotal - discountCents);
    const modal = createModalShell('sratix-modal-reg');

    const submitLabel = tt.priceCents === 0 ? t('reg.completeRegistration') : t('reg.continueToPayment');

    modal.innerHTML = `
      <div class="sratix-modal-box">
        <button class="sratix-modal-close" aria-label="${escAttr(t('modal.close'))}">&times;</button>
        <h2 class="sratix-modal-title">${escHtml(t('reg.title'))}</h2>
        <p class="sratix-modal-subtitle">
          ${escHtml(tt.name)} &times; ${qty} —
          <strong>${tt.priceCents === 0 ? escHtml(t('tickets.free')) : formatPrice(finalPrice, tt.currency)}</strong>
        </p>
        <div class="sratix-modal-body">
          <form id="sratix-reg-form" novalidate>
            <div class="sratix-field-row">
              <div class="sratix-field">
                <label class="sratix-label" for="sratix-first-name">${escHtml(t('reg.firstName'))} <span class="sratix-req">*</span></label>
                <input class="sratix-input" id="sratix-first-name" type="text" autocomplete="given-name" required />
              </div>
              <div class="sratix-field">
                <label class="sratix-label" for="sratix-last-name">${escHtml(t('reg.lastName'))} <span class="sratix-req">*</span></label>
                <input class="sratix-input" id="sratix-last-name" type="text" autocomplete="family-name" required />
              </div>
            </div>
            <div class="sratix-field">
              <label class="sratix-label" for="sratix-email">${escHtml(t('reg.email'))} <span class="sratix-req">*</span></label>
              <input class="sratix-input" id="sratix-email" type="email" autocomplete="email" required />
            </div>
            <div class="sratix-field-row">
              <div class="sratix-field">
                <label class="sratix-label" for="sratix-phone">${escHtml(t('reg.phone'))}</label>
                <input class="sratix-input" id="sratix-phone" type="tel" autocomplete="tel" />
              </div>
              <div class="sratix-field">
                <label class="sratix-label" for="sratix-company">${escHtml(t('reg.organization'))}</label>
                <input class="sratix-input" id="sratix-company" type="text" autocomplete="organization" />
              </div>
            </div>
            <p class="sratix-error-msg" id="sratix-reg-error" style="display:none"></p>
          </form>
        </div>
        <div class="sratix-modal-footer">
          <button class="sratix-btn sratix-btn--ghost" id="sratix-reg-back">${escHtml(t('reg.back'))}</button>
          <button class="sratix-btn sratix-btn--primary" id="sratix-reg-submit">${escHtml(submitLabel)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Pre-fill from WP user context if available
    if (config.userEmail)     modal.querySelector('#sratix-email').value     = config.userEmail;
    if (config.userFirstName) modal.querySelector('#sratix-first-name').value = config.userFirstName;
    if (config.userLastName)  modal.querySelector('#sratix-last-name').value  = config.userLastName;

    modal.querySelector('.sratix-modal-close').addEventListener('click', closeModal);
    modal.querySelector('#sratix-reg-back').addEventListener('click', () => {
      closeModal();
      openQuantityModal(eventId, tt);
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    const submitBtn = modal.querySelector('#sratix-reg-submit');
    const errorEl   = modal.querySelector('#sratix-reg-error');

    submitBtn.addEventListener('click', async () => {
      const firstName = modal.querySelector('#sratix-first-name').value.trim();
      const lastName  = modal.querySelector('#sratix-last-name').value.trim();
      const email     = modal.querySelector('#sratix-email').value.trim();
      const phone     = modal.querySelector('#sratix-phone').value.trim();
      const company   = modal.querySelector('#sratix-company').value.trim();

      errorEl.style.display = 'none';

      if (!firstName || !lastName) {
        errorEl.textContent = t('reg.nameRequired');
        errorEl.style.display = '';
        return;
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorEl.textContent = t('reg.emailInvalid');
        errorEl.style.display = '';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('reg.pleaseWait');

      try {
        const successUrl = buildSuccessUrl();
        const result = await apiFetch('payments/checkout/public', {
          method: 'POST',
          body: JSON.stringify({
            eventId,
            ticketTypeId: tt.id,
            quantity: qty,
            attendeeData: {
              email,
              firstName,
              lastName,
              phone: phone || undefined,
              company: company || undefined,
            },
            promoCode: promoCode || undefined,
            successUrl,
            cancelUrl: window.location.href,
          }),
        });

        closeModal();

        if (result.free) {
          window.location.href = result.successUrl;
        } else if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
        } else {
          throw new Error('Unexpected response from server');
        }
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : t('reg.genericError');
        errorEl.style.display = '';
        submitBtn.disabled = false;
        submitBtn.textContent = submitLabel;
      }
    });

    requestAnimationFrame(() => modal.classList.add('sratix-modal--visible'));
  }

  // ─── Success banner ───────────────────────────────────────────────────────────

  function injectSuccessBanner() {
    const params = new URLSearchParams(window.location.search);
    const orderNumber = params.get('sratix_order');

    const banner = document.createElement('div');
    banner.className = 'sratix-success-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <span class="sratix-success-icon">✓</span>
      <div class="sratix-success-text">
        <strong>${escHtml(t('success.title'))}</strong>
        ${orderNumber ? `<span> — ${escHtml(t('success.order', { number: orderNumber }))}</span>` : ''}
        <br>${escHtml(t('success.checkEmail'))}
      </div>
      <button class="sratix-success-close" aria-label="${escAttr(t('success.dismiss'))}">&times;</button>
    `;
    banner.querySelector('.sratix-success-close').addEventListener('click', () => banner.remove());

    // Insert just before the first widget found, or at top of body
    const firstWidget = (
      document.getElementById('sratix-tickets-widget') ||
      document.getElementById('sratix-my-tickets-widget')
    );
    if (firstWidget) {
      firstWidget.parentNode.insertBefore(banner, firstWidget);
    } else {
      document.body.insertBefore(banner, document.body.firstChild);
    }

    // Remove success params from URL without a page reload
    const url = new URL(window.location.href);
    url.searchParams.delete('sratix_success');
    url.searchParams.delete('sratix_order');
    window.history.replaceState(null, '', url.toString());
  }

  // ─── My Tickets widget ────────────────────────────────────────────────────────

  async function initMyTicketsWidget() {
    const container = document.getElementById('sratix-my-tickets-widget');
    if (!container) return;

    if (!config.userEmail) {
      // The PHP shortcode already renders a styled auth prompt with login/register
      // buttons. If somehow the container exists but user isn't logged in, show the
      // JS-side fallback (shouldn't normally happen since PHP gates first).
      if (!container.querySelector('.sratix-auth-prompt')) {
        container.innerHTML = `<p class="sratix-info">${escHtml(t('myTickets.login'))}</p>`;
      }
      return;
    }

    container.innerHTML = `<p class="sratix-info">${escHtml(t('myTickets.loading'))}</p>`;

    try {
      const authRes = await apiFetch('auth/wp-exchange', {
        method: 'POST',
        body: JSON.stringify({
          hmacToken: config.wpHmacToken,
          wpUserId: config.wpUserId,
          email: config.userEmail,
        }),
      });

      const tickets = await apiFetch(
        `tickets?eventId=${EVENT_ID}&attendeeEmail=${encodeURIComponent(config.userEmail)}`,
        { headers: { Authorization: `Bearer ${authRes.accessToken}` } },
      );

      if (!tickets || tickets.length === 0) {
        container.innerHTML = `<p class="sratix-info">${escHtml(t('myTickets.empty'))}</p>`;
        return;
      }

      container.innerHTML = `<div class="sratix-my-tickets">${tickets.map(renderTicketRow).join('')}</div>`;
    } catch (err) {
      console.error('[SRAtix] Failed to load tickets:', err);
      container.innerHTML = `<p class="sratix-error">${escHtml(t('myTickets.loadError'))}</p>`;
    }
  }

  function renderTicketRow(ticket) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(ticket.code)}&size=150x150&format=svg`;
    const statusClass =
      ticket.status === 'valid'       ? 'sratix-badge--valid' :
      ticket.status === 'checked_in'  ? 'sratix-badge--used'  :
                                        'sratix-badge--voided';
    return `<div class="sratix-ticket-row">
      <img class="sratix-qr" src="${qrUrl}" alt="Ticket QR code" loading="lazy" width="100" height="100" />
      <div class="sratix-ticket-info">
        <div class="sratix-ticket-name">${escHtml(ticket.ticketType?.name ?? t('myTickets.ticket'))}</div>
        <div class="sratix-ticket-code">${escHtml(ticket.code)}</div>
        <span class="sratix-badge ${statusClass}">${escHtml(ticket.status.replace('_', ' '))}</span>
      </div>
    </div>`;
  }

  // ─── Schedule widget (v1: from Event.meta.schedule) ──────────────────────────

  async function initScheduleWidget() {
    const container = document.getElementById('sratix-schedule-widget');
    if (!container) return;

    try {
      const event = await apiFetch(`events/${EVENT_ID}/public`);
      const schedule = event && event.meta && Array.isArray(event.meta.schedule)
        ? event.meta.schedule
        : null;

      if (!schedule || schedule.length === 0) {
        container.innerHTML = `<p class="sratix-info">${escHtml(t('schedule.comingSoon'))}</p>`;
        return;
      }
      container.innerHTML = renderSchedule(schedule);
    } catch {
      container.innerHTML = `<p class="sratix-info">${escHtml(t('schedule.comingSoon'))}</p>`;
    }
  }

  function renderSchedule(items) {
    // Group by date
    const days = {};
    items.forEach((item) => {
      const day = item.date || 'TBD';
      if (!days[day]) days[day] = [];
      days[day].push(item);
    });
    return Object.entries(days).map(([day, sessions]) => `
      <div class="sratix-schedule-day">
        <h4 class="sratix-schedule-date">${escHtml(day)}</h4>
        <div class="sratix-schedule-sessions">
          ${sessions.map((s) => `<div class="sratix-session">
            ${s.time ? `<span class="sratix-session-time">${escHtml(s.time)}</span>` : ''}
            <div class="sratix-session-body">
              <strong>${escHtml(s.title)}</strong>
              ${s.speaker ? `<div class="sratix-session-speaker">${escHtml(s.speaker)}</div>` : ''}
              ${s.room    ? `<div class="sratix-session-room">${escHtml(s.room)}</div>`       : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
    `).join('');
  }

  // ─── Modal helpers ────────────────────────────────────────────────────────────

  function createModalShell(id) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'sratix-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    return overlay;
  }

  function closeModal() {
    const existing = document.querySelector('.sratix-modal');
    if (existing) existing.remove();
  }

  function buildSuccessUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('sratix_success', '1');
    return url.toString();
  }

  // ─── Utility ─────────────────────────────────────────────────────────────────

  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  function escAttr(str) {
    return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatPrice(cents, currency) {
    return `${currency ?? 'CHF'} ${(cents / 100).toFixed(2)}`;
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  function init() {
    if (new URLSearchParams(window.location.search).get('sratix_success') === '1') {
      injectSuccessBanner();
    }
    initTicketsWidget();
    initMyTicketsWidget();
    initScheduleWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
