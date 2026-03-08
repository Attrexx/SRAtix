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

  // ─── Ticket card icons (consistent line-art, 24×24 viewBox) ──────────────────

  const TICKET_ICONS = {
    // Single industrial robotic arm
    industry_small:
      '<path d="M8 22h8M12 22v-6"/>' +
      '<circle cx="12" cy="15.5" r="1"/>' +
      '<path d="M13 14.5 17 10.5"/>' +
      '<circle cx="17.2" cy="10.3" r=".8"/>' +
      '<path d="M17.8 9.5 19.5 7M19.5 7l1.3 1M19.5 7l1-.8"/>',

    // Two robotic arms from shared base
    industry_medium:
      '<path d="M4 22h16M12 22v-4"/>' +
      '<circle cx="12" cy="17.5" r="1"/>' +
      '<path d="M11 16.8 6 12.5"/>' +
      '<circle cx="6" cy="12.5" r=".7"/>' +
      '<path d="M5.5 12 3 9.5M3 9.5l-.5 1.8M3 9.5l-1.5-.2"/>' +
      '<path d="M13 16.8 18 12.5"/>' +
      '<circle cx="18" cy="12.5" r=".7"/>' +
      '<path d="M18.5 12 21 9.5M21 9.5l.5 1.8M21 9.5l1.5-.2"/>',

    // Factory building with chimney and smoke
    industry_large:
      '<path d="M2 22h20"/>' +
      '<rect x="3" y="14" width="6" height="8" rx=".5"/>' +
      '<path d="M9 18l4-4v8"/>' +
      '<rect x="13" y="9" width="8" height="13" rx=".5"/>' +
      '<rect x="16" y="5" width="2.5" height="4"/>' +
      '<path d="M17 5c0-1 .4-2 .7-3M18 5c0-1 .4-2 .7-3"/>',

    // Institutional building with pediment and columns
    academic:
      '<path d="M12 4l9 6H3z"/>' +
      '<path d="M4 10v12M8 10v12M12 10v12M16 10v12M20 10v12"/>' +
      '<path d="M2 22h20"/>',

    // Upward-flying rocket
    startup:
      '<path d="M12 3c-2 3-3 7-3 11h6c0-4-1-8-3-11z"/>' +
      '<circle cx="12" cy="11" r="1"/>' +
      '<path d="M9 16l-2 5h2M15 16l2 5h-2"/>' +
      '<path d="M10.5 21l1.5 1.5 1.5-1.5"/>',

    // Two hands in a handshake with cuffs
    general:
      '<path d="M2 11.5v6M22 11.5v6"/>' +
      '<path d="M2 14.5h5M22 14.5h-5"/>' +
      '<path d="M7 14.5c1.5-2 3-3 5-3s3.5 1 5 3"/>' +
      '<path d="M7 16c1.5-1 3-2 5-2s3.5 1 5 2"/>',

    // Graduation cap with tassel
    student:
      '<path d="M2 10l10-5 10 5-10 5z"/>' +
      '<path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>' +
      '<path d="M20 10v6.5"/>' +
      '<circle cx="20" cy="17" r=".8"/>',

    // Steaming coffee cup
    retired:
      '<path d="M5 21h12"/>' +
      '<path d="M7 21v-6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6"/>' +
      '<path d="M15 16.5h1.5a1.5 1.5 0 0 1 0 3H15"/>' +
      '<path d="M9 14c0-1.5.7-1.5.7-3"/>' +
      '<path d="M11 13.5c0-1.5.7-1.5.7-3"/>' +
      '<path d="M13 14c0-1.5.7-1.5.7-3"/>',

    // Cute robot head with antenna
    individual:
      '<rect x="5" y="8" width="14" height="11" rx="3"/>' +
      '<circle cx="9" cy="13" r="1.5" fill="currentColor"/>' +
      '<circle cx="15" cy="13" r="1.5" fill="currentColor"/>' +
      '<path d="M10 17h4"/>' +
      '<path d="M12 8v-3"/>' +
      '<circle cx="12" cy="4" r="1.2"/>',
  };

  function ticketIconSvg(key) {
    var inner = TICKET_ICONS[key];
    if (!inner) return '';
    return '<svg class="sratix-ticket-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }

  function getTicketIcon(tt) {
    // Explicit icon field takes priority (for future icon picker)
    if (tt.icon && TICKET_ICONS[tt.icon]) return ticketIconSvg(tt.icon);
    // Auto-map from membershipTier
    if (tt.membershipTier && TICKET_ICONS[tt.membershipTier]) return ticketIconSvg(tt.membershipTier);
    return '';
  }

  // ─── Member session helpers ──────────────────────────────────────────────────

  const MEMBER_SESSION_KEY = 'sratix_member_session';

  function getMemberSession() {
    try {
      const raw = sessionStorage.getItem(MEMBER_SESSION_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.eventId !== EVENT_ID) { sessionStorage.removeItem(MEMBER_SESSION_KEY); return null; }
      return data;
    } catch { return null; }
  }

  function setMemberSession(data) {
    sessionStorage.setItem(MEMBER_SESSION_KEY, JSON.stringify({ ...data, eventId: EVENT_ID }));
  }

  function clearMemberSession() {
    sessionStorage.removeItem(MEMBER_SESSION_KEY);
  }

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

    // Check for existing member session
    const session = getMemberSession();
    if (session && session.memberGroup) {
      // Already authenticated — show tickets with member pricing
      return loadAndRenderTickets(container, eventId, layout, session);
    }

    // Show member gate if enabled and no session yet
    if (config.memberGateEnabled) {
      renderMemberGate(container, eventId, layout);
      return;
    }

    // No gate — regular flow
    loadAndRenderTickets(container, eventId, layout, null);
  }

  async function loadAndRenderTickets(container, eventId, layout, memberSession) {
    try {
      let endpoint = `events/${eventId}/ticket-types/public`;
      const headers = {};
      if (memberSession && memberSession.sessionToken) {
        const params = new URLSearchParams();
        params.set('memberGroup', memberSession.memberGroup);
        if (memberSession.tier) params.set('memberTier', memberSession.tier);
        endpoint += '?' + params.toString();
        headers['Authorization'] = 'Bearer ' + memberSession.sessionToken;
      }
      const ticketTypes = await apiFetch(endpoint, { headers });
      if (!ticketTypes || ticketTypes.length === 0) {
        container.innerHTML = `<p class="sratix-info">${escHtml(t('tickets.noTickets'))}</p>`;
        return;
      }
      let html = '';
      if (memberSession && memberSession.memberGroup && memberSession.memberGroup !== 'none') {
        html += renderWelcomeBanner(memberSession, ticketTypes);
      } else if (config.memberGateEnabled) {
        html += `<a href="#" data-action="change-member" class="sratix-back-to-gate">&larr; ${escHtml(t('memberGate.backToMembership'))}</a>`;
      }
      html += renderTicketCards(ticketTypes, layout, memberSession);
      container.innerHTML = html;
      bindSelectButtons(container, eventId, ticketTypes);
      // Bind "change member type" link
      const changeBtn = container.querySelector('[data-action="change-member"]');
      if (changeBtn) {
        changeBtn.addEventListener('click', function (e) {
          e.preventDefault();
          clearMemberSession();
          initTicketsWidget();
        });
      }
    } catch (err) {
      console.error('[SRAtix] Failed to load tickets:', err);
      // If member session expired, clear and retry without it
      if (memberSession && err.message && err.message.includes('401')) {
        clearMemberSession();
        loadAndRenderTickets(container, eventId, layout, null);
        return;
      }
      container.innerHTML = `<p class="sratix-error">${escHtml(t('tickets.loadError'))}</p>`;
    }
  }

  function renderWelcomeBanner(session, ticketTypes) {
    const isSra = session.memberGroup === 'sra';
    const isRobotx = session.memberGroup === 'robotx';

    // Logo
    const logoUrl = isSra ? config.sraLogoUrl : (isRobotx ? config.robotxLogoUrl : null);
    const logoHtml = logoUrl
      ? `<img src="${escAttr(logoUrl)}" alt="" class="sratix-welcome-logo" />`
      : '';

    // Greeting line
    let greeting = '';
    if (isSra && session.firstName) {
      greeting = t('memberGate.welcomeGreeting', { name: '<strong>' + escHtml(session.firstName) + '</strong>' });
    } else if (isRobotx) {
      greeting = escHtml(t('memberGate.welcomeRobotxGreeting'));
    }

    // Tier label (SRA only)
    let tierHtml = '';
    if (isSra && session.tier) {
      const tierLabel = session.tier.replace(/_/g, ' ');
      tierHtml = `<span class="sratix-welcome-tier">${escHtml(t('memberGate.welcomeTier', { tier: tierLabel }))}</span>`;
    }

    // Discount info — find the first ticket with a memberDiscount to show the entitled discount
    let discountHtml = '';
    if (ticketTypes && ticketTypes.length > 0) {
      const withDiscount = ticketTypes.find(function (tt) { return tt.memberDiscount && tt.memberDiscount.discountCents > 0; });
      if (withDiscount) {
        discountHtml = `<span class="sratix-welcome-discount">${escHtml(withDiscount.memberDiscount.discountLabel)}</span>`;
      }
    }

    // Disclaimer (only if there is a discount entitlement)
    const disclaimerHtml = discountHtml
      ? `<p class="sratix-welcome-disclaimer">${escHtml(t('memberGate.welcomeDisclaimer'))}</p>`
      : '';

    // For RobotX: discount pill goes inline with greeting; for SRA: in meta row
    const metaHtml = isSra ? `<div class="sratix-welcome-meta">${tierHtml}${discountHtml}</div>` : '';
    const inlineDiscount = isRobotx && discountHtml ? ' ' + discountHtml : '';

    return `<div class="sratix-welcome-banner">
      <div class="sratix-welcome-left">
        ${logoHtml}
        <div class="sratix-welcome-info">
          <span class="sratix-welcome-text">${greeting}${inlineDiscount}</span>
          ${metaHtml}
          ${disclaimerHtml}
        </div>
      </div>
      <a href="#" data-action="change-member" class="sratix-welcome-change">${escHtml(t('memberGate.changeType'))}</a>
    </div>`;
  }

  // ─── Member gate screen ──────────────────────────────────────────────────────

  function renderMemberGate(container, eventId, layout) {
    const sraLogo = config.sraLogoUrl
      ? `<img src="${escAttr(config.sraLogoUrl)}" alt="SRA" class="sratix-member-btn__logo" />`
      : '<span class="sratix-member-btn__icon">🔵</span>';
    const robotxLogo = config.robotxLogoUrl
      ? `<img src="${escAttr(config.robotxLogoUrl)}" alt="RobotX" class="sratix-member-btn__logo" />`
      : '<span class="sratix-member-btn__icon">🔴</span>';

    container.innerHTML = `
      <div class="sratix-member-gate">
        <h2 class="sratix-member-gate__title">${escHtml(t('memberGate.title'))}</h2>
        <p class="sratix-member-gate__subtitle">${escHtml(t('memberGate.subtitle'))}</p>
        <div class="sratix-member-gate__buttons">
          <button class="sratix-member-btn sratix-member-btn--sra" data-member="sra">
            ${sraLogo}
            <span class="sratix-member-btn__label">${escHtml(t('memberGate.sraLabel'))}</span>
          </button>
          <button class="sratix-member-btn sratix-member-btn--robotx" data-member="robotx">
            ${robotxLogo}
            <span class="sratix-member-btn__label">${escHtml(t('memberGate.robotxLabel'))}</span>
          </button>
        </div>
        <button class="sratix-member-btn sratix-member-btn--regular" data-member="none">
          ${escHtml(t('memberGate.regularLabel'))}
        </button>
      </div>
    `;

    container.querySelector('[data-member="sra"]').addEventListener('click', function () {
      renderSraLoginForm(container, eventId, layout);
    });
    container.querySelector('[data-member="robotx"]').addEventListener('click', function () {
      renderRobotxCodeForm(container, eventId, layout);
    });
    container.querySelector('[data-member="none"]').addEventListener('click', function () {
      setMemberSession({ memberGroup: 'none' });
      loadAndRenderTickets(container, eventId, layout, null);
    });
  }

  // ─── SRA login form ──────────────────────────────────────────────────────────

  function renderSraLoginForm(container, eventId, layout) {
    const sraLogo = config.sraLogoUrl
      ? `<img src="${escAttr(config.sraLogoUrl)}" alt="SRA" class="sratix-login-form__logo" />`
      : '';

    container.innerHTML = `
      <div class="sratix-login-form">
        <a href="#" class="sratix-login-form__back" id="sratix-gate-back">&larr; ${escHtml(t('memberGate.back'))}</a>
        <div class="sratix-login-form__header">
          ${sraLogo}
          <div>
            <h2 class="sratix-login-form__title">${escHtml(t('memberGate.sraLoginTitle'))}</h2>
            <p class="sratix-login-form__hint">${escHtml(t('memberGate.sraLoginHint'))}</p>
          </div>
        </div>
        <div class="sratix-field">
          <label class="sratix-label" for="sratix-sra-email">${escHtml(t('reg.email'))}</label>
          <input class="sratix-input" id="sratix-sra-email" type="email" autocomplete="email" />
        </div>
        <div class="sratix-field">
          <label class="sratix-label" for="sratix-sra-password">${escHtml(t('memberGate.password'))}</label>
          <input class="sratix-input" id="sratix-sra-password" type="password" autocomplete="current-password" />
        </div>
        <p class="sratix-error-msg" id="sratix-sra-error" style="display:none"></p>
        <button class="sratix-btn sratix-btn--primary sratix-login-form__submit" id="sratix-sra-submit">
          ${escHtml(t('memberGate.sraSubmit'))}
        </button>
      </div>
    `;

    container.querySelector('#sratix-gate-back').addEventListener('click', function (e) {
      e.preventDefault();
      renderMemberGate(container, eventId, layout);
    });

    const submitBtn = container.querySelector('#sratix-sra-submit');
    const errorEl = container.querySelector('#sratix-sra-error');

    submitBtn.addEventListener('click', async function () {
      errorEl.style.display = 'none';
      const email = container.querySelector('#sratix-sra-email').value.trim();
      const password = container.querySelector('#sratix-sra-password').value;

      if (!email || !password) {
        errorEl.textContent = t('memberGate.sraFieldsRequired');
        errorEl.style.display = '';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('reg.pleaseWait');

      try {
        const res = await apiFetch('auth/sra-verify', {
          method: 'POST',
          body: JSON.stringify({ email, password, eventId }),
        });

        if (res.authenticated) {
          setMemberSession({
            memberGroup: 'sra',
            tier: res.membershipTier || null,
            firstName: res.firstName || '',
            lastName: res.lastName || '',
            sessionToken: res.sessionToken,
          });
          loadAndRenderTickets(container, eventId, layout, getMemberSession());
        } else {
          errorEl.textContent = t('memberGate.sraInvalid');
          errorEl.style.display = '';
        }
      } catch (err) {
        errorEl.textContent = err.message || t('memberGate.sraError');
        errorEl.style.display = '';
      }

      submitBtn.disabled = false;
      submitBtn.textContent = t('memberGate.sraSubmit');
    });

    // Allow Enter key to submit
    container.querySelector('#sratix-sra-password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
    });
  }

  // ─── RobotX code entry form ──────────────────────────────────────────────────

  function renderRobotxCodeForm(container, eventId, layout) {
    const robotxLogo = config.robotxLogoUrl
      ? `<img src="${escAttr(config.robotxLogoUrl)}" alt="RobotX" class="sratix-login-form__logo" />`
      : '';

    container.innerHTML = `
      <div class="sratix-login-form">
        <a href="#" class="sratix-login-form__back" id="sratix-gate-back">&larr; ${escHtml(t('memberGate.back'))}</a>
        <div class="sratix-login-form__header">
          ${robotxLogo}
          <div>
            <h2 class="sratix-login-form__title">${escHtml(t('memberGate.robotxTitle'))}</h2>
            <p class="sratix-login-form__hint">${escHtml(t('memberGate.robotxHint'))}</p>
          </div>
        </div>
        <div class="sratix-field">
          <label class="sratix-label" for="sratix-robotx-code">${escHtml(t('memberGate.robotxCodeLabel'))}</label>
          <input class="sratix-input" id="sratix-robotx-code" type="text" autocomplete="off" />
        </div>
        <p class="sratix-error-msg" id="sratix-robotx-error" style="display:none"></p>
        <button class="sratix-btn sratix-btn--primary sratix-login-form__submit" id="sratix-robotx-submit">
          ${escHtml(t('memberGate.robotxSubmit'))}
        </button>
      </div>
    `;

    container.querySelector('#sratix-gate-back').addEventListener('click', function (e) {
      e.preventDefault();
      renderMemberGate(container, eventId, layout);
    });

    const submitBtn = container.querySelector('#sratix-robotx-submit');
    const errorEl = container.querySelector('#sratix-robotx-error');

    submitBtn.addEventListener('click', async function () {
      errorEl.style.display = 'none';
      const code = container.querySelector('#sratix-robotx-code').value.trim();

      if (!code) {
        errorEl.textContent = t('memberGate.robotxFieldRequired');
        errorEl.style.display = '';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('reg.pleaseWait');

      try {
        const res = await apiFetch('auth/robotx-verify', {
          method: 'POST',
          body: JSON.stringify({ eventId, code }),
        });

        if (res.valid) {
          setMemberSession({
            memberGroup: 'robotx',
            sessionToken: res.sessionToken,
          });
          loadAndRenderTickets(container, eventId, layout, getMemberSession());
        } else {
          errorEl.textContent = t('memberGate.robotxInvalid');
          errorEl.style.display = '';
        }
      } catch (err) {
        errorEl.textContent = err.message || t('memberGate.robotxError');
        errorEl.style.display = '';
      }

      submitBtn.disabled = false;
      submitBtn.textContent = t('memberGate.robotxSubmit');
    });

    container.querySelector('#sratix-robotx-code').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
    });
  }

  function renderTicketCards(types, layout, memberSession) {
    const cls = layout === 'list' ? 'sratix-list' : 'sratix-cards';
    return `<div class="${cls}">${types.map(function (tt) { return renderCard(tt, memberSession); }).join('')}</div>`;
  }

  function renderCard(tt, memberSession) {
    const soldOut = tt.soldOut || (tt.available !== null && tt.available <= 0);

    const hasEarlyBird = tt.priceLabel && tt.basePriceCents != null && tt.basePriceCents > tt.priceCents;

    let priceHtml;
    if (tt.priceCents === 0) {
      priceHtml = `<span class="sratix-price-free">${escHtml(t('tickets.free'))}</span>`;
    } else if (memberSession && tt.memberDiscount && tt.memberDiscount.discountCents > 0) {
      const memberPriceCents = Math.max(0, tt.priceCents - tt.memberDiscount.discountCents);
      const strikePrice = hasEarlyBird ? tt.basePriceCents : tt.priceCents;
      priceHtml = `<div class="sratix-price-wrap">
        <span class="sratix-price-member">${formatPrice(memberPriceCents, tt.currency)}</span>
        <span class="sratix-price-original">${formatPrice(strikePrice, tt.currency)}</span>
        <span class="sratix-savings-badge">${escHtml(tt.memberDiscount.discountLabel)}</span>
      </div>`;
    } else if (hasEarlyBird) {
      priceHtml = `<div class="sratix-price-wrap">
        <span class="sratix-price-early">${formatPrice(tt.priceCents, tt.currency)}</span>
        <span class="sratix-price-original">${formatPrice(tt.basePriceCents, tt.currency)}</span>
        <span class="sratix-early-badge">${escHtml(t('tickets.earlyBird'))}</span>
      </div>`;
    } else {
      priceHtml = `<div class="sratix-price">${formatPrice(tt.priceCents, tt.currency)}</div>`;
    }
    const availHtml = tt.available !== null && !soldOut
      ? `<span class="sratix-avail">${escHtml(t('tickets.remaining', { n: tt.available }))}</span>`
      : '';
    const btn = soldOut
      ? `<span class="sratix-badge sratix-badge--sold-out">${escHtml(t('tickets.soldOut'))}</span>`
      : `<button class="sratix-btn sratix-btn--primary" data-action="select" data-ticket-type-id="${escAttr(tt.id)}">${escHtml(t('tickets.select'))}</button>`;

    const iconHtml = getTicketIcon(tt);

    return `<div class="sratix-ticket-card" data-ticket-type-id="${escAttr(tt.id)}">
      ${iconHtml}
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

  // ─── Conditions engine (client-side — mirrors Server/src/common/conditions.ts) ─

  function evalConditions(conditions, answers) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every(function (rule) {
      var actual = answers[rule.field];
      switch (rule.operator) {
        case 'eq':   return looseEq(actual, rule.value);
        case 'neq':  return !looseEq(actual, rule.value);
        case 'not_empty': return !isEmptyVal(actual);
        case 'empty':     return isEmptyVal(actual);
        case 'contains':
          if (Array.isArray(actual)) return actual.indexOf(rule.value) !== -1;
          if (typeof actual === 'string' && typeof rule.value === 'string')
            return actual.toLowerCase().indexOf(rule.value.toLowerCase()) !== -1;
          return false;
        case 'in':
          if (!Array.isArray(rule.value)) return false;
          if (Array.isArray(actual)) return actual.some(function (v) { return rule.value.indexOf(v) !== -1; });
          return rule.value.indexOf(actual) !== -1;
        default: return true;
      }
    });
  }
  function looseEq(a, b) {
    if (a === b) return true;
    if (typeof a === 'boolean' && typeof b === 'string') return a === (b === 'true');
    if (typeof b === 'boolean' && typeof a === 'string') return b === (a === 'true');
    if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
    if (typeof b === 'number' && typeof a === 'string') return b === Number(a);
    return false;
  }
  function isEmptyVal(v) {
    if (v === null || v === undefined || v === '' || v === false) return true;
    return Array.isArray(v) && v.length === 0;
  }

  // ─── Dynamic form field rendering ──────────────────────────────────────────────

  /**
   * Resolve a localised label object to a string.
   * @param {Object|string} label  e.g. { en: 'Name', de: 'Name' } or plain string
   * @returns {string}
   */
  function resolveLabel(label) {
    if (!label) return '';
    if (typeof label === 'string') return label;
    var locale = (typeof sratixI18n !== 'undefined') ? sratixI18n.getLocale() : 'en';
    return label[locale] || label.en || label[Object.keys(label)[0]] || '';
  }

  /**
   * Render a single form field to an HTML string.
   * @param {Object} field  A FormField from the schema
   * @returns {string}
   */
  function renderFormField(field) {
    var label = resolveLabel(field.label);
    var ph = resolveLabel(field.placeholder) || '';
    var help = resolveLabel(field.helpText) || '';
    var req = field.required ? ' <span class="sratix-req">*</span>' : '';
    var id = 'sratix-df-' + field.id;
    var html = '';

    switch (field.type) {
      case 'text':
      case 'url':
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="' + (field.type === 'url' ? 'url' : 'text') + '" placeholder="' + escAttr(ph) + '" data-field-id="' + escAttr(field.id) + '" />';
        break;
      case 'email':
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="email" placeholder="' + escAttr(ph) + '" autocomplete="email" data-field-id="' + escAttr(field.id) + '" />';
        break;
      case 'phone':
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="tel" placeholder="' + escAttr(ph) + '" autocomplete="tel" data-field-id="' + escAttr(field.id) + '" />';
        break;
      case 'number':
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="number" placeholder="' + escAttr(ph) + '" data-field-id="' + escAttr(field.id) + '" />';
        break;
      case 'date':
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="date" data-field-id="' + escAttr(field.id) + '" />';
        break;
      case 'textarea':
        html = '<textarea class="sratix-input" id="' + escAttr(id) + '" rows="3" placeholder="' + escAttr(ph) + '" data-field-id="' + escAttr(field.id) + '"></textarea>';
        break;
      case 'select':
      case 'country':
      case 'canton':
        var opts = '<option value="">' + escHtml(ph || t('reg.form.selectPlaceholder')) + '</option>';
        (field.options || []).forEach(function (o) {
          opts += '<option value="' + escAttr(o.value) + '">' + escHtml(resolveLabel(o.label)) + '</option>';
        });
        html = '<select class="sratix-input" id="' + escAttr(id) + '" data-field-id="' + escAttr(field.id) + '">' + opts + '</select>';
        break;
      case 'multi-select':
        var mOpts = '';
        (field.options || []).forEach(function (o) {
          mOpts += '<option value="' + escAttr(o.value) + '">' + escHtml(resolveLabel(o.label)) + '</option>';
        });
        html = '<select class="sratix-input" id="' + escAttr(id) + '" multiple data-field-id="' + escAttr(field.id) + '">' + mOpts + '</select>';
        break;
      case 'radio':
        html = '<div class="sratix-radio-group" data-field-id="' + escAttr(field.id) + '">';
        (field.options || []).forEach(function (o, idx) {
          var rid = id + '-' + idx;
          html += '<label class="sratix-radio-label"><input type="radio" name="' + escAttr(id) + '" value="' + escAttr(o.value) + '" id="' + escAttr(rid) + '" /> ' + escHtml(resolveLabel(o.label)) + '</label>';
        });
        html += '</div>';
        break;
      case 'checkbox':
        html = '<div class="sratix-checkbox-group" data-field-id="' + escAttr(field.id) + '">';
        if (field.options && field.options.length > 0) {
          field.options.forEach(function (o, idx) {
            var cid = id + '-' + idx;
            html += '<label class="sratix-checkbox-label"><input type="checkbox" name="' + escAttr(id) + '" value="' + escAttr(o.value) + '" id="' + escAttr(cid) + '" /> ' + escHtml(resolveLabel(o.label)) + '</label>';
          });
        } else {
          html += '<label class="sratix-checkbox-label"><input type="checkbox" id="' + escAttr(id) + '" data-field-id="' + escAttr(field.id) + '" /> ' + escHtml(label) + '</label>';
        }
        html += '</div>';
        break;
      case 'yes-no':
        html = '<div class="sratix-yesno-group" data-field-id="' + escAttr(field.id) + '">';
        html += '<label class="sratix-radio-label"><input type="radio" name="' + escAttr(id) + '" value="yes" /> ' + escHtml(t('reg.form.yes')) + '</label>';
        html += '<label class="sratix-radio-label"><input type="radio" name="' + escAttr(id) + '" value="no" /> ' + escHtml(t('reg.form.no')) + '</label>';
        html += '</div>';
        break;
      case 'consent':
        html = '<label class="sratix-checkbox-label"><input type="checkbox" id="' + escAttr(id) + '" data-field-id="' + escAttr(field.id) + '" /> ' + escHtml(label) + req + '</label>';
        // Consent renders label inline; clear req so it isn't duplicated above
        req = '';
        break;
      case 'image-upload':
      case 'file':
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="file" data-field-id="' + escAttr(field.id) + '" />';
        break;
      case 'group':
        // Section headers rendered as divider
        html = '<hr class="sratix-section-divider" />';
        break;
      default:
        html = '<input class="sratix-input" id="' + escAttr(id) + '" type="text" placeholder="' + escAttr(ph) + '" data-field-id="' + escAttr(field.id) + '" />';
    }

    var helpHtml = help ? '<p class="sratix-field-help">' + escHtml(help) + '</p>' : '';

    // For consent type, label is already inline
    if (field.type === 'consent') {
      return '<div class="sratix-field sratix-df" data-df-id="' + escAttr(field.id) + '">' + html + helpHtml + '</div>';
    }

    return '<div class="sratix-field sratix-df" data-df-id="' + escAttr(field.id) + '">'
      + '<label class="sratix-label" for="' + escAttr(id) + '">' + escHtml(label) + req + '</label>'
      + html + helpHtml
      + '</div>';
  }

  /**
   * Read all dynamic field values from the modal DOM.
   * @param {HTMLElement} form  The form element
   * @param {Array} fields      Schema fields
   * @param {Object} answers    Current answers (for condition evaluation)
   * @returns {Object} answers map keyed by field.id
   */
  function collectDynamicAnswers(form, fields, answers) {
    var result = {};
    fields.forEach(function (field) {
      if (field.type === 'group') return;
      // Skip conditionally hidden fields
      if (field.conditions && field.conditions.length > 0 && !evalConditions(field.conditions, answers)) return;

      var id = 'sratix-df-' + field.id;
      var el;

      switch (field.type) {
        case 'multi-select':
          el = form.querySelector('#' + CSS.escape(id));
          if (el) {
            result[field.id] = Array.from(el.selectedOptions).map(function (o) { return o.value; });
          }
          break;
        case 'radio':
        case 'yes-no':
          el = form.querySelector('input[name="' + CSS.escape(id) + '"]:checked');
          result[field.id] = el ? el.value : '';
          break;
        case 'checkbox':
          if (field.options && field.options.length > 0) {
            var checked = form.querySelectorAll('input[name="' + CSS.escape(id) + '"]:checked');
            result[field.id] = Array.from(checked).map(function (c) { return c.value; });
          } else {
            el = form.querySelector('#' + CSS.escape(id));
            result[field.id] = el ? el.checked : false;
          }
          break;
        case 'consent':
          el = form.querySelector('#' + CSS.escape(id));
          result[field.id] = el && el.checked
            ? { granted: true, timestamp: new Date().toISOString() }
            : { granted: false, timestamp: new Date().toISOString() };
          break;
        case 'number':
          el = form.querySelector('#' + CSS.escape(id));
          result[field.id] = el && el.value !== '' ? Number(el.value) : '';
          break;
        case 'file':
        case 'image-upload':
          // File uploads not supported in public widget — skip
          break;
        default:
          el = form.querySelector('#' + CSS.escape(id));
          result[field.id] = el ? (el.value || '').trim() : '';
      }
    });
    return result;
  }

  /**
   * Apply condition-based visibility to dynamic fields.
   * @param {HTMLElement} form
   * @param {Array} fields
   * @param {Object} answers
   */
  function applyConditionVisibility(form, fields, answers) {
    fields.forEach(function (field) {
      if (!field.conditions || field.conditions.length === 0) return;
      var wrap = form.querySelector('[data-df-id="' + CSS.escape(field.id) + '"]');
      if (!wrap) return;
      var visible = evalConditions(field.conditions, answers);
      wrap.style.display = visible ? '' : 'none';
    });
  }

  // ─── Registration modal (Stage B) ────────────────────────────────────────────

  async function openRegistrationModal(eventId, tt, qty, promoCode, discountCents) {
    var subtotal  = tt.priceCents * qty;
    var finalPrice = Math.max(0, subtotal - discountCents);
    var modal = createModalShell('sratix-modal-reg');

    var submitLabel = tt.priceCents === 0 ? t('reg.completeRegistration') : t('reg.continueToPayment');

    // ── Fetch form schema if ticket type has one ──
    var schema = null;
    var schemaFields = null;
    if (tt.formSchemaId) {
      try {
        schema = await apiFetch(
          'public/forms/ticket-type/' + encodeURIComponent(tt.id)
          + '/event/' + encodeURIComponent(eventId),
        );
        if (schema && schema.fields && schema.fields.fields) {
          schemaFields = schema.fields.fields;
        }
      } catch (err) {
        console.warn('[SRAtix] Could not load form schema, using default form:', err);
      }
    }

    var useCustomForm = !!(schemaFields && schemaFields.length > 0);

    // ── Build form body ──
    var formBodyHtml;
    if (useCustomForm) {
      // Sort by order if present
      var sorted = schemaFields.slice().sort(function (a, b) {
        return (a.order || 0) - (b.order || 0);
      });
      formBodyHtml = sorted.map(renderFormField).join('');
    } else {
      // Default 5-field form (backward compatible)
      formBodyHtml = ''
        + '<div class="sratix-field-row">'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-first-name">' + escHtml(t('reg.firstName')) + ' <span class="sratix-req">*</span></label>'
        +     '<input class="sratix-input" id="sratix-first-name" type="text" autocomplete="given-name" required />'
        +   '</div>'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-last-name">' + escHtml(t('reg.lastName')) + ' <span class="sratix-req">*</span></label>'
        +     '<input class="sratix-input" id="sratix-last-name" type="text" autocomplete="family-name" required />'
        +   '</div>'
        + '</div>'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-email">' + escHtml(t('reg.email')) + ' <span class="sratix-req">*</span></label>'
        +   '<input class="sratix-input" id="sratix-email" type="email" autocomplete="email" required />'
        + '</div>'
        + '<div class="sratix-field-row">'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-phone">' + escHtml(t('reg.phone')) + '</label>'
        +     '<input class="sratix-input" id="sratix-phone" type="tel" autocomplete="tel" />'
        +   '</div>'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-company">' + escHtml(t('reg.organization')) + '</label>'
        +     '<input class="sratix-input" id="sratix-company" type="text" autocomplete="organization" />'
        +   '</div>'
        + '</div>';
    }

    modal.innerHTML = ''
      + '<div class="sratix-modal-box">'
      +   '<button class="sratix-modal-close" aria-label="' + escAttr(t('modal.close')) + '">&times;</button>'
      +   '<h2 class="sratix-modal-title">' + escHtml(t('reg.title')) + '</h2>'
      +   '<p class="sratix-modal-subtitle">'
      +     escHtml(tt.name) + ' &times; ' + qty + ' — '
      +     '<strong>' + (tt.priceCents === 0 ? escHtml(t('tickets.free')) : formatPrice(finalPrice, tt.currency)) + '</strong>'
      +   '</p>'
      +   '<div class="sratix-modal-body">'
      +     '<form id="sratix-reg-form" novalidate>'
      +       formBodyHtml
      +       '<p class="sratix-error-msg" id="sratix-reg-error" style="display:none"></p>'
      +     '</form>'
      +   '</div>'
      +   '<div class="sratix-modal-footer">'
      +     '<button class="sratix-btn sratix-btn--ghost" id="sratix-reg-back">' + escHtml(t('reg.back')) + '</button>'
      +     '<button class="sratix-btn sratix-btn--primary" id="sratix-reg-submit">' + escHtml(submitLabel) + '</button>'
      +   '</div>'
      + '</div>';

    document.body.appendChild(modal);

    var formEl = modal.querySelector('#sratix-reg-form');

    // ── Pre-fill from WP user context ──
    if (!useCustomForm) {
      if (config.userEmail)     modal.querySelector('#sratix-email').value     = config.userEmail;
      if (config.userFirstName) modal.querySelector('#sratix-first-name').value = config.userFirstName;
      if (config.userLastName)  modal.querySelector('#sratix-last-name').value  = config.userLastName;
    } else {
      // Pre-fill well-known dynamic field IDs if present
      var prefillMap = {
        'email': config.userEmail, 'first_name': config.userFirstName,
        'last_name': config.userLastName, 'firstName': config.userFirstName,
        'lastName': config.userLastName,
      };
      Object.keys(prefillMap).forEach(function (fid) {
        if (!prefillMap[fid]) return;
        var el = formEl.querySelector('#sratix-df-' + CSS.escape(fid));
        if (el) el.value = prefillMap[fid];
      });

      // Wire up condition-based live visibility
      if (schemaFields.some(function (f) { return f.conditions && f.conditions.length > 0; })) {
        formEl.addEventListener('input', function () {
          var snap = collectDynamicAnswers(formEl, schemaFields, {});
          applyConditionVisibility(formEl, schemaFields, snap);
        });
        formEl.addEventListener('change', function () {
          var snap = collectDynamicAnswers(formEl, schemaFields, {});
          applyConditionVisibility(formEl, schemaFields, snap);
        });
        // Initial pass
        var initSnap = collectDynamicAnswers(formEl, schemaFields, {});
        applyConditionVisibility(formEl, schemaFields, initSnap);
      }
    }

    modal.querySelector('.sratix-modal-close').addEventListener('click', closeModal);
    modal.querySelector('#sratix-reg-back').addEventListener('click', function () {
      closeModal();
      openQuantityModal(eventId, tt);
    });
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

    var submitBtn = modal.querySelector('#sratix-reg-submit');
    var errorEl   = modal.querySelector('#sratix-reg-error');

    submitBtn.addEventListener('click', async function () {
      errorEl.style.display = 'none';

      var firstName, lastName, email, phone, company;
      var formData = null;

      if (useCustomForm) {
        // Collect all dynamic answers (first pass without condition context, then with)
        var rawAnswers = collectDynamicAnswers(formEl, schemaFields, {});
        var answers = collectDynamicAnswers(formEl, schemaFields, rawAnswers);

        // Extract core attendee data from well-known field IDs
        firstName = answers.first_name || answers.firstName || '';
        lastName  = answers.last_name  || answers.lastName  || '';
        email     = answers.email      || '';
        phone     = answers.phone      || '';
        company   = answers.company    || answers.organization || '';

        // Validate required fields from schema
        for (var i = 0; i < schemaFields.length; i++) {
          var f = schemaFields[i];
          if (f.type === 'group') continue;
          if (f.conditions && f.conditions.length > 0 && !evalConditions(f.conditions, answers)) continue;
          if (f.required) {
            var val = answers[f.id];
            if (val === undefined || val === null || val === ''
              || (Array.isArray(val) && val.length === 0)
              || (f.type === 'consent' && val && !val.granted)) {
              errorEl.textContent = t('reg.form.fieldRequired', { field: resolveLabel(f.label) });
              errorEl.style.display = '';
              return;
            }
          }
        }

        // Build formData (all answers except the 5 core attendee fields)
        var coreIds = ['first_name', 'firstName', 'last_name', 'lastName', 'email', 'phone', 'company', 'organization'];
        formData = {};
        Object.keys(answers).forEach(function (k) {
          if (coreIds.indexOf(k) === -1) {
            formData[k] = answers[k];
          }
        });
      } else {
        // Default form
        firstName = modal.querySelector('#sratix-first-name').value.trim();
        lastName  = modal.querySelector('#sratix-last-name').value.trim();
        email     = modal.querySelector('#sratix-email').value.trim();
        phone     = modal.querySelector('#sratix-phone').value.trim();
        company   = modal.querySelector('#sratix-company').value.trim();
      }

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
        var successUrl = buildSuccessUrl();
        var payload = {
          eventId: eventId,
          ticketTypeId: tt.id,
          quantity: qty,
          attendeeData: {
            email: email,
            firstName: firstName,
            lastName: lastName,
            phone: phone || undefined,
            company: company || undefined,
          },
          promoCode: promoCode || undefined,
          successUrl: successUrl,
          cancelUrl: window.location.href,
        };
        // Include custom form data when using a schema
        if (useCustomForm && schema && formData && Object.keys(formData).length > 0) {
          payload.formSchemaId = schema.id;
          payload.formData = formData;
        }

        // Include member context for discount validation
        var memberSess = getMemberSession();
        if (memberSess && memberSess.memberGroup && memberSess.memberGroup !== 'none') {
          payload.memberGroup = memberSess.memberGroup;
          if (memberSess.tier) payload.memberTier = memberSess.tier;
          if (memberSess.sessionToken) payload.memberSessionToken = memberSess.sessionToken;
        }

        var result = await apiFetch('payments/checkout/public', {
          method: 'POST',
          body: JSON.stringify(payload),
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
    const isTestMode  = params.get('sratix_test') === '1';

    const banner = document.createElement('div');
    banner.className = 'sratix-success-banner' + (isTestMode ? ' sratix-success-banner--test' : '');
    banner.setAttribute('role', 'status');

    if (isTestMode) {
      // Test mode banner — show what happened + simulated actions placeholder
      banner.innerHTML = `
        <span class="sratix-success-icon sratix-success-icon--test">⚙</span>
        <div class="sratix-success-text">
          <strong>${escHtml(t('success.testTitle'))}</strong>
          ${orderNumber ? `<span> — ${escHtml(t('success.order', { number: orderNumber }))}</span>` : ''}
          <br>${escHtml(t('success.testDone'))}
          <div class="sratix-test-actions" id="sratix-test-actions">
            <em>${escHtml(t('success.testLoading'))}</em>
          </div>
        </div>
        <button class="sratix-success-close" aria-label="${escAttr(t('success.dismiss'))}">&times;</button>
      `;
    } else {
      // Normal success banner
      banner.innerHTML = `
        <span class="sratix-success-icon">✓</span>
        <div class="sratix-success-text">
          <strong>${escHtml(t('success.title'))}</strong>
          ${orderNumber ? `<span> — ${escHtml(t('success.order', { number: orderNumber }))}</span>` : ''}
          <br>${escHtml(t('success.checkEmail'))}
        </div>
        <button class="sratix-success-close" aria-label="${escAttr(t('success.dismiss'))}">&times;</button>
      `;
    }

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

    // Fetch and render simulated actions for test mode
    if (isTestMode && orderNumber) {
      fetchTestActions(orderNumber);
    }

    // Remove success params from URL without a page reload
    const url = new URL(window.location.href);
    url.searchParams.delete('sratix_success');
    url.searchParams.delete('sratix_order');
    url.searchParams.delete('sratix_test');
    window.history.replaceState(null, '', url.toString());
  }

  /**
   * Fetch simulated actions from the server and render them in the test banner.
   */
  async function fetchTestActions(orderNumber) {
    const container = document.getElementById('sratix-test-actions');
    if (!container) return;

    try {
      const data = await apiFetch(`payments/checkout/public/test-actions/${encodeURIComponent(orderNumber)}`);
      const actions = data.simulatedActions || [];

      if (!actions.length) {
        container.innerHTML = `<em>${escHtml(t('success.testNoActions'))}</em>`;
        return;
      }

      // Group actions by attendee/action for readability
      let html = `<p class="sratix-test-actions-heading">${escHtml(t('success.testActionsHeading'))}</p>`;
      html += '<ul class="sratix-test-actions-list">';
      for (const item of actions) {
        html += `<li>
          <strong>${escHtml(item.action)}</strong>
          <span>${escHtml(item.description)}</span>
          ${item.detail ? `<code>${escHtml(item.detail)}</code>` : ''}
        </li>`;
      }
      html += '</ul>';
      container.innerHTML = html;
    } catch (err) {
      console.warn('[SRAtix] Failed to load test actions:', err);
      container.innerHTML = `<em>${escHtml(t('success.testLoadError'))}</em>`;
    }
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
