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

  // ─── Ticket card icons (self-contained SVG with per-icon viewBox) ─────────────

  const TICKET_ICONS = {
    // Robot with conveyor belt (robot-two)
    industry_small: {
      viewBox: '0 0 48 48',
      inner: '<g fill="none" stroke="currentColor" stroke-width="4">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M5 35a2 2 0 0 1 2-2h34a2 2 0 0 1 2 2v7H5v-7Zm37-17h-8l-6-6l6-6h8"/>' +
        '<circle cx="8" cy="12" r="4"/>' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M12 12h16m-18 4l8 17"/>' +
        '</g>',
    },

    // Factory with industrial robot arm
    industry_medium: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' +
        '<path d="m9.25 18.876l-6.512-4.682m3.002-2.673l5.143 3.813M.751 11.751a2.5 2.5 0 1 0 5 0a2.5 2.5 0 0 0-5 0m4.886-.746l5.611-5.465m-.856-3.962L1.257 10.25m8.492-7a2.5 2.5 0 1 0 5 0a2.5 2.5 0 0 0-5 0m6.545 4.132l-2.3-2.35m1.756 3.719a2 2 0 1 0 4 0a2 2 0 0 0-4 0"/>' +
        '<path d="M19.7 8.3a3 3 0 0 1 3.55 2.951m-3 3A3 3 0 0 1 17.3 10.7M1 23.251h22m-13.75 0V18a3 3 0 0 1 6 0v5.25"/>' +
        '</g>',
    },

    // AI science robot (atom orbits + robot head)
    industry_large: {
      viewBox: '0 0 48 48',
      inner: '<g fill="none" stroke="currentColor" stroke-width="3">' +
        '<path d="M44.829 17.336c-.128 1.718-1.396 3.114-3.108 3.32C40.23 20.835 38.245 21 36 21s-4.229-.165-5.721-.344c-1.712-.206-2.98-1.602-3.108-3.32c-.09-1.224-.171-2.64-.171-3.836c0-4.198 3.375-7.45 7.573-7.493a142 142 0 0 1 2.854 0C41.625 6.049 45 9.302 45 13.5c0 1.195-.08 2.612-.171 3.836Z"/>' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M36 2v4m-3 7v1m6-1v1M16 27a5 5 0 1 0 10 0a5 5 0 1 0-10 0M5.423 27C1.504 20.526.633 14.328 4.48 10.48s10.046-2.976 16.52.943c-2.89 1.75-5.837 4.108-8.653 6.924S7.173 24.109 5.423 27m0 0C1.504 33.474.633 39.672 4.48 43.52s10.046 2.976 16.52-.943M5.423 27c1.75 2.89 4.108 5.837 6.924 8.653s5.762 5.174 8.653 6.924m0 0c6.474 3.919 12.672 4.79 16.52.943s2.976-10.046-.943-16.52c-1.75 2.89-4.108 5.837-6.924 8.653S23.891 40.827 21 42.577"/>' +
        '</g>',
    },

    // Classical building with columns (institution)
    academic: {
      viewBox: '0 0 24 24',
      inner: '<path fill="currentColor" d="m12 .856l10 5.556V9H2V6.412L12 .856ZM5.06 7h13.88L12 3.144L5.06 7ZM7 11v8H5v-8h2Zm6 0v8h-2v-8h2Zm6 0v8h-2v-8h2ZM2 21h20v2H2v-2Z"/>',
    },

    // Rocket outline
    startup: {
      viewBox: '0 0 24 24',
      inner: '<path fill="currentColor" d="m6 19.05l1.975-.8q-.25-.725-.463-1.475t-.337-1.5l-1.175.8v2.975ZM10 18h4q.45-1 .725-2.438T15 12.626q0-2.475-.825-4.688T12 4.526q-1.35 1.2-2.175 3.413T9 12.625q0 1.5.275 2.938T10 18Zm2-5q-.825 0-1.413-.588T10 11q0-.825.588-1.413T12 9q.825 0 1.413.588T14 11q0 .825-.588 1.413T12 13Zm6 6.05v-2.975l-1.175-.8q-.125.75-.338 1.5t-.462 1.475l1.975.8ZM12 1.975q2.475 1.8 3.738 4.575T17 13l2.1 1.4q.425.275.663.725t.237.95V22l-4.975-2h-6.05L4 22v-5.925q0-.5.238-.95T4.9 14.4L7 13q0-3.675 1.263-6.45T12 1.975Z"/>',
    },

    // Handshake
    general: {
      viewBox: '0 0 20 20',
      inner: '<g fill="currentColor">' +
        '<path fill-rule="evenodd" d="M3.646 2.49a1 1 0 0 0-1.322.502L.161 7.795a1 1 0 0 0 .5 1.322l1.49.671a1 1 0 0 0 1.323-.5l2.163-4.804a1 1 0 0 0-.5-1.322l-1.49-.671ZM1.873 8.418a.681.681 0 1 0 .56-1.242a.681.681 0 0 0-.56 1.242Zm17.142.83a1 1 0 0 0 .58-1.29L17.73 3.034a1 1 0 0 0-1.29-.581l-1.527.579a1 1 0 0 0-.58 1.29l1.866 4.925a1 1 0 0 0 1.289.581l1.528-.579Zm-2.937-5.445a.681.681 0 1 0 .483 1.274a.681.681 0 0 0-.483-1.274Z" clip-rule="evenodd"/>' +
        '<path fill-rule="evenodd" d="M14.885 4.107h.008a.5.5 0 1 0-.087-.997h-.008l-.026.003l-.097.01a41.841 41.841 0 0 0-1.516.172c-.894.117-2.003.297-2.728.539c-.353.117-.725.344-1.08.604a12.13 12.13 0 0 0-1.094.918A28.131 28.131 0 0 0 6.438 7.24c-.419.474-.516 1.23-.024 1.766c.32.346.82.784 1.468.98c.677.203 1.457.124 2.254-.468l.999-.645a.35.35 0 0 1 .018-.011c.143.087.342.237.58.436c.26.218.542.475.805.722a34.353 34.353 0 0 1 .88.86l.055.057l.014.014l.005.005l.059.06l.075.039c.403.2.846.128 1.19.012c.358-.12.714-.324 1.017-.525a8.893 8.893 0 0 0 1.075-.849l.018-.016l.005-.005l.001-.001s-.088-.31-.432-.672l-.271.34L16 10l-2.508.957L14 10.5l-.268-.717a34.008 34.008 0 0 0-.508-.49c-.27-.254-.568-.525-.85-.76c-.273-.23-.557-.448-.794-.578c-.394-.216-.78-.056-.988.079l-1.028.664l-.014.01c-.555.416-1.011.432-1.38.321c-.4-.12-.755-.412-1.02-.7c-.083-.09-.107-.263.037-.426a27.145 27.145 0 0 1 1.751-1.815c.341-.317.683-.61 1.002-.843c.326-.238.6-.393.807-.462c.624-.208 1.645-.379 2.544-.498a40.906 40.906 0 0 1 1.478-.167l.093-.009l.023-.002Z" clip-rule="evenodd"/>' +
        '<path d="M14.127 10.177a34.493 34.493 0 0 0-.395-.394L14 10.5l-.508.457L16 10l.229-.66L16.5 9l-.255-.054l-.003.002l-.014.013l-.054.05a8.18 8.18 0 0 1-.895.699c-.27.18-.543.33-.783.41c-.186.063-.302.068-.369.057Z"/>' +
        '<path fill-rule="evenodd" d="m5.047 5.068l-.197-.46l-.197-.46l.04-.016l.113-.048a92.636 92.636 0 0 1 1.67-.69a37.63 37.63 0 0 1 1.372-.523c.203-.072.392-.134.55-.179c.136-.04.31-.084.452-.084c.13 0 .267.03.38.06c.122.033.256.077.392.127c.274.1.583.23.869.356a29.066 29.066 0 0 1 .992.466l.066.032l.018.009l.006.003a.5.5 0 0 1-.447.895l-.005-.003l-.016-.008l-.062-.03a28.804 28.804 0 0 0-.959-.45a13.126 13.126 0 0 0-.803-.33a3.822 3.822 0 0 0-.309-.1a.928.928 0 0 0-.119-.026l-.009.002c-.02.003-.073.014-.172.042a8.91 8.91 0 0 0-.492.161c-.388.137-.865.322-1.332.509a86.968 86.968 0 0 0-1.651.681l-.111.047l-.039.017Zm-.657-.263a.5.5 0 0 1 .263-.656l.197.46l.197.459a.5.5 0 0 1-.657-.263Zm-1.903 3.96a.5.5 0 0 1 .707-.02l-.344.363l-.343.364a.5.5 0 0 1-.02-.707Zm4.57 3.387l2.763 1.036a1.5 1.5 0 0 0 1.587-.344l2.09-2.09a.5.5 0 0 1 .707.708l-2.09 2.09a2.5 2.5 0 0 1-2.645.572l-2.82-1.057l-.023-.011a3.007 3.007 0 0 1-.434-.292c-.162-.125-.352-.28-.557-.455a56.53 56.53 0 0 1-1.358-1.199a127.981 127.981 0 0 1-1.623-1.5l-.109-.102l-.038-.036l.343-.364l.344-.363l.037.035l.107.101a131.968 131.968 0 0 0 1.61 1.488c.46.417.935.84 1.333 1.178c.2.169.377.313.52.424c.132.101.215.157.256.18ZM3.67 14.288a.5.5 0 0 1 .703-.063l.959.8a1.5 1.5 0 0 0 .753.334l1.236.174a.5.5 0 1 1-.138.99l-1.237-.173a2.5 2.5 0 0 1-1.255-.557l-.959-.8a.5.5 0 0 1-.063-.705Z" clip-rule="evenodd"/>' +
        '</g>',
    },

    // Graduation cap with tassel
    student: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 10l10-5 10 5-10 5z"/>' +
        '<path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>' +
        '<path d="M20 10v6.5"/>' +
        '<circle cx="20" cy="17" r=".8"/>' +
        '</g>',
    },

    // Coffee cup with steam
    retired: {
      viewBox: '0 0 20 20',
      inner: '<path fill="currentColor" d="M1.382 8.505v5.058a5.057 5.057 0 0 0 5.057 5.058h3.677a5.057 5.057 0 0 0 5.057-5.058V8.506L1.382 8.505ZM11.887.16a.69.69 0 0 1 .086.972c-.642.765-.784 1.287-.586 1.637c.062.109.593.948.715 1.207c.276.585.312 1.152.074 1.822a4.622 4.622 0 0 1-.751 1.328h3.881c.437.016.754.127.95.335c.11.114.188.258.237.432l.06-.002a3.448 3.448 0 0 1 0 6.897l-.116-.004A6.438 6.438 0 0 1 10.117 20H6.438a6.436 6.436 0 0 1-6.436-6.437V8.337c-.02-.433.062-.74.244-.92c.183-.18.453-.277.809-.29h2.953a.689.689 0 0 1 .144-.17C4.762 6.44 5.16 5.9 5.36 5.337c.114-.32.101-.51-.022-.771c-.078-.166-.569-.942-.667-1.116c-.539-.952-.242-2.044.728-3.202a.69.69 0 1 1 1.057.886c-.642.765-.783 1.287-.585 1.637c.061.109.593.948.715 1.207c.275.585.312 1.152.073 1.822a4.622 4.622 0 0 1-.75 1.328h.858a.689.689 0 0 1 .144-.17C7.52 6.44 7.918 5.9 8.118 5.337c.114-.32.102-.51-.022-.771c-.078-.166-.569-.942-.667-1.116c-.539-.952-.242-2.044.729-3.202a.69.69 0 1 1 1.056.886c-.641.765-.783 1.287-.585 1.637c.062.109.593.948.715 1.207c.276.585.312 1.152.073 1.822a4.622 4.622 0 0 1-.75 1.328h.859a.689.689 0 0 1 .143-.17c.61-.518 1.007-1.058 1.207-1.621c.114-.32.102-.51-.022-.771c-.078-.166-.568-.942-.667-1.116c-.538-.952-.242-2.044.729-3.202a.69.69 0 0 1 .971-.086Zm4.665 9.11v4.138a2.069 2.069 0 0 0 0-4.138Z"/>',
    },

    // Robot with ears and antenna (robot-appreciate)
    individual: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M14.706 4.313H9.294a4.981 4.981 0 0 0-4.982 4.981v5.412a4.982 4.982 0 0 0 4.982 4.982h5.412a4.982 4.982 0 0 0 4.982-4.982V9.294a4.982 4.982 0 0 0-4.982-4.982Z"/>' +
        '<path d="M19.606 15.588h1.619a1.025 1.025 0 0 0 1.025-1.025V9.438a1.025 1.025 0 0 0-1.025-1.025h-1.62m-15.21 7.175h-1.62a1.025 1.025 0 0 1-1.025-1.025V9.438a1.025 1.025 0 0 1 1.025-1.025h1.62"/>' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M2.765 8.413v-4.1m18.46 4.1l-.01-4.1M9.94 15.588h4.1m-6.16-4.613L8.903 9.95l1.025 1.025m4.102 0l1.025-1.025l1.024 1.025"/>' +
        '</g>',
    },
  };

  function ticketIconSvg(key) {
    var icon = TICKET_ICONS[key];
    if (!icon) return '';
    return '<svg class="sratix-ticket-icon" xmlns="http://www.w3.org/2000/svg" viewBox="' + icon.viewBox + '">' + icon.inner + '</svg>';
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
      const [ticketTypes, publicInfo] = await Promise.all([
        apiFetch(endpoint, { headers }),
        apiFetch(`events/${eventId}/public-info`).catch(function () { return {}; }),
      ]);
      if (!ticketTypes || ticketTypes.length === 0) {
        container.innerHTML = `<p class="sratix-info">${escHtml(t('tickets.noTickets'))}</p>`;
        return;
      }
      let html = '';
      // Ticket display header (title + intro from event settings)
      if (publicInfo.ticketTitle || publicInfo.ticketIntro) {
        html += '<div class="sratix-ticket-header">';
        if (publicInfo.ticketTitle) {
          var size = publicInfo.ticketTitleSize || '1.75';
          html += '<h2 class="sratix-ticket-title" style="font-size:' + escAttr(size) + 'rem">' + escHtml(publicInfo.ticketTitle) + '</h2>';
        }
        if (publicInfo.ticketIntro) {
          html += '<div class="sratix-ticket-intro">' + publicInfo.ticketIntro + '</div>';
        }
        html += '</div>';
      }
      if (memberSession && memberSession.memberGroup && memberSession.memberGroup !== 'none') {
        html += renderWelcomeBanner(memberSession, ticketTypes);
      } else if (config.memberGateEnabled) {
        html += `<a href="#" data-action="change-member" class="sratix-back-to-gate">${escHtml(t('memberGate.backToMembership'))}</a>`;
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

  // ─── Hybrid tier mapping (mirrors Server HYBRID_TIER_MAP) ─────────────────

  const HYBRID_TIER_LABELS = {
    student: 'Student',
    individual: 'Individual',
    retired: 'Retired',
    industry_small: 'Individual',
    industry_medium: 'Individual',
    industry_large: 'Individual',
    academic: 'Individual',
    startup: 'Individual',
  };

  function renderTicketCards(types, layout, memberSession) {
    const cls = layout === 'list' ? 'sratix-list' : 'sratix-cards';
    return `<div class="${cls}">${types.map(function (tt) { return renderCard(tt, memberSession); }).join('')}</div>`;
  }

  function renderCard(tt, memberSession) {
    const soldOut = tt.soldOut || (tt.available !== null && tt.available <= 0);
    const isBundled = !!(tt.membershipTier && tt.sraWpProductId);

    const hasEarlyBird = tt.priceLabel && tt.basePriceCents != null && tt.basePriceCents > tt.priceCents;

    // ── Badge area (bundle + early bird / member discount) ──
    let badgesHtml = '';
    if (isBundled) {
      var tierLabel = HYBRID_TIER_LABELS[tt.membershipTier] || tt.sraMembershipTier || '';
      var prices = config.membershipPrices || {};
      var priceCents = prices[tt.sraWpProductId];
      var valuedStr = priceCents ? ' valued ' + formatPrice(priceCents, tt.currency) : '';
      badgesHtml += `<span class="sratix-bundle-badge">SRD+1yr SRA ${escHtml(tierLabel)} Membership${escHtml(valuedStr)}</span>`;
    }

    // ── Price area ──
    let priceHtml;
    if (tt.priceCents === 0) {
      priceHtml = `<span class="sratix-price-free">${escHtml(t('tickets.free'))}</span>`;
    } else if (memberSession && tt.memberDiscount && tt.memberDiscount.discountCents > 0) {
      priceHtml = `<div class="sratix-price-wrap">
        <span class="sratix-price-member">${formatPrice(tt.memberDiscount.discountedPriceCents, tt.currency)}</span>
        <span class="sratix-price-original">${formatPrice(tt.basePriceCents, tt.currency)}</span>
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

    // ── Availability + action ──
    const availHtml = tt.available !== null && !soldOut
      ? `<span class="sratix-avail">${escHtml(t('tickets.remaining', { n: tt.available }))}</span>`
      : '';
    const btn = soldOut
      ? `<span class="sratix-badge sratix-badge--sold-out">${escHtml(t('tickets.soldOut'))}</span>`
      : `<button class="sratix-btn sratix-btn--primary" data-action="select" data-ticket-type-id="${escAttr(tt.id)}">${escHtml(t('tickets.select'))}</button>`;

    const iconHtml = getTicketIcon(tt);

    // Card uses 3 flex zones for consistent alignment:
    //  1. Top zone: icon + name + badges + description
    //  2. Middle zone (auto-pushed down): price
    //  3. Bottom zone: availability + button
    return `<div class="sratix-ticket-card" data-ticket-type-id="${escAttr(tt.id)}">
      <div class="sratix-card-top">
        ${iconHtml}
        <h3>${escHtml(tt.name)}</h3>
        ${badgesHtml ? `<div class="sratix-card-badges">${badgesHtml}</div>` : ''}
        ${tt.description ? `<p class="sratix-desc">${escHtml(tt.description)}</p>` : ''}
      </div>
      <div class="sratix-card-mid">
        ${priceHtml}
      </div>
      <div class="sratix-card-bot">
        ${availHtml}
        ${btn}
      </div>
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
          <div class="sratix-self-ticket-row" id="sratix-self-ticket-row" style="display:none;margin-top:12px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:14px">
              <input type="checkbox" id="sratix-include-self" checked style="width:16px;height:16px" />
              <span>Include a ticket for myself</span>
            </label>
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
    const selfTicketRow = modal.querySelector('#sratix-self-ticket-row');
    const selfTicketCheckbox = modal.querySelector('#sratix-include-self');

    function updateDisplay() {
      valEl.textContent = qty;
      decBtn.disabled = qty <= 1;
      incBtn.disabled = qty >= maxQty;
      if (selfTicketRow) selfTicketRow.style.display = qty > 1 ? '' : 'none';
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
      var includeForSelf = selfTicketCheckbox ? selfTicketCheckbox.checked : true;
      closeModal();
      if (qty > 1) {
        openRecipientDetailsModal(eventId, tt, qty, promoCode, discountCents, includeForSelf);
      } else {
        openRegistrationModal(eventId, tt, qty, promoCode, discountCents, true, []);
      }
    });

    updateDisplay();
    requestAnimationFrame(() => modal.classList.add('sratix-modal--visible'));
  }

  // ─── Recipient details modal (between qty and registration) ──────────────────

  function openRecipientDetailsModal(eventId, tt, qty, promoCode, discountCents, includeForSelf) {
    var recipientCount = includeForSelf ? qty - 1 : qty;
    if (recipientCount < 1) {
      openRegistrationModal(eventId, tt, qty, promoCode, discountCents, includeForSelf, []);
      return;
    }

    var modal = createModalShell('sratix-modal-recipients');
    var rows = '';
    for (var i = 0; i < recipientCount; i++) {
      rows += '<div class="sratix-recipient-row">'
        + '<span class="sratix-label">Recipient ' + (i + 1) + '</span>'
        + '<div class="sratix-rcpt-name-row">'
        + '<input type="text" class="sratix-input sratix-rcpt-first" data-idx="' + i + '" placeholder="First name" />'
        + '<input type="text" class="sratix-input sratix-rcpt-last" data-idx="' + i + '" placeholder="Last name" />'
        + '</div>'
        + '<input type="email" class="sratix-input sratix-rcpt-email" data-idx="' + i + '" placeholder="Email address" />'
        + '</div>';
    }

    modal.innerHTML =
      '<div class="sratix-modal-box">'
      + '<button class="sratix-modal-close" aria-label="Close">&times;</button>'
      + '<h2 class="sratix-modal-title">Recipient Details</h2>'
      + '<div class="sratix-modal-body">'
      + '<p class="sratix-info" style="margin-bottom:16px">Enter details for each ticket recipient. They\u2019ll receive an email to complete their registration.</p>'
      + '<div id="sratix-recipient-list">' + rows + '</div>'
      + '<div id="sratix-rcpt-warn" class="sratix-promo-msg" style="display:none;color:#856d0a;"></div>'
      + '<p class="sratix-error" id="sratix-rcpt-error" style="display:none"></p>'
      + '</div>'
      + '<div class="sratix-modal-footer">'
      + '<button id="sratix-rcpt-back" class="sratix-btn sratix-btn--ghost">\u2190 Back</button>'
      + '<button id="sratix-rcpt-continue" class="sratix-btn sratix-btn--primary">Continue</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(modal);

    modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
    modal.querySelector('.sratix-modal-close').addEventListener('click', closeModal);

    modal.querySelector('#sratix-rcpt-back').addEventListener('click', function() {
      closeModal();
      openQuantityModal(eventId, tt);
    });

    modal.querySelector('#sratix-rcpt-continue').addEventListener('click', function() {
      var errorEl = modal.querySelector('#sratix-rcpt-error');
      var warnEl = modal.querySelector('#sratix-rcpt-warn');
      errorEl.style.display = 'none';
      warnEl.style.display = 'none';

      var firsts = modal.querySelectorAll('.sratix-rcpt-first');
      var lasts = modal.querySelectorAll('.sratix-rcpt-last');
      var emails = modal.querySelectorAll('.sratix-rcpt-email');
      var recipients = [];
      var emailSet = new Set();
      var hasDupes = false;

      for (var j = 0; j < recipientCount; j++) {
        var fn = firsts[j].value.trim();
        var ln = lasts[j].value.trim();
        var em = emails[j].value.trim().toLowerCase();
        if (!fn || !ln || !em) {
          errorEl.textContent = 'Please fill in all fields for every recipient.';
          errorEl.style.display = '';
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
          errorEl.textContent = 'Invalid email for recipient ' + (j + 1) + '.';
          errorEl.style.display = '';
          return;
        }
        if (emailSet.has(em)) {
          hasDupes = true;
        }
        emailSet.add(em);
        recipients.push({ firstName: fn, lastName: ln, email: em });
      }

      if (hasDupes) {
        warnEl.textContent = 'Warning: some recipients share the same email address.';
        warnEl.style.display = '';
      }

      closeModal();
      openRegistrationModal(eventId, tt, qty, promoCode, discountCents, includeForSelf, recipients);
    });

    requestAnimationFrame(function() { modal.classList.add('sratix-modal--visible'); });
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

    // Width style from form builder (25–100%, default 100%)
    var widthPct = field.width && field.width > 0 && field.width < 100 ? field.width : 100;
    var widthStyle = widthPct < 100
      ? ' style="flex: 0 0 calc(' + widthPct + '% - 14px); min-width: 140px;"'
      : '';

    // For consent type, label is already inline
    if (field.type === 'consent') {
      return '<div class="sratix-field sratix-df"' + widthStyle + ' data-df-id="' + escAttr(field.id) + '">' + html + helpHtml + '</div>';
    }

    return '<div class="sratix-field sratix-df"' + widthStyle + ' data-df-id="' + escAttr(field.id) + '">'
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

  async function openRegistrationModal(eventId, tt, qty, promoCode, discountCents, includeTicketForSelf, additionalAttendees) {
    if (typeof includeTicketForSelf === 'undefined') includeTicketForSelf = true;
    if (!additionalAttendees) additionalAttendees = [];
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
      // Sort by explicit order when available; otherwise preserve the DB array
      // order which matches the visual drag-drop sequence in the builder.
      var sorted = schemaFields.slice();
      sorted.sort(function (a, b) {
        var oa = typeof a.order === 'number' ? a.order : Infinity;
        var ob = typeof b.order === 'number' ? b.order : Infinity;
        if (oa !== Infinity || ob !== Infinity) return oa - ob;
        return 0; // both lack order — preserve original array position
      });
      formBodyHtml = '<div class="sratix-form-fields">' + sorted.map(renderFormField).join('') + '</div>';
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

        // Include multi-ticket recipient data
        if (additionalAttendees && additionalAttendees.length > 0) {
          payload.includeTicketForSelf = includeTicketForSelf;
          payload.additionalAttendees = additionalAttendees;
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

  // ─── Register widget (token-based recipient registration) ─────────────────────

  async function initRegisterWidget() {
    var container = document.getElementById('sratix-register-widget');
    if (!container) return;

    var apiUrl = container.getAttribute('data-api-url');
    if (!apiUrl) {
      container.innerHTML = '<p class="sratix-error">API URL not configured.</p>';
      return;
    }
    apiUrl = apiUrl.replace(/\/$/, '');

    var params = new URLSearchParams(window.location.search);
    var token = params.get('token');
    if (!token) {
      container.innerHTML = '<p class="sratix-info">No registration token provided.</p>';
      return;
    }

    // Sanitize token — only hex chars allowed (64 characters)
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      container.innerHTML = '<p class="sratix-error">Invalid registration link.</p>';
      return;
    }

    container.innerHTML = '<p class="sratix-info">Loading registration…</p>';

    try {
      var res = await fetch(apiUrl + '/public/register/' + encodeURIComponent(token));
      var data = await res.json().catch(function() { return {}; });
      if (!res.ok) {
        container.innerHTML = '<p class="sratix-error">' + escHtml(data.message || 'This registration link is invalid or has expired.') + '</p>';
        return;
      }

      var attendee = data.attendee || {};
      var event = data.event || {};
      var ticketTypeName = data.ticketTypeName || '';

      // Extract form schema fields (same structure as ticket page)
      var schemaFields = null;
      if (data.formSchema && data.formSchema.fields && data.formSchema.fields.fields) {
        schemaFields = data.formSchema.fields.fields;
      }
      var useCustomForm = !!(schemaFields && schemaFields.length > 0);

      // ── Build form body ──
      var formBodyHtml = '';

      // Read-only identity fields
      formBodyHtml += '<div class="sratix-field-row">'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-reg-first-name">First name</label>'
        +   '<input class="sratix-input" id="sratix-reg-first-name" type="text" name="firstName" value="' + escAttr(attendee.firstName || '') + '" readonly />'
        + '</div>'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-reg-last-name">Last name</label>'
        +   '<input class="sratix-input" id="sratix-reg-last-name" type="text" name="lastName" value="' + escAttr(attendee.lastName || '') + '" readonly />'
        + '</div>'
        + '</div>'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-reg-email">Email</label>'
        +   '<input class="sratix-input" id="sratix-reg-email" type="email" name="email" value="' + escAttr(attendee.email || '') + '" readonly />'
        + '</div>';

      // Custom form fields from schema, or default phone + company
      if (useCustomForm) {
        var sorted = schemaFields.slice();
        sorted.sort(function (a, b) {
          var oa = typeof a.order === 'number' ? a.order : Infinity;
          var ob = typeof b.order === 'number' ? b.order : Infinity;
          if (oa !== Infinity || ob !== Infinity) return oa - ob;
          return 0;
        });
        formBodyHtml += '<div class="sratix-form-fields">' + sorted.map(renderFormField).join('') + '</div>';
      } else {
        formBodyHtml += '<div class="sratix-field-row">'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-reg-phone">Phone</label>'
          +   '<input class="sratix-input" id="sratix-reg-phone" type="tel" name="phone" placeholder="+41 ..." autocomplete="tel" />'
          + '</div>'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-reg-company">Company / Organization</label>'
          +   '<input class="sratix-input" id="sratix-reg-company" type="text" name="company" autocomplete="organization" />'
          + '</div>'
          + '</div>';
      }

      var formHtml = ''
        + '<h2 class="sratix-modal-title">' + escHtml(event.name || 'Event Registration') + '</h2>'
        + (ticketTypeName ? '<p class="sratix-modal-subtitle">' + escHtml(ticketTypeName) + '</p>' : '')
        + '<p style="margin-bottom:20px;opacity:0.7;">Complete your registration details below.</p>'
        + '<form id="sratix-register-form" novalidate>'
        +   formBodyHtml
        +   '<p class="sratix-error-msg" id="sratix-reg-error" style="display:none"></p>'
        +   '<div style="margin-top:20px;">'
        +     '<button type="submit" class="sratix-btn sratix-btn--primary" style="width:100%;">Complete Registration</button>'
        +   '</div>'
        + '</form>';

      container.innerHTML = formHtml;

      var formEl = container.querySelector('#sratix-register-form');

      // Wire up condition-based visibility if using custom form
      if (useCustomForm && schemaFields.some(function (f) { return f.conditions && f.conditions.length > 0; })) {
        formEl.addEventListener('input', function () {
          var snap = collectDynamicAnswers(formEl, schemaFields, {});
          applyConditionVisibility(formEl, schemaFields, snap);
        });
        formEl.addEventListener('change', function () {
          var snap = collectDynamicAnswers(formEl, schemaFields, {});
          applyConditionVisibility(formEl, schemaFields, snap);
        });
        var initSnap = collectDynamicAnswers(formEl, schemaFields, {});
        applyConditionVisibility(formEl, schemaFields, initSnap);
      }

      formEl.addEventListener('submit', async function(e) {
        e.preventDefault();
        var errorEl = container.querySelector('#sratix-reg-error');
        errorEl.style.display = 'none';
        var submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';

        var formDataObj = {};
        if (useCustomForm) {
          formDataObj = collectDynamicAnswers(formEl, schemaFields, {});
        } else {
          var inputs = e.target.querySelectorAll('input, select, textarea');
          inputs.forEach(function(inp) {
            if (inp.name && !inp.readOnly) {
              formDataObj[inp.name] = inp.value;
            }
          });
        }

        try {
          var postRes = await fetch(apiUrl + '/public/register/' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ formData: formDataObj }),
          });
          var postData = await postRes.json().catch(function() { return {}; });
          if (!postRes.ok) {
            throw new Error(postData.message || 'Registration failed.');
          }
          container.innerHTML = '<div style="text-align:center;padding:32px 16px;">'
            + '<div style="font-size:48px;margin-bottom:16px;">✅</div>'
            + '<h3>Registration Complete!</h3>'
            + '<p style="opacity:0.7;">You are now registered for <strong>' + escHtml(event.name || 'the event') + '</strong>.</p>'
            + '<p style="opacity:0.7;">A confirmation email has been sent to <strong>' + escHtml(attendee.email || '') + '</strong>.</p>'
            + '</div>';
        } catch (err) {
          errorEl.textContent = err.message || 'Something went wrong. Please try again.';
          errorEl.style.display = '';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Complete Registration';
        }
      });

    } catch (err) {
      container.innerHTML = '<p class="sratix-error">Failed to load registration form. Please try again later.</p>';
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  function init() {
    if (new URLSearchParams(window.location.search).get('sratix_success') === '1') {
      injectSuccessBanner();
    }
    initTicketsWidget();
    initMyTicketsWidget();
    initScheduleWidget();
    initRegisterWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
