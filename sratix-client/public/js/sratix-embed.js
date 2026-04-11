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

  // Bridge nested config.user to legacy flat properties used by ticket forms
  // and My Tickets widget.  PHP now only sets the nested object.
  if (config.user) {
    config.userEmail     = config.user.email;
    config.userFirstName = config.user.firstName;
    config.userLastName  = config.user.lastName;
    config.wpUserId      = config.user.wpUserId;
    config.wpHmacToken   = config.user.signature; // legacy alias
  }

  const t = (typeof sratixI18n !== 'undefined') ? sratixI18n.t : function (k) { return k; };

  if (!config.apiUrl || !config.eventId) {
    console.warn('[SRAtix] Missing apiUrl or eventId in config');
    return;
  }

  const API_BASE = config.apiUrl.replace(/\/$/, '');
  const EVENT_ID = config.eventId;

  // Legal page URLs from event public-info (populated on ticket selection)
  var legalPageUrls = {};

  // Page paths from event settings (populated on ticket load)
  var pagePaths = {};

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

    // Robot with ears and antenna (robot-appreciate) — Professionals
    professionals: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M14.706 4.313H9.294a4.981 4.981 0 0 0-4.982 4.981v5.412a4.982 4.982 0 0 0 4.982 4.982h5.412a4.982 4.982 0 0 0 4.982-4.982V9.294a4.982 4.982 0 0 0-4.982-4.982Z"/>' +
        '<path d="M19.606 15.588h1.619a1.025 1.025 0 0 0 1.025-1.025V9.438a1.025 1.025 0 0 0-1.025-1.025h-1.62m-15.21 7.175h-1.62a1.025 1.025 0 0 1-1.025-1.025V9.438a1.025 1.025 0 0 1 1.025-1.025h1.62"/>' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M2.765 8.413v-4.1m18.46 4.1l-.01-4.1M9.94 15.588h4.1m-6.16-4.613L8.903 9.95l1.025 1.025m4.102 0l1.025-1.025l1.024 1.025"/>' +
        '</g>',
    },

    // Young Academics — graduation cap with star
    young_academics: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 10l10-5 10 5-10 5z"/>' +
        '<path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>' +
        '<path d="M20 10v4"/>' +
        '<path d="M15 2l.5 1.5L17 4l-1.5.5L15 6l-.5-1.5L13 4l1.5-.5z"/>' +
        '</g>',
    },

    // Academics — open book with bookmark
    academics: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>' +
        '<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' +
        '<path d="M14 4h2v5l-1-.75L14 9z"/>' +
        '</g>',
    },

    // Young Professionals — briefcase with star
    young_professionals: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>' +
        '<path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' +
        '<path d="M12 12l.5 1.5L14 14l-1.5.5L12 16l-.5-1.5L10 14l1.5-.5z"/>' +
        '</g>',
    },

    // Others — ellipsis in circle
    others: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="10"/>' +
        '<circle cx="8" cy="12" r=".5" fill="currentColor"/>' +
        '<circle cx="12" cy="12" r=".5" fill="currentColor"/>' +
        '<circle cx="16" cy="12" r=".5" fill="currentColor"/>' +
        '</g>',
    },

    // Compress / shrink arrows (inward arrows on diagonal)
    compress_alt: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 14h6v6"/>' +
        '<path d="M20 10h-6V4"/>' +
        '<path d="M14 10l7-7"/>' +
        '<path d="M3 21l7-7"/>' +
        '</g>',
    },

    // Enlarge / expand arrows (outward arrows on diagonal)
    enlarge2: {
      viewBox: '0 0 24 24',
      inner: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M15 3h6v6"/>' +
        '<path d="M9 21H3v-6"/>' +
        '<path d="M21 3l-7 7"/>' +
        '<path d="M3 21l7-7"/>' +
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

  // ─── Role state (visitor vs exhibitor) ──────────────────────────────────────

  const ROLE_KEY = 'sratix_role';

  function getRole() {
    try {
      const role = sessionStorage.getItem(ROLE_KEY);
      return (role === 'visitor' || role === 'exhibitor') ? role : null;
    } catch { return null; }
  }

  function setRole(role) {
    sessionStorage.setItem(ROLE_KEY, role);
  }

  function clearRole() {
    sessionStorage.removeItem(ROLE_KEY);
  }

  // ─── API helpers ─────────────────────────────────────────────────────────────

  async function apiFetch(endpoint, options = {}) {
    const url = API_BASE + '/' + endpoint.replace(/^\//, '');
    var headers = options.headers || {};
    // Don't set Content-Type for FormData — browser sets multipart boundary automatically
    // Don't set Content-Type when there's no body (e.g. DELETE requests)
    if (options.body && !(options.body instanceof FormData)) {
      headers = { 'Content-Type': 'application/json', ...headers };
    }
    const res = await fetch(url, {
      ...options,
      headers: headers,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.message || `SRAtix API error: ${res.status}`);
    }
    return body;
  }

  /** Resolve a relative URL (e.g. /uploads/...) against the server origin. */
  function resolveApiUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    // /uploads/ paths are served from the server root, not under /api
    var origin = API_BASE.replace(/\/api\/?$/, '');
    return origin + (path.startsWith('/') ? '' : '/') + path;
  }

  // ─── Ticket widget ────────────────────────────────────────────────────────────

  async function initTicketsWidget() {
    const container = document.getElementById('sratix-tickets-widget');
    if (!container) return;

    const eventId = container.dataset.eventId || EVENT_ID;
    const layout = container.dataset.layout || 'cards';

    // Step 1: Role choice (visitor vs exhibitor)
    const role = getRole();
    if (!role) {
      renderRoleChoice(container, eventId, layout);
      return;
    }

    // Step 2: Check for existing member session
    const session = getMemberSession();
    if (session && session.memberGroup) {
      // Already authenticated — show tickets with member pricing
      return loadAndRenderTickets(container, eventId, layout, session);
    }

    // Step 3: Show member gate if enabled and no session yet (visitors only)
    if (config.memberGateEnabled && role !== 'exhibitor') {
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
      const params = new URLSearchParams();

      // Role filter
      const role = getRole();
      if (role) params.set('role', role);

      if (memberSession && memberSession.sessionToken) {
        params.set('memberGroup', memberSession.memberGroup);
        if (memberSession.tier) params.set('memberTier', memberSession.tier);
        headers['Authorization'] = 'Bearer ' + memberSession.sessionToken;
      }
      const qs = params.toString();
      if (qs) endpoint += '?' + qs;
      const [ticketTypes, publicInfo] = await Promise.all([
        apiFetch(endpoint, { headers }),
        apiFetch(`events/${eventId}/public-info`).catch(function () { return {}; }),
      ]);

      // Store legal page URLs for consent field rendering
      if (publicInfo.legalPageUrls) {
        legalPageUrls = publicInfo.legalPageUrls;
      }
      if (publicInfo.pagePaths) {
        pagePaths = publicInfo.pagePaths;
      }

      if (!ticketTypes || ticketTypes.length === 0) {
        container.innerHTML = `<a href="#" data-action="change-role" class="sratix-back-to-gate">${escHtml(t('roleChoice.changeRole'))}</a>`
          + `<p class="sratix-info">${escHtml(t('tickets.noTickets'))}</p>`;
        const backLink = container.querySelector('[data-action="change-role"]');
        if (backLink) backLink.addEventListener('click', function (e) {
          e.preventDefault();
          clearRole();
          clearMemberSession();
          initTicketsWidget();
        });
        return;
      }
      let html = '';
      // Ticket display header (title + intro from event settings)
      // Use exhibitor-specific text when in the exhibitor flow, fallback to visitor
      var displayTitle = (role === 'exhibitor' && publicInfo.exhibitorTicketTitle)
        ? publicInfo.exhibitorTicketTitle
        : publicInfo.ticketTitle;
      var displayIntro = (role === 'exhibitor' && publicInfo.exhibitorTicketIntro)
        ? publicInfo.exhibitorTicketIntro
        : publicInfo.ticketIntro;
      if (displayTitle || displayIntro) {
        html += '<div class="sratix-ticket-header">';
        if (displayTitle) {
          var size = publicInfo.ticketTitleSize || '1.75';
          html += '<h2 class="sratix-ticket-title" style="font-size:' + escAttr(size) + 'rem">' + escHtml(displayTitle) + '</h2>';
        }
        if (displayIntro) {
          html += '<div class="sratix-ticket-intro">' + displayIntro + '</div>';
        }
        html += '</div>';
      }
      if (memberSession && memberSession.memberGroup && memberSession.memberGroup !== 'none') {
        html += renderWelcomeBanner(memberSession, ticketTypes);
      } else if (config.memberGateEnabled) {
        html += `<a href="#" data-action="change-member" class="sratix-back-to-gate">${escHtml(t('memberGate.backToMembership'))}</a>`;
      }
      // "Change role" link
      html += `<a href="#" data-action="change-role" class="sratix-back-to-gate">${escHtml(t('roleChoice.changeRole'))}</a>`;
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
      // Bind "change role" link
      const roleBtn = container.querySelector('[data-action="change-role"]');
      if (roleBtn) {
        roleBtn.addEventListener('click', function (e) {
          e.preventDefault();
          clearRole();
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
    const isPartner = session.memberGroup === 'partner' || session.memberGroup === 'robotx';

    // Logo
    let logoUrl = null;
    if (isSra) logoUrl = config.sraLogoUrl;
    else if (isPartner && session.partnerLogoUrl) logoUrl = resolveUrl(session.partnerLogoUrl);
    const logoHtml = logoUrl
      ? `<img src="${escAttr(logoUrl)}" alt="" class="sratix-welcome-logo" />`
      : '';

    // Partner display name
    const partnerName = session.partnerName || 'Partner';

    // Greeting line
    let greeting = '';
    if (isSra && session.firstName) {
      greeting = t('memberGate.welcomeGreeting', { name: '<strong>' + escHtml(session.firstName) + '</strong>' });
    } else if (isPartner) {
      greeting = escHtml(t('memberGate.welcomePartnerGreeting', { partnerName }));
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

    // For partner: discount pill goes inline with greeting; for SRA: in meta row
    const metaHtml = isSra ? `<div class="sratix-welcome-meta">${tierHtml}${discountHtml}</div>` : '';
    const inlineDiscount = isPartner && discountHtml ? ' ' + discountHtml : '';

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

  // ─── Role choice screen ───────────────────────────────────────────────────────

  function renderRoleChoice(container, eventId, layout) {
    container.innerHTML = `
      <div class="sratix-role-choice">
        <h2 class="sratix-role-choice__title">${escHtml(t('roleChoice.title'))}</h2>
        <p class="sratix-role-choice__subtitle">${escHtml(t('roleChoice.subtitle'))}</p>
        <div class="sratix-role-choice__buttons">
          <div class="sratix-role-btn sratix-role-btn--visitor" role="button" tabindex="0" data-role="visitor">
            <span class="sratix-role-btn__icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a3 3 0 0 1 0-6V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg></span>
            <span class="sratix-role-btn__label">${escHtml(t('roleChoice.visitorLabel'))}</span>
            <span class="sratix-role-btn__desc">${escHtml(t('roleChoice.visitorDesc'))}</span>
          </div>
          <div class="sratix-role-btn sratix-role-btn--exhibitor" role="button" tabindex="0" data-role="exhibitor">
            <span class="sratix-role-btn__icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 22V12h6v10"/><path d="M9 12V8l3-2 3 2v4"/></svg></span>
            <span class="sratix-role-btn__label">${escHtml(t('roleChoice.exhibitorLabel'))}</span>
            <span class="sratix-role-btn__desc">${escHtml(t('roleChoice.exhibitorDesc'))}</span>
          </div>
        </div>
      </div>
    `;

    container.querySelector('[data-role="visitor"]').addEventListener('click', function () {
      setRole('visitor');
      initTicketsWidget();
    });
    container.querySelector('[data-role="exhibitor"]').addEventListener('click', function () {
      setRole('exhibitor');
      initTicketsWidget();
    });
  }

  // ─── Member gate screen ──────────────────────────────────────────────────────

  function renderMemberGate(container, eventId, layout) {
    const sraLogoTitle = config.sraLogoUrl
      ? `<img src="${escAttr(config.sraLogoUrl)}" alt="SRA" class="sratix-member-gate__title-logo" />`
      : '';

    // Fetch partners + public-info from API (cached for this page load)
    if (!renderMemberGate._partnersCache) {
      renderMemberGate._partnersCache = apiFetch(`events/${eventId}/membership-partners/public`).catch(function () { return []; });
    }
    if (!renderMemberGate._publicInfoCache) {
      renderMemberGate._publicInfoCache = apiFetch(`events/${eventId}/public-info`).catch(function () { return {}; });
    }

    Promise.all([renderMemberGate._partnersCache, renderMemberGate._publicInfoCache]).then(function (results) {
      var partners = results[0];
      var gateInfo = results[1] || {};
      var hasPartners = partners && partners.length > 0;
      var gateModifier = hasPartners ? '' : ' sratix-member-gate--no-partners';
      var partnerButtonsHtml = '';
      if (hasPartners) {
        partnerButtonsHtml = partners.map(function (p) {
          const resolvedLogo = resolveUrl(p.logoUrl);
          const logo = resolvedLogo
            ? `<img src="${escAttr(resolvedLogo)}" alt="${escAttr(p.name)}" class="sratix-member-btn__logo" />`
            : '<span class="sratix-member-btn__icon">🤝</span>';
          const website = p.websiteUrl
            ? `<a href="${escAttr(p.websiteUrl)}" target="_blank" rel="noopener noreferrer" class="sratix-member-btn__website" onclick="event.stopPropagation()">${escHtml(t('memberGate.viewWebsite'))}</a>`
            : '';
          return `<button class="sratix-member-btn sratix-member-btn--partner" data-member="partner" data-partner-id="${escAttr(p.id)}" data-partner-name="${escAttr(p.name)}" data-partner-logo="${escAttr(resolvedLogo || '')}">
            ${logo}
            <span class="sratix-member-btn__label">${escHtml(p.name)}</span>
            ${website}
          </button>`;
        }).join('');
      }

      // When no partners, "no membership" becomes a card inside the grid next to SRA
      var regularBtnHtml = `<button class="sratix-member-btn sratix-member-btn--regular" data-member="none">
          <span class="sratix-member-btn__card-label">${escHtml(t('memberGate.regularCardLabel'))}</span>
        </button>`;

      container.innerHTML = `
        <div class="sratix-member-gate${gateModifier}">
          <a href="#" class="sratix-back-to-gate" id="sratix-back-to-role">${escHtml(t('roleChoice.changeRole'))}</a>
          <h2 class="sratix-member-gate__title">${sraLogoTitle}${escHtml(t('memberGate.title'))}</h2>
          <div class="sratix-member-gate__subtitle">${gateInfo.memberGateSubtitle || escHtml(t('memberGate.subtitle'))}</div>
          <div class="sratix-member-gate__buttons">
            <button class="sratix-member-btn sratix-member-btn--sra" data-member="sra">
              <span class="sratix-member-btn__card-label">${escHtml(t('memberGate.sraCardLabel'))}</span>
              <a href="https://swiss-robotics.org/" target="_blank" rel="noopener noreferrer" class="sratix-member-btn__website" onclick="event.stopPropagation()">${escHtml(t('memberGate.viewWebsite'))}</a>
            </button>
            ${partnerButtonsHtml}
            ${hasPartners ? '' : regularBtnHtml}
          </div>
          ${hasPartners ? regularBtnHtml : ''}
          ${gateInfo.memberGateDisclaimer ? '<div class="sratix-member-gate__disclaimer">' + gateInfo.memberGateDisclaimer + '</div>' : ''}
        </div>
      `;

      container.querySelector('[data-member="sra"]').addEventListener('click', function () {
        renderSraLoginForm(container, eventId, layout);
      });

      // Attach event listeners for each partner button
      container.querySelectorAll('[data-member="partner"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          renderPartnerCodeForm(container, eventId, layout, {
            id: btn.dataset.partnerId,
            name: btn.dataset.partnerName,
            logoUrl: btn.dataset.partnerLogo || null,
          });
        });
      });

      container.querySelector('[data-member="none"]').addEventListener('click', function () {
        setMemberSession({ memberGroup: 'none' });
        loadAndRenderTickets(container, eventId, layout, null);
      });
      container.querySelector('#sratix-back-to-role').addEventListener('click', function (e) {
        e.preventDefault();
        clearRole();
        renderRoleChoice(container, eventId, layout);
      });
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

  // ─── Partner code entry form ───────────────────────────────────────────────

  function renderPartnerCodeForm(container, eventId, layout, partner) {
    const partnerLogo = partner.logoUrl
      ? `<img src="${escAttr(partner.logoUrl)}" alt="${escAttr(partner.name)}" class="sratix-login-form__logo" />`
      : '';

    container.innerHTML = `
      <div class="sratix-login-form">
        <a href="#" class="sratix-login-form__back" id="sratix-gate-back">&larr; ${escHtml(t('memberGate.back'))}</a>
        <div class="sratix-login-form__header">
          ${partnerLogo}
          <div>
            <h2 class="sratix-login-form__title">${escHtml(t('memberGate.partnerTitle', { partnerName: partner.name }))}</h2>
            <p class="sratix-login-form__hint">${escHtml(t('memberGate.partnerHint', { partnerName: partner.name }))}</p>
          </div>
        </div>
        <div class="sratix-field">
          <label class="sratix-label" for="sratix-partner-code">${escHtml(t('memberGate.partnerCodeLabel'))}</label>
          <input class="sratix-input" id="sratix-partner-code" type="text" autocomplete="off" />
        </div>
        <p class="sratix-error-msg" id="sratix-partner-error" style="display:none"></p>
        <button class="sratix-btn sratix-btn--primary sratix-login-form__submit" id="sratix-partner-submit">
          ${escHtml(t('memberGate.partnerSubmit'))}
        </button>
      </div>
    `;

    container.querySelector('#sratix-gate-back').addEventListener('click', function (e) {
      e.preventDefault();
      renderMemberGate(container, eventId, layout);
    });

    const submitBtn = container.querySelector('#sratix-partner-submit');
    const errorEl = container.querySelector('#sratix-partner-error');

    submitBtn.addEventListener('click', async function () {
      errorEl.style.display = 'none';
      const code = container.querySelector('#sratix-partner-code').value.trim();

      if (!code) {
        errorEl.textContent = t('memberGate.partnerFieldRequired');
        errorEl.style.display = '';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('reg.pleaseWait');

      try {
        const res = await apiFetch('auth/partner-verify', {
          method: 'POST',
          body: JSON.stringify({ eventId, partnerId: partner.id, code }),
        });

        if (res.valid) {
          setMemberSession({
            memberGroup: 'partner',
            partnerId: partner.id,
            partnerName: partner.name,
            partnerLogoUrl: partner.logoUrl || null,
            sessionToken: res.sessionToken,
          });
          loadAndRenderTickets(container, eventId, layout, getMemberSession());
        } else {
          errorEl.textContent = t('memberGate.partnerInvalid', { partnerName: partner.name });
          errorEl.style.display = '';
        }
      } catch (err) {
        errorEl.textContent = err.message || t('memberGate.partnerError');
        errorEl.style.display = '';
      }

      submitBtn.disabled = false;
      submitBtn.textContent = t('memberGate.partnerSubmit');
    });

    container.querySelector('#sratix-partner-code').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitBtn.click(); }
    });
  }

  // ─── Hybrid tier mapping (mirrors Server HYBRID_TIER_MAP) ─────────────────

  const HYBRID_TIER_LABELS = {
    student: 'Student',
    young_academics: 'Young Academic',
    academics: 'Academic',
    young_professionals: 'Young Professional',
    professionals: 'Professional',
    retired: 'Retired',
    industry_small: 'Professional',
    industry_medium: 'Professional',
    industry_large: 'Professional',
    academic: 'Professional',
    startup: 'Professional',
    others: 'Professional',
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
        if (!tt) return;
        if (tt.category === 'exhibitor') {
          openExhibitorRegistrationWizard(eventId, tt);
        } else {
          openQuantityModal(eventId, tt);
        }
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
   * Initialize richtext editor toolbar bindings and paste sanitization
   * for all .sratix-richtext-wrap elements within a container.
   */
  function initRichtextEditors(container) {
    var wraps = container.querySelectorAll('.sratix-richtext-wrap');
    wraps.forEach(function (wrap) {
      var editor = wrap.querySelector('.sratix-richtext-editor');
      if (!editor) return;
      wrap.querySelectorAll('.sratix-richtext-btn').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault(); // keep focus in editor
          var cmd = btn.getAttribute('data-cmd');
          if (cmd === 'createLink') {
            var url = prompt('URL:');
            if (url) document.execCommand('createLink', false, url);
          } else {
            document.execCommand(cmd, false, null);
          }
        });
      });
      // Strip font-family on paste
      editor.addEventListener('paste', function (e) {
        e.preventDefault();
        var html = e.clipboardData.getData('text/html');
        if (html) {
          html = html.replace(/font-family\s*:[^;"]*/gi, '');
          document.execCommand('insertHTML', false, html);
        } else {
          var text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }
      });
    });
  }

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
      case 'richtext':
        html = '<div class="sratix-richtext-wrap" data-field-id="' + escAttr(field.id) + '">'
          + '<div class="sratix-richtext-toolbar">'
          + '<button type="button" data-cmd="bold" title="Bold" class="sratix-richtext-btn"><b>B</b></button>'
          + '<button type="button" data-cmd="italic" title="Italic" class="sratix-richtext-btn"><i>I</i></button>'
          + '<button type="button" data-cmd="underline" title="Underline" class="sratix-richtext-btn"><u>U</u></button>'
          + '<button type="button" data-cmd="createLink" title="Link" class="sratix-richtext-btn">🔗</button>'
          + '<button type="button" data-cmd="insertUnorderedList" title="Bullet List" class="sratix-richtext-btn">•</button>'
          + '<button type="button" data-cmd="insertOrderedList" title="Numbered List" class="sratix-richtext-btn">1.</button>'
          + '</div>'
          + '<div class="sratix-richtext-editor sratix-input" id="' + escAttr(id) + '" contenteditable="true" data-placeholder="' + escAttr(ph) + '"></div>'
          + '</div>';
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
        var docUrl = resolveLabel(field.documentUrl) || '';
        // Fallback: use event-level legal page URL from public-info
        if (!docUrl && legalPageUrls[field.id]) {
          docUrl = API_BASE + '/' + legalPageUrls[field.id].replace(/^\/api\//, '');
        }
        var consentLabelHtml;
        if (docUrl) {
          consentLabelHtml = '<a href="' + escAttr(docUrl) + '" target="_blank" rel="noopener noreferrer" class="sratix-consent-link" onclick="event.stopPropagation()">' + escHtml(label) + '</a>';
        } else {
          consentLabelHtml = escHtml(label);
        }
        html = '<label class="sratix-checkbox-label"><input type="checkbox" id="' + escAttr(id) + '" data-field-id="' + escAttr(field.id) + '" /> ' + consentLabelHtml + req + '</label>';
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
    var minW = field.type === 'consent' ? '100px' : '140px';
    var widthStyle = widthPct < 100
      ? ' style="flex: 0 0 calc(' + widthPct + '% - 14px); min-width: ' + minW + ';"'
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
        case 'richtext':
          el = form.querySelector('#' + CSS.escape(id));
          result[field.id] = el ? el.innerHTML.trim() : '';
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

      // Initialize richtext editors if any exist in this form
      initRichtextEditors(formEl);
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
        var successUrl = buildSuccessUrl(tt.category, email);
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

  // ─── Exhibitor Registration Wizard (3-step) ──────────────────────────────────

  async function openExhibitorRegistrationWizard(eventId, tt) {
    var modal = createModalShell('sratix-modal-exhibitor');

    // maxStaff comes from the ticket type itself, not the form schema
    var maxStaff = tt.maxStaff || 0;

    // Fetch form schema for field layout
    var schema = null;
    var schemaFields = null;
    if (tt.formSchemaId) {
      try {
        schema = await apiFetch(
          'public/forms/ticket-type/' + encodeURIComponent(tt.id)
          + '/event/' + encodeURIComponent(eventId),
        );
        if (schema && schema.fields) {
          schemaFields = schema.fields.fields || [];
        }
      } catch (err) {
        console.warn('[SRAtix] Could not load exhibitor form schema:', err);
      }
    }

    var currentStep = 1;
    var totalSteps = 3;

    // State
    var purchaserData = { firstName: '', lastName: '', email: '', phone: '', company: '' };
    var formAnswers = {};
    var staffEntries = [];
    var staffCount = 0;

    /** Check if the exhibitor chose to assign staff passes now and maxStaff allows it. */
    function wantsStaffNow() {
      if (maxStaff <= 0) return false;
      if (!schemaFields) return true; // no schema → show stepper if maxStaff > 0
      var assignField = schemaFields.find(function (f) { return f.slug === 'exhibitor_assign_passes_now'; });
      if (!assignField) return true; // field not in form → default to showing stepper
      var answer = formAnswers[assignField.id];
      return answer === 'yes';
    }

    // Pre-fill from WP context
    if (config.userEmail) purchaserData.email = config.userEmail;
    if (config.userFirstName) purchaserData.firstName = config.userFirstName;
    if (config.userLastName) purchaserData.lastName = config.userLastName;

    function renderStepIndicator() {
      var steps = [
        t('reg.title'),
        t('exhibitorForm.companyTitle'),
        t('exhibitorForm.staffTitle'),
      ];
      return '<div class="sratix-wizard-steps">' + steps.map(function (label, idx) {
        var stepNum = idx + 1;
        var cls = 'sratix-wizard-step';
        if (stepNum < currentStep) cls += ' sratix-wizard-step--done';
        if (stepNum === currentStep) cls += ' sratix-wizard-step--active';
        return '<div class="' + cls + '">'
          + '<span class="sratix-wizard-step__num">' + (stepNum < currentStep ? '✓' : stepNum) + '</span>'
          + '<span class="sratix-wizard-step__label">' + escHtml(label) + '</span>'
          + '</div>';
      }).join('<div class="sratix-wizard-step__line"></div>') + '</div>';
    }

    function renderStep1() {
      return '<div class="sratix-wizard-body">'
        + '<div class="sratix-field-row">'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-ex-fn">' + escHtml(t('reg.firstName')) + ' <span class="sratix-req">*</span></label>'
        +     '<input class="sratix-input" id="sratix-ex-fn" type="text" value="' + escAttr(purchaserData.firstName) + '" autocomplete="given-name" />'
        +   '</div>'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-ex-ln">' + escHtml(t('reg.lastName')) + ' <span class="sratix-req">*</span></label>'
        +     '<input class="sratix-input" id="sratix-ex-ln" type="text" value="' + escAttr(purchaserData.lastName) + '" autocomplete="family-name" />'
        +   '</div>'
        + '</div>'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-ex-email">' + escHtml(t('reg.email')) + ' <span class="sratix-req">*</span></label>'
        +   '<input class="sratix-input" id="sratix-ex-email" type="email" value="' + escAttr(purchaserData.email) + '" autocomplete="email" />'
        + '</div>'
        + '<div class="sratix-field-row">'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-ex-phone">' + escHtml(t('reg.phone')) + ' <span class="sratix-req">*</span></label>'
        +     '<input class="sratix-input" id="sratix-ex-phone" type="tel" value="' + escAttr(purchaserData.phone) + '" autocomplete="tel" />'
        +   '</div>'
        +   '<div class="sratix-field">'
        +     '<label class="sratix-label" for="sratix-ex-company">' + escHtml(t('reg.organization')) + ' <span class="sratix-req">*</span></label>'
        +     '<input class="sratix-input" id="sratix-ex-company" type="text" value="' + escAttr(purchaserData.company) + '" autocomplete="organization" />'
        +   '</div>'
        + '</div>'
        + '</div>';
    }

    function renderStep2() {
      var fieldsHtml = '';
      if (schemaFields && schemaFields.length > 0) {
        var sorted = schemaFields.slice().sort(function (a, b) {
          var oa = typeof a.order === 'number' ? a.order : Infinity;
          var ob = typeof b.order === 'number' ? b.order : Infinity;
          if (oa !== Infinity || ob !== Infinity) return oa - ob;
          return 0;
        });
        fieldsHtml = '<div class="sratix-form-fields">' + sorted.map(renderFormField).join('') + '</div>';
      } else {
        // Fallback if no schema: simple company fields
        fieldsHtml = ''
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-ex-logo">Company Logo</label>'
          +   '<input class="sratix-input" id="sratix-ex-logo" type="file" accept="image/*" />'
          + '</div>'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-ex-desc">Company Description</label>'
          +   '<textarea class="sratix-input" id="sratix-ex-desc" rows="4"></textarea>'
          + '</div>'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-ex-web">Company Website</label>'
          +   '<input class="sratix-input" id="sratix-ex-web" type="url" />'
          + '</div>';
      }
      return '<div class="sratix-wizard-body">'
        + '<p class="sratix-wizard-subtitle">' + escHtml(t('exhibitorForm.companySubtitle')) + '</p>'
        + fieldsHtml
        + '<div class="sratix-info-callout">' + t('exhibitorForm.companyNote') + '</div>'
        + '</div>';
    }

    function renderStep3() {
      var staffHtml = '';
      if (!wantsStaffNow()) {
        // Clear any leftover staff data when not assigning now
        staffCount = 0;
        staffEntries = [];
      }
      if (wantsStaffNow()) {
        staffHtml += '<p class="sratix-wizard-subtitle">'
          + escHtml(t('exhibitorForm.staffSubtitle').replace('{max}', maxStaff)) + '</p>';
        staffHtml += '<div class="sratix-field" style="margin-bottom:16px">'
          + '<label class="sratix-label" for="sratix-ex-staff-count">'
          + escHtml(t('exhibitorForm.staffCount')) + '</label>'
          + '<div class="sratix-qty-stepper">'
          + '<button type="button" class="sratix-qty-btn" id="sratix-staff-dec">−</button>'
          + '<span class="sratix-qty-val" id="sratix-staff-val">' + staffCount + '</span>'
          + '<button type="button" class="sratix-qty-btn" id="sratix-staff-inc">+</button>'
          + '</div>'
          + '<span class="sratix-field-help">' + escHtml(t('exhibitorForm.staffMax').replace('{max}', maxStaff)) + '</span>'
          + '</div>';
        staffHtml += '<div id="sratix-staff-fields">' + renderStaffFields() + '</div>';
        staffHtml += '<button type="button" id="sratix-skip-staff" class="sratix-btn sratix-btn--ghost" style="margin-top:12px;width:100%">'
          + escHtml(t('exhibitorForm.skipStaff')) + '</button>';
      } else {
        staffHtml += '<p class="sratix-wizard-subtitle">'
          + escHtml(t('exhibitorForm.staffDeclinedNote')) + '</p>';
      }
      return '<div class="sratix-wizard-body">' + staffHtml + '</div>';
    }

    function renderStaffFields() {
      var html = '';
      for (var i = 0; i < staffCount; i++) {
        var entry = staffEntries[i] || { firstName: '', lastName: '', email: '' };
        html += '<div class="sratix-recipient-block" data-staff-idx="' + i + '">'
          + '<p class="sratix-label" style="font-weight:600;margin-bottom:4px">Staff #' + (i + 1) + '</p>'
          + '<div class="sratix-field-row">'
          +   '<div class="sratix-field">'
          +     '<label class="sratix-label">' + escHtml(t('reg.firstName')) + ' *</label>'
          +     '<input class="sratix-input sratix-staff-fn" type="text" value="' + escAttr(entry.firstName) + '" />'
          +   '</div>'
          +   '<div class="sratix-field">'
          +     '<label class="sratix-label">' + escHtml(t('reg.lastName')) + ' *</label>'
          +     '<input class="sratix-input sratix-staff-ln" type="text" value="' + escAttr(entry.lastName) + '" />'
          +   '</div>'
          + '</div>'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label">' + escHtml(t('reg.email')) + ' *</label>'
          +   '<input class="sratix-input sratix-staff-email" type="email" value="' + escAttr(entry.email) + '" />'
          + '</div>'
          + '</div>';
      }
      return html;
    }

    function collectStaffFromDOM() {
      var blocks = modal.querySelectorAll('.sratix-recipient-block');
      staffEntries = [];
      blocks.forEach(function (block) {
        staffEntries.push({
          firstName: block.querySelector('.sratix-staff-fn').value.trim(),
          lastName: block.querySelector('.sratix-staff-ln').value.trim(),
          email: block.querySelector('.sratix-staff-email').value.trim(),
        });
      });
    }

    function renderWizard() {
      var stepBody = '';
      if (currentStep === 1) stepBody = renderStep1();
      else if (currentStep === 2) stepBody = renderStep2();
      else stepBody = renderStep3();

      var navLeft = currentStep > 1
        ? '<button class="sratix-btn sratix-btn--ghost" id="sratix-ex-back">' + escHtml(t('exhibitorForm.back')) + '</button>'
        : '';
      var navRight = '';
      if (currentStep < totalSteps) {
        navRight = '<button class="sratix-btn sratix-btn--primary" id="sratix-ex-next">' + escHtml(t('exhibitorForm.next')) + '</button>';
      } else {
        var label = tt.priceCents === 0 ? t('reg.completeRegistration') : t('exhibitorForm.continueToPay');
        navRight = '<button class="sratix-btn sratix-btn--primary" id="sratix-ex-submit">' + escHtml(label) + '</button>';
      }

      modal.innerHTML = ''
        + '<div class="sratix-modal-box sratix-modal-box--wide">'
        +   '<button class="sratix-modal-close" aria-label="' + escAttr(t('modal.close')) + '">&times;</button>'
        +   '<h2 class="sratix-modal-title">' + escHtml(tt.name) + '</h2>'
        +   '<p class="sratix-modal-subtitle">'
        +     '<strong>' + (tt.priceCents === 0 ? escHtml(t('tickets.free')) : formatPrice(tt.priceCents, tt.currency)) + '</strong> — '
        +     escHtml(t('exhibitorForm.step').replace('{current}', currentStep).replace('{total}', totalSteps))
        +   '</p>'
        +   renderStepIndicator()
        +   '<div class="sratix-modal-body">'
        +     stepBody
        +     '<p class="sratix-error-msg" id="sratix-ex-error" style="display:none"></p>'
        +   '</div>'
        +   '<div class="sratix-modal-footer">'
        +     navLeft + navRight
        +   '</div>'
        + '</div>';

      document.body.appendChild(modal);

      // Bind events
      modal.querySelector('.sratix-modal-close').addEventListener('click', closeModal);
      modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });

      if (currentStep === 2) {
        initRichtextEditors(modal);
        // Restore previously collected answers
        if (schemaFields) {
          schemaFields.forEach(function (f) {
            if (formAnswers[f.id] !== undefined) {
              var el = modal.querySelector('#sratix-df-' + CSS.escape(f.id));
              if (el) {
                if (f.type === 'richtext' && el.getAttribute('contenteditable')) {
                  el.innerHTML = formAnswers[f.id];
                } else if (el.tagName === 'SELECT') {
                  el.value = formAnswers[f.id];
                } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                  el.value = formAnswers[f.id];
                }
              }
            }
          });
          // Wire condition visibility
          if (schemaFields.some(function (f) { return f.conditions && f.conditions.length > 0; })) {
            var formEl = modal.querySelector('.sratix-form-fields') || modal;
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
        }
      }

      if (currentStep === 3 && wantsStaffNow()) {
        var decBtn = modal.querySelector('#sratix-staff-dec');
        var incBtn = modal.querySelector('#sratix-staff-inc');
        var valEl = modal.querySelector('#sratix-staff-val');
        if (decBtn) decBtn.addEventListener('click', function () {
          if (staffCount > 0) {
            collectStaffFromDOM();
            staffCount--;
            valEl.textContent = staffCount;
            modal.querySelector('#sratix-staff-fields').innerHTML = renderStaffFields();
          }
        });
        if (incBtn) incBtn.addEventListener('click', function () {
          if (staffCount < maxStaff) {
            collectStaffFromDOM();
            staffCount++;
            valEl.textContent = staffCount;
            modal.querySelector('#sratix-staff-fields').innerHTML = renderStaffFields();
          }
        });
        var skipLink = modal.querySelector('#sratix-skip-staff');
        if (skipLink) skipLink.addEventListener('click', function (e) {
          e.preventDefault();
          staffCount = 0;
          staffEntries = [];
          submitExhibitorCheckout();
        });
      }

      var backBtn = modal.querySelector('#sratix-ex-back');
      if (backBtn) backBtn.addEventListener('click', function () {
        saveCurrentStep();
        currentStep--;
        renderWizard();
      });

      var nextBtn = modal.querySelector('#sratix-ex-next');
      if (nextBtn) nextBtn.addEventListener('click', function () {
        if (!validateCurrentStep()) return;
        saveCurrentStep();
        currentStep++;
        renderWizard();
      });

      var submitBtn = modal.querySelector('#sratix-ex-submit');
      if (submitBtn) submitBtn.addEventListener('click', function () {
        if (!validateCurrentStep()) return;
        saveCurrentStep();
        submitExhibitorCheckout();
      });

      requestAnimationFrame(function () { modal.classList.add('sratix-modal--visible'); });
    }

    function saveCurrentStep() {
      if (currentStep === 1) {
        purchaserData.firstName = (modal.querySelector('#sratix-ex-fn')?.value || '').trim();
        purchaserData.lastName = (modal.querySelector('#sratix-ex-ln')?.value || '').trim();
        purchaserData.email = (modal.querySelector('#sratix-ex-email')?.value || '').trim();
        purchaserData.phone = (modal.querySelector('#sratix-ex-phone')?.value || '').trim();
        purchaserData.company = (modal.querySelector('#sratix-ex-company')?.value || '').trim();
      } else if (currentStep === 2 && schemaFields) {
        var formEl = modal.querySelector('.sratix-form-fields') || modal;
        formAnswers = collectDynamicAnswers(formEl, schemaFields, {});
      } else if (currentStep === 3) {
        collectStaffFromDOM();
      }
    }

    function validateCurrentStep() {
      var errorEl = modal.querySelector('#sratix-ex-error');
      errorEl.style.display = 'none';

      if (currentStep === 1) {
        var fn = (modal.querySelector('#sratix-ex-fn')?.value || '').trim();
        var ln = (modal.querySelector('#sratix-ex-ln')?.value || '').trim();
        var em = (modal.querySelector('#sratix-ex-email')?.value || '').trim();
        var ph = (modal.querySelector('#sratix-ex-phone')?.value || '').trim();
        var org = (modal.querySelector('#sratix-ex-company')?.value || '').trim();
        if (!fn || !ln) {
          errorEl.textContent = t('reg.nameRequired');
          errorEl.style.display = '';
          return false;
        }
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
          errorEl.textContent = t('reg.emailInvalid');
          errorEl.style.display = '';
          return false;
        }
        if (!ph) {
          errorEl.textContent = t('reg.form.fieldRequired', { field: t('reg.phone') });
          errorEl.style.display = '';
          return false;
        }
        if (!org) {
          errorEl.textContent = t('reg.form.fieldRequired', { field: t('reg.organization') });
          errorEl.style.display = '';
          return false;
        }
      }

      if (currentStep === 2 && schemaFields) {
        var formEl = modal.querySelector('.sratix-form-fields') || modal;
        var rawAnswers = collectDynamicAnswers(formEl, schemaFields, {});
        var answers = collectDynamicAnswers(formEl, schemaFields, rawAnswers);
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
              return false;
            }
          }
        }
      }

      if (currentStep === 3 && staffCount > 0) {
        collectStaffFromDOM();
        for (var j = 0; j < staffEntries.length; j++) {
          var s = staffEntries[j];
          if (!s.firstName || !s.lastName) {
            errorEl.textContent = t('reg.nameRequired') + ' (Staff #' + (j + 1) + ')';
            errorEl.style.display = '';
            return false;
          }
          if (!s.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) {
            errorEl.textContent = t('reg.emailInvalid') + ' (Staff #' + (j + 1) + ')';
            errorEl.style.display = '';
            return false;
          }
        }
      }

      return true;
    }

    async function submitExhibitorCheckout() {
      var errorEl = modal.querySelector('#sratix-ex-error');
      var submitBtn = modal.querySelector('#sratix-ex-submit') || modal.querySelector('#sratix-skip-staff');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = t('reg.pleaseWait');
      }

      try {
        var successUrl = buildSuccessUrl('exhibitor', purchaserData.email);
        var payload = {
          eventId: eventId,
          ticketTypeId: tt.id,
          quantity: 1,
          includeTicketForSelf: true,
          attendeeData: {
            email: purchaserData.email,
            firstName: purchaserData.firstName,
            lastName: purchaserData.lastName,
            phone: purchaserData.phone || undefined,
            company: purchaserData.company || undefined,
          },
          successUrl: successUrl,
          cancelUrl: window.location.href,
          additionalAttendees: staffEntries.length > 0 ? staffEntries : [],
        };

        // Include form data
        if (schema && Object.keys(formAnswers).length > 0) {
          payload.formSchemaId = schema.id;
          var coreIds = ['first_name', 'firstName', 'last_name', 'lastName', 'email', 'phone', 'company', 'organization'];
          var formData = {};
          Object.keys(formAnswers).forEach(function (k) {
            if (coreIds.indexOf(k) === -1) {
              formData[k] = formAnswers[k];
            }
          });
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
        if (errorEl) {
          errorEl.textContent = err instanceof Error ? err.message : t('reg.genericError');
          errorEl.style.display = '';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = t('exhibitorForm.continueToPay');
        }
      }
    }

    // Initial render
    renderWizard();
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
      // Test mode banner — same as live, with a subtle test indicator.
      // All downstream processes (emails, WP sync, etc.) run identically.
      banner.innerHTML = `
        <span class="sratix-success-icon">✓</span>
        <div class="sratix-success-text">
          <strong>${escHtml(t('success.title'))}</strong> <small style="opacity:.6">[TEST]</small>
          ${orderNumber ? `<span> — ${escHtml(t('success.order', { number: orderNumber }))}</span>` : ''}
          <br>${escHtml(t('success.checkEmail'))}
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
        const detailStr = item.detail ? JSON.stringify(item.detail, null, 2) : '';
        html += `<li>
          <strong>${escHtml(item.action)}</strong>
          <span>${escHtml(item.description)}</span>
          ${detailStr ? `<code>${escHtml(detailStr)}</code>` : ''}
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
      const user = config.user || {};
      const authRes = await apiFetch('auth/token', {
        method: 'POST',
        body: JSON.stringify({
          wpUserId: user.wpUserId || config.wpUserId,
          wpRoles: user.roles || [],
          signature: user.signature || config.wpHmacToken,
          sourceSite: user.sourceSite || '',
          email: user.email || config.userEmail,
          displayName: ((user.firstName || '') + (user.lastName ? ' ' + user.lastName : '')).trim(),
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

  function buildSuccessUrl(category, email) {
    // Exhibitor purchases → redirect to portal page if configured in event settings
    if (category === 'exhibitor' && pagePaths.exhibitorPortal) {
      const url = new URL(pagePaths.exhibitorPortal, window.location.origin);
      url.searchParams.set('sratix_success', '1');
      url.searchParams.set('sratix_type', 'exhibitor');
      if (email) url.searchParams.set('sratix_email', email);
      return url.toString();
    }
    const url = new URL(window.location.href);
    url.searchParams.set('sratix_success', '1');
    if (category === 'exhibitor') {
      url.searchParams.set('sratix_type', 'exhibitor');
      if (email) url.searchParams.set('sratix_email', email);
    }
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

  /** Resolve a potentially relative URL (e.g. /uploads/…) against API_BASE. */
  function resolveUrl(url) {
    if (!url) return url;
    if (/^https?:\/\//i.test(url)) return url;
    return API_BASE.replace(/\/api$/, '') + url;
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

      // Already registered — show friendly confirmation
      if (data.alreadyRegistered || data.tokenConsumed) {
        container.innerHTML = '<div class="sratix-set-password__success">'
          + '<h2>' + escHtml(t('reg.alreadyRegisteredTitle')) + '</h2>'
          + '<p>' + escHtml(t('reg.alreadyRegisteredMsg').replace('{name}', data.attendeeName || t('reg.alreadyRegisteredFallbackName'))) + '</p>'
          + '</div>';
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

      // Editable name fields (pre-filled from attendee record)
      formBodyHtml += '<div class="sratix-field-row">'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-reg-first-name">' + escHtml(t('reg.firstName')) + '</label>'
        +   '<input class="sratix-input" id="sratix-reg-first-name" type="text" name="firstName" value="' + escAttr(attendee.firstName || '') + '" required />'
        + '</div>'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-reg-last-name">' + escHtml(t('reg.lastName')) + '</label>'
        +   '<input class="sratix-input" id="sratix-reg-last-name" type="text" name="lastName" value="' + escAttr(attendee.lastName || '') + '" required />'
        + '</div>'
        + '</div>'
        + '<div class="sratix-field">'
        +   '<label class="sratix-label" for="sratix-reg-email">' + escHtml(t('reg.email')) + '</label>'
        +   '<input class="sratix-input" id="sratix-reg-email" type="email" name="email" value="' + escAttr(attendee.email || '') + '" readonly />'
        + '</div>';

      // Custom form fields from schema, or default phone + password
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
        // ─── DEFAULT: Phone + Set Password ──────────────────────────────
        formBodyHtml += '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-reg-phone">' + escHtml(t('reg.phone')) + '</label>'
          +   '<input class="sratix-input" id="sratix-reg-phone" type="tel" name="phone" placeholder="+41 ..." autocomplete="tel" />'
          + '</div>'
          + '<div class="sratix-field-row">'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-reg-password">' + escHtml(t('reg.password')) + '</label>'
          +   '<input class="sratix-input" id="sratix-reg-password" type="password" name="password" minlength="8" required autocomplete="new-password" />'
          + '</div>'
          + '<div class="sratix-field">'
          +   '<label class="sratix-label" for="sratix-reg-password-confirm">' + escHtml(t('reg.passwordConfirm')) + '</label>'
          +   '<input class="sratix-input" id="sratix-reg-password-confirm" type="password" name="passwordConfirm" minlength="8" required autocomplete="new-password" />'
          + '</div>'
          + '</div>'
          + '<p class="sratix-field-hint">' + escHtml(t('reg.passwordHint')) + '</p>';
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

        // Collect name fields (always editable)
        var firstName = (container.querySelector('#sratix-reg-first-name').value || '').trim();
        var lastName = (container.querySelector('#sratix-reg-last-name').value || '').trim();
        if (!firstName || !lastName) {
          errorEl.textContent = t('reg.nameRequired');
          errorEl.style.display = '';
          return;
        }

        // Password validation (default form only)
        var password = null;
        if (!useCustomForm) {
          var pwEl = container.querySelector('#sratix-reg-password');
          var pwConfirmEl = container.querySelector('#sratix-reg-password-confirm');
          if (pwEl && pwConfirmEl) {
            password = pwEl.value;
            if (!password || password.length < 8) {
              errorEl.textContent = t('reg.passwordTooShort');
              errorEl.style.display = '';
              return;
            }
            if (password !== pwConfirmEl.value) {
              errorEl.textContent = t('reg.passwordMismatch');
              errorEl.style.display = '';
              return;
            }
          }
        }

        submitBtn.disabled = true;
        submitBtn.textContent = t('reg.pleaseWait');

        var formDataObj = {};
        if (useCustomForm) {
          formDataObj = collectDynamicAnswers(formEl, schemaFields, {});
        } else {
          var inputs = e.target.querySelectorAll('input, select, textarea');
          inputs.forEach(function(inp) {
            if (inp.name && !inp.readOnly && inp.type !== 'password') {
              formDataObj[inp.name] = inp.value;
            }
          });
        }

        try {
          var postBody = { formData: formDataObj, firstName: firstName, lastName: lastName };
          if (password) postBody.password = password;
          var postRes = await fetch(apiUrl + '/public/register/' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postBody),
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

  // ─── Set Password widget ─────────────────────────────────────────────────────

  // ─── Password strength ────────────────────────────────────────────────────────

  /**
   * Evaluate password strength against 9 conditions.
   * Returns { score: 0-9, level: 'weak'|'fair'|'good'|'strong', checks: boolean[] }.
   * Need 5/9 for "good" (green submit). 3-4 = "fair". <3 = "weak".
   */
  function evaluatePasswordStrength(pw, email) {
    var checks = [
      pw.length >= 8,                                        // 1. min 8 chars
      pw.length >= 12,                                       // 2. 12+ chars (bonus)
      /[a-z]/.test(pw),                                      // 3. lowercase
      /[A-Z]/.test(pw),                                      // 4. uppercase
      /[0-9]/.test(pw),                                      // 5. digit
      /[^a-zA-Z0-9]/.test(pw),                               // 6. special char
      !/(.)\1{2,}/.test(pw),                                 // 7. no 3+ repeated chars
      !email || pw.toLowerCase() !== email.toLowerCase(),    // 8. not same as email
      !/password|12345|qwerty|abcdef|letmein/i.test(pw),     // 9. no common patterns
    ];
    var score = checks.reduce(function(s, c) { return s + (c ? 1 : 0); }, 0);
    var level = score >= 7 ? 'strong' : score >= 5 ? 'good' : score >= 3 ? 'fair' : 'weak';
    return { score: score, level: level, checks: checks };
  }

  function renderStrengthMeter(containerEl, pw, email) {
    var result = evaluatePasswordStrength(pw, email);
    var pct = Math.round((result.score / 9) * 100);
    var colors = { weak: '#ef4444', fair: '#f59e0b', good: '#22c55e', strong: '#10b981' };
    var color = colors[result.level];
    var labelKey = 'setPassword.strength.' + result.level;

    containerEl.innerHTML =
      '<div class="sratix-strength-meter">' +
        '<div class="sratix-strength-meter__bar">' +
          '<div class="sratix-strength-meter__fill" style="width:' + pct + '%;background:' + color + ';"></div>' +
        '</div>' +
        '<span class="sratix-strength-meter__label" style="color:' + color + ';">' + escHtml(t(labelKey)) + '</span>' +
      '</div>' +
      '<ul class="sratix-strength-checks">' +
        '<li class="' + (result.checks[0] ? 'pass' : 'fail') + '">' + escHtml(t('setPassword.req.minLength')) + '</li>' +
        '<li class="' + (result.checks[2] ? 'pass' : 'fail') + '">' + escHtml(t('setPassword.req.lowercase')) + '</li>' +
        '<li class="' + (result.checks[3] ? 'pass' : 'fail') + '">' + escHtml(t('setPassword.req.uppercase')) + '</li>' +
        '<li class="' + (result.checks[4] ? 'pass' : 'fail') + '">' + escHtml(t('setPassword.req.digit')) + '</li>' +
        '<li class="' + (result.checks[5] ? 'pass' : 'fail') + '">' + escHtml(t('setPassword.req.special')) + '</li>' +
        '<li class="' + (result.checks[1] ? 'pass' : 'fail') + '">' + escHtml(t('setPassword.req.longBonus')) + '</li>' +
      '</ul>';

    return result;
  }

  // ─── Set Password widget ─────────────────────────────────────────────────────

  async function initSetPasswordWidget() {
    const container = document.getElementById('sratix-set-password-widget');
    if (!container) return;

    var params = new URLSearchParams(window.location.search);
    var token = params.get('token');
    var isSetup = params.get('setup') === '1';
    var portalPath = container.dataset.portalPath || '/exhibitor-portal/';

    if (!token) {
      container.innerHTML = `
        <div class="sratix-set-password">
          <div class="sratix-set-password__card">
            <p class="sratix-error">${escHtml(t('setPassword.invalidLink'))}</p>
          </div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="sratix-set-password">
        <div class="sratix-set-password__card">
          <h2 class="sratix-set-password__title">${escHtml(isSetup ? t('setPassword.setupTitle') : t('setPassword.resetTitle'))}</h2>
          <p class="sratix-set-password__desc">${escHtml(isSetup ? t('setPassword.setupDesc') : t('setPassword.resetDesc'))}</p>
          <form class="sratix-set-password__form" autocomplete="on" method="post">
            <input type="hidden" id="sratix-set-email" name="username" autocomplete="username" value="" />
            <div class="sratix-form-field">
              <label for="sratix-new-password">${escHtml(t('setPassword.newPassword'))}</label>
              <input id="sratix-new-password" name="new-password" type="password" required minlength="8" autocomplete="new-password" />
              <div id="sratix-strength-display" class="sratix-strength-display"></div>
            </div>
            <div class="sratix-form-field">
              <label for="sratix-confirm-password">${escHtml(t('setPassword.confirmPassword'))}</label>
              <input id="sratix-confirm-password" name="confirm-password" type="password" required minlength="8" autocomplete="new-password" />
            </div>
            <div class="sratix-set-password__error" style="display:none;"></div>
            <button type="submit" class="sratix-btn sratix-btn--primary sratix-set-password__submit" disabled>
              ${escHtml(isSetup ? t('setPassword.setupBtn') : t('setPassword.resetBtn'))}
            </button>
          </form>
        </div>
      </div>`;

    var form = container.querySelector('.sratix-set-password__form');
    var errorEl = container.querySelector('.sratix-set-password__error');
    var submitBtn = container.querySelector('.sratix-set-password__submit');
    var pwInput = container.querySelector('#sratix-new-password');
    var pw2Input = container.querySelector('#sratix-confirm-password');
    var strengthDisplay = container.querySelector('#sratix-strength-display');
    var hiddenEmail = container.querySelector('#sratix-set-email');
    var currentStrength = { level: 'weak', score: 0 };

    // Live strength meter
    pwInput.addEventListener('input', function() {
      var pw = pwInput.value;
      if (pw.length === 0) {
        strengthDisplay.innerHTML = '';
        submitBtn.disabled = true;
        return;
      }
      currentStrength = renderStrengthMeter(strengthDisplay, pw, hiddenEmail.value);
      // Enable submit only if strength >= good (5/9)
      submitBtn.disabled = currentStrength.score < 5;
    });

    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var pw = pwInput.value;
      var pw2 = pw2Input.value;
      errorEl.style.display = 'none';

      if (currentStrength.score < 5) {
        errorEl.textContent = t('setPassword.tooWeak');
        errorEl.style.display = 'block';
        return;
      }
      if (pw !== pw2) {
        errorEl.textContent = t('setPassword.mismatch');
        errorEl.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = t('setPassword.saving');

      try {
        var result = await apiFetch('auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token: token, password: pw }),
        });

        var userEmail = result.email || '';

        // Populate hidden email field to trigger browser "Save Password" prompt
        if (userEmail) {
          hiddenEmail.value = userEmail;
          // Create a visible-to-browser-but-hidden-to-user credential form
          // so password managers detect the email + new-password pair
          var credFrame = document.createElement('form');
          credFrame.method = 'post';
          credFrame.action = '#';
          credFrame.style.cssText = 'position:absolute;left:-9999px;';
          credFrame.innerHTML =
            '<input type="text" name="username" autocomplete="username" value="' + escAttr(userEmail) + '" />' +
            '<input type="password" name="password" autocomplete="current-password" value="' + escAttr(pw) + '" />' +
            '<input type="submit" />';
          document.body.appendChild(credFrame);
          // Trigger submission to prompt password manager, then remove
          try { credFrame.querySelector('input[type="submit"]').click(); } catch (ignore) {}
          setTimeout(function() { credFrame.remove(); }, 500);
        }

        // Auto-login: call the login API to get auth tokens
        container.querySelector('.sratix-set-password__card').innerHTML = `
          <div class="sratix-set-password__success">
            <h2>${escHtml(t('setPassword.successTitle'))}</h2>
            <p>${escHtml(t('setPassword.successMsg'))}</p>
            <p class="sratix-set-password__redirect">${escHtml(t('setPassword.signingIn'))}</p>
          </div>`;

        if (userEmail) {
          try {
            var authRes = await apiFetch('auth/login', {
              method: 'POST',
              body: JSON.stringify({ email: userEmail, password: pw }),
            });
            // Store token and redirect to portal
            if (authRes.accessToken) {
              sessionStorage.setItem('sratix_access_token', authRes.accessToken);
              if (authRes.refreshToken) {
                sessionStorage.setItem('sratix_refresh_token', authRes.refreshToken);
              }
            }
          } catch (loginErr) {
            // Login failed — not critical, user can log in manually
          }
        }

        // Redirect to portal
        container.querySelector('.sratix-set-password__redirect').textContent = t('setPassword.redirecting');
        setTimeout(function() {
          window.location.href = portalPath;
        }, 1500);
      } catch (err) {
        var msg = (err.message || '').trim();
        if (msg.includes('TOKEN_CONSUMED')) {
          container.querySelector('.sratix-set-password__card').innerHTML = `
            <div class="sratix-set-password__success">
              <h2>${escHtml(t('setPassword.alreadySetTitle'))}</h2>
              <p>${escHtml(t('setPassword.alreadySetMsg'))}</p>
              <a href="${escAttr(portalPath)}" class="sratix-btn sratix-btn--primary" style="margin-top:16px;display:inline-block;text-decoration:none;">${escHtml(t('setPassword.goToPortal'))}</a>
            </div>`;
        } else {
          errorEl.textContent = t('setPassword.failed');
          errorEl.style.display = 'block';
          submitBtn.disabled = false;
          submitBtn.textContent = isSetup ? t('setPassword.setupBtn') : t('setPassword.resetBtn');
        }
      }
    });
  }

  // ─── Exhibitor Portal widget ──────────────────────────────────────────────────

  async function initExhibitorPortalWidget() {
    const container = document.getElementById('sratix-exhibitor-portal-widget');
    if (!container) return;

    const authMode = container.dataset.authMode || 'wp';
    const user = config.user;

    // If WP user available, use identity exchange (original flow)
    if (user && user.email) {
      return loadPortalWithWpAuth(container, user);
    }

    // No WP user — show app-native email+password login form
    if (authMode === 'app') {
      return renderPortalLoginForm(container);
    }

    // Fallback: old "please log in" message
    if (!container.querySelector('.sratix-auth-prompt')) {
      container.innerHTML = `<p class="sratix-info">${escHtml(t('exhibitorPortal.login'))}</p>`;
    }
  }

  /**
   * Render an email+password login form for the exhibitor portal.
   * Authenticates directly against the SRAtix API (POST /auth/login).
   */
  function renderPortalLoginForm(container) {
    var isPostPurchase = new URLSearchParams(window.location.search).get('sratix_success') === '1';

    container.innerHTML = `
      <div class="sratix-portal-login">
        <div class="sratix-portal-login__card">
          <h2 class="sratix-portal-login__title">${escHtml(t('exhibitorPortal.portalTitle'))}</h2>
          ${isPostPurchase ? '<div class="sratix-portal-login__notice">' + escHtml(t('exhibitorPortal.loginAfterPurchase')) + '</div>' : ''}
          <p class="sratix-portal-login__desc">${escHtml(t('exhibitorPortal.loginPrompt'))}</p>
          <form class="sratix-portal-login__form" autocomplete="on">
            <div class="sratix-form-field">
              <label for="sratix-portal-email">${escHtml(t('exhibitorPortal.emailLabel'))}</label>
              <input id="sratix-portal-email" type="email" required autocomplete="email" />
            </div>
            <div class="sratix-form-field">
              <label for="sratix-portal-password">${escHtml(t('exhibitorPortal.passwordLabel'))}</label>
              <input id="sratix-portal-password" type="password" required autocomplete="current-password" />
            </div>
            <div class="sratix-portal-login__error" style="display:none;"></div>
            <button type="submit" class="sratix-btn sratix-btn--primary sratix-portal-login__submit">
              ${escHtml(t('exhibitorPortal.loginBtn'))}
            </button>
          </form>
        </div>
      </div>`;

    const form = container.querySelector('.sratix-portal-login__form');
    const errorEl = container.querySelector('.sratix-portal-login__error');
    const submitBtn = container.querySelector('.sratix-portal-login__submit');

    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var email = container.querySelector('#sratix-portal-email').value.trim();
      var password = container.querySelector('#sratix-portal-password').value;
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = t('exhibitorPortal.loggingIn');

      try {
        var authRes = await apiFetch('auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: email, password: password }),
        });

        var authHeaders = { Authorization: 'Bearer ' + authRes.accessToken };

        // Fetch portal data
        var profile = await apiFetch('exhibitor-portal/profile', { headers: authHeaders });
        var events = await apiFetch('exhibitor-portal/events', { headers: authHeaders });

        renderExhibitorPortal(container, profile, events, authHeaders);
      } catch (err) {
        errorEl.textContent = err.message || t('exhibitorPortal.loginFailed');
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = t('exhibitorPortal.loginBtn');
      }
    });
  }

  /**
   * Original WP identity exchange flow for portal authentication.
   */
  async function loadPortalWithWpAuth(container, user) {
    container.innerHTML = `<p class="sratix-info">${escHtml(t('exhibitorPortal.loading'))}</p>`;

    try {
      // Authenticate via WP identity exchange
      const authRes = await apiFetch('auth/token', {
        method: 'POST',
        body: JSON.stringify({
          wpUserId: user.wpUserId,
          wpRoles: user.roles || [],
          signature: user.signature,
          sourceSite: user.sourceSite,
          email: user.email,
          displayName: (user.firstName || '') + (user.lastName ? ' ' + user.lastName : ''),
        }),
      });

      const authHeaders = { Authorization: `Bearer ${authRes.accessToken}` };

      // Fetch profile and events in parallel
      const [profile, events] = await Promise.all([
        apiFetch('exhibitor-portal/profile', { headers: authHeaders }),
        apiFetch('exhibitor-portal/events', { headers: authHeaders }),
      ]);

      renderExhibitorPortal(container, profile, events, authHeaders);
    } catch (err) {
      console.error('[SRAtix] Exhibitor portal error:', err);
      container.innerHTML = `<p class="sratix-error">${escHtml(t('exhibitorPortal.loadError'))}</p>`;
    }
  }

  /** Parse any YouTube/Shorts URL → embeddable URL, or null. */
  function parseYouTubeUrl(url) {
    if (!url) return null;
    var m = url.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
    return m ? 'https://www.youtube-nocookie.com/embed/' + m[1] : null;
  }

  /** Max video file-upload size (50 MB) — used in UI hints only; backend enforces. */
  var VIDEO_MAX_SIZE_MB = 50;

  // ─── Portal tab SVG icons (16×16, currentColor) ─────────────────────────────
  var PORTAL_ICONS = {
    profile: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 22V12h6v10"/><path d="M9 12V8l3-2 3 2v4"/></svg>',
    events: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>',
    staff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    media: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>',
    analytics: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    logistics: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8Z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    booth: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18l-2 9H5L3 3Z"/><path d="M5 12v8h14v-8"/><path d="M12 12v8"/><path d="M1 3h22"/></svg>',
    institution: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m12 .856l10 5.556V9H2V6.412L12 .856ZM5.06 7h13.88L12 3.144L5.06 7ZM7 11v8H5v-8h2Zm6 0v8h-2v-8h2Zm6 0v8h-2v-8h2ZM2 21h20v2H2v-2Z"/></svg>',
    tip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 1 4 12.7V17H8v-2.3A7 7 0 0 1 12 2Z"/></svg>',
    contact: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2Z"/><polyline points="22,6 12,13 2,6"/></svg>',
  };

  // ─── SRAtix brand logo SVG (inline, white, for portal header) ──────────────
  var SRATIX_BRAND_SVG = '<svg width="80" height="28" viewBox="0 0 120 42" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<text x="0" y="30" font-family="Outfit,system-ui,sans-serif" font-size="28" font-weight="700" fill="#e8edf4">SRAtix</text>' +
    '</svg>';

  function renderExhibitorPortal(container, profile, events, authHeaders) {
    const activeTab = sessionStorage.getItem('sratix_exhibitor_tab') || 'profile';

    const tabs = [
      { key: 'profile',    icon: PORTAL_ICONS.profile,   label: t('exhibitorPortal.tabProfile') },
      { key: 'events',     icon: PORTAL_ICONS.events,    label: t('exhibitorPortal.tabEvents') },
      { key: 'staff',      icon: PORTAL_ICONS.staff,     label: t('exhibitorPortal.tabStaff') },
      { key: 'media',      icon: PORTAL_ICONS.media,     label: t('exhibitorPortal.tabMedia') },
      { key: 'analytics',  icon: PORTAL_ICONS.analytics, label: t('exhibitorPortal.tabAnalytics') },
      { key: 'logistics',  icon: PORTAL_ICONS.logistics, label: t('exhibitorPortal.tabLogistics') },
      { key: 'contact',    icon: PORTAL_ICONS.contact,   label: t('exhibitorPortal.tabContact') },
    ];

    const hasLogo = !!profile.logoUrl;

    container.innerHTML = `
      <div class="sratix-exhibitor-portal">
        <div class="sratix-portal-header">
          <div class="sratix-portal-header__logo">
            ${hasLogo
              ? `<label class="sratix-portal-header__logo-wrap sratix-portal-header__logo-wrap--has-img" tabindex="0" title="${escAttr(t('exhibitorPortal.changeLogo'))}">
                  <img src="${escAttr(resolveApiUrl(profile.logoUrl))}" alt="${escAttr(profile.companyName || '')}" class="sratix-portal-header__logo-img" />
                  <span class="sratix-portal-header__logo-overlay">${escHtml(t('exhibitorPortal.changeLogo'))}</span>
                  <input type="file" accept="image/*" class="sratix-header-logo-input" hidden />
                </label>`
              : `<label class="sratix-portal-header__logo-wrap sratix-portal-header__logo-wrap--empty" tabindex="0">
                  <span class="sratix-portal-header__logo-ph">${escHtml(t('exhibitorPortal.uploadLogo'))}</span>
                  <input type="file" accept="image/*" class="sratix-header-logo-input" hidden />
                </label>`}
          </div>
          <div class="sratix-portal-header__text">
            <h1 class="sratix-portal-title">${escHtml(t('exhibitorPortal.portalTitle'))}</h1>
            <p class="sratix-portal-welcome">${escHtml(t('exhibitorPortal.portalWelcome', { name: profile.companyName || '' }))}</p>
          </div>
          <div class="sratix-portal-header__brand">
            ${SRATIX_BRAND_SVG}
            <button type="button" class="sratix-portal-logout" id="sratix-portal-logout" title="${escAttr(t('exhibitorPortal.logout'))}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>${escHtml(t('exhibitorPortal.logout'))}</span>
            </button>
          </div>
        </div>
        <nav class="sratix-portal-tabs" role="tablist">
          ${tabs.map(tab => `
            <button class="sratix-portal-tab ${activeTab === tab.key ? 'sratix-portal-tab--active' : ''}"
                    data-tab="${tab.key}" role="tab" aria-selected="${activeTab === tab.key}"
                    aria-controls="sratix-panel-${tab.key}">
              <span class="sratix-portal-tab__icon">${tab.icon}</span>
              <span class="sratix-portal-tab__label">${escHtml(tab.label)}</span>
            </button>
          `).join('')}
        </nav>
        <div class="sratix-portal-panel" id="sratix-panel-profile"
             style="${activeTab !== 'profile' ? 'display:none' : ''}">
        </div>
        <div class="sratix-portal-panel" id="sratix-panel-events"
             style="${activeTab !== 'events' ? 'display:none' : ''}">
        </div>
        <div class="sratix-portal-panel" id="sratix-panel-staff"
             style="${activeTab !== 'staff' ? 'display:none' : ''}">
        </div>
        <div class="sratix-portal-panel" id="sratix-panel-media"
             style="${activeTab !== 'media' ? 'display:none' : ''}">
        </div>
        <div class="sratix-portal-panel" id="sratix-panel-analytics"
             style="${activeTab !== 'analytics' ? 'display:none' : ''}">
        </div>
        <div class="sratix-portal-panel" id="sratix-panel-logistics"
             style="${activeTab !== 'logistics' ? 'display:none' : ''}">
        </div>
        <div class="sratix-portal-panel" id="sratix-panel-contact"
             style="${activeTab !== 'contact' ? 'display:none' : ''}">
        </div>
      </div>
    `;

    // Tab switching
    var portalEl = container.querySelector('.sratix-exhibitor-portal');
    if (portalEl) portalEl._sratixAuth = authHeaders;
    container.querySelectorAll('.sratix-portal-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        sessionStorage.setItem('sratix_exhibitor_tab', tab);
        container.querySelectorAll('.sratix-portal-tab').forEach(b => {
          b.classList.remove('sratix-portal-tab--active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('sratix-portal-tab--active');
        btn.setAttribute('aria-selected', 'true');
        container.querySelectorAll('.sratix-portal-panel').forEach(p => p.style.display = 'none');
        document.getElementById('sratix-panel-' + tab).style.display = '';
      });
    });

    // Header logo upload handler
    const headerLogoInput = container.querySelector('.sratix-header-logo-input');
    if (headerLogoInput) {
      headerLogoInput.addEventListener('change', async function () {
        const file = headerLogoInput.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
          await fetch(API_BASE + '/exhibitor-portal/profile/logo', {
            method: 'POST',
            headers: { Authorization: authHeaders.Authorization },
            body: formData,
          });
          const refreshed = await apiFetch('exhibitor-portal/profile', { headers: authHeaders });
          renderExhibitorPortal(container, refreshed, events, authHeaders);
        } catch (err) {
          console.error('[SRAtix] Header logo upload error:', err);
        }
      });
    }

    // Logout handler
    const logoutBtn = container.querySelector('#sratix-portal-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
        try {
          await fetch(API_BASE + '/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: authHeaders.Authorization },
          });
        } catch (_) { /* best-effort */ }
        if (config.logoutUrl) {
          window.location.href = config.logoutUrl;
        } else {
          window.location.reload();
        }
      });
    }

    renderProfilePanel(container.querySelector('#sratix-panel-profile'), profile, authHeaders);
    renderEventsPanel(container.querySelector('#sratix-panel-events'), events, authHeaders);
    renderStaffPanel(container.querySelector('#sratix-panel-staff'), events, authHeaders);
    renderMediaPanel(container.querySelector('#sratix-panel-media'), profile, events, authHeaders);
    renderAnalyticsPanel(container.querySelector('#sratix-panel-analytics'), events, authHeaders);
    renderLogisticsPanel(container.querySelector('#sratix-panel-logistics'), events, authHeaders);
    renderContactPanel(container.querySelector('#sratix-panel-contact'), profile, events, authHeaders);
  }

  function renderProfilePanel(panel, profile, authHeaders) {
    const social = profile.socialLinks || {};

    panel.innerHTML = `
      <form class="sratix-portal-form" id="sratix-profile-form">
        <div class="sratix-portal-logo-section">
          <div class="sratix-portal-logo-preview">
            ${profile.logoUrl
              ? `<img src="${escAttr(resolveApiUrl(profile.logoUrl))}" alt="Company logo" class="sratix-portal-logo-img" />`
              : `<div class="sratix-portal-logo-placeholder">${escHtml(t('exhibitorPortal.noLogo'))}</div>`}
          </div>
          <div class="sratix-portal-logo-actions">
            <label class="sratix-btn sratix-btn--outline sratix-btn--sm">
              ${escHtml(t('exhibitorPortal.uploadLogo'))}
              <input type="file" accept="image/*" id="sratix-logo-input" hidden />
            </label>
            ${profile.logoUrl
              ? `<button type="button" class="sratix-btn sratix-btn--ghost sratix-btn--sm" id="sratix-remove-logo">${escHtml(t('exhibitorPortal.removeLogo'))}</button>`
              : ''}
          </div>
        </div>

        <div class="sratix-portal-fields">
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.companyName'))} <span class="sratix-required">*</span></label>
            <input type="text" name="companyName" value="${escAttr(profile.companyName || '')}" required class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.legalName'))}</label>
            <input type="text" name="legalName" value="${escAttr(profile.legalName || '')}" class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.website'))}</label>
            <input type="url" name="website" value="${escAttr(profile.website || '')}" class="sratix-input" placeholder="https://" />
          </div>
          <div class="sratix-field-group sratix-field-group--full">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.description'))}</label>
            <textarea name="description" rows="4" class="sratix-input" maxlength="10000">${escHtml(profile.description || '')}</textarea>
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.contactEmail'))}</label>
            <input type="email" name="contactEmail" value="${escAttr(profile.contactEmail || '')}" class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.contactPhone'))}</label>
            <input type="tel" name="contactPhone" value="${escAttr(profile.contactPhone || '')}" class="sratix-input" />
          </div>
        </div>

        <fieldset class="sratix-portal-fieldset">
          <legend class="sratix-portal-legend">${escHtml(t('exhibitorPortal.socialLinks'))}</legend>
          <div class="sratix-portal-fields">
            <div class="sratix-field-group">
              <label class="sratix-label">LinkedIn</label>
              <input type="url" name="social_linkedin" value="${escAttr(social.linkedin || '')}" class="sratix-input" placeholder="https://linkedin.com/company/..." />
            </div>
            <div class="sratix-field-group">
              <label class="sratix-label">X / Twitter</label>
              <input type="url" name="social_twitter" value="${escAttr(social.twitter || '')}" class="sratix-input" placeholder="https://x.com/..." />
            </div>
            <div class="sratix-field-group">
              <label class="sratix-label">YouTube</label>
              <input type="url" name="social_youtube" value="${escAttr(social.youtube || '')}" class="sratix-input" placeholder="https://youtube.com/..." />
            </div>
            <div class="sratix-field-group">
              <label class="sratix-label">Instagram</label>
              <input type="url" name="social_instagram" value="${escAttr(social.instagram || '')}" class="sratix-input" placeholder="https://instagram.com/..." />
            </div>
          </div>
        </fieldset>

        <div class="sratix-portal-actions">
          <button type="submit" class="sratix-btn sratix-btn--primary" id="sratix-save-profile">
            ${escHtml(t('exhibitorPortal.saveProfile'))}
          </button>
          <span class="sratix-portal-status" id="sratix-profile-status"></span>
        </div>
      </form>
    `;

    // Logo upload
    const logoInput = panel.querySelector('#sratix-logo-input');
    logoInput.addEventListener('change', async () => {
      const file = logoInput.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch(API_BASE + '/exhibitor-portal/profile/logo', {
          method: 'POST',
          headers: { Authorization: authHeaders.Authorization },
          body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        await res.json();
        // Re-fetch full profile and re-render panel + header logo
        const refreshed = await apiFetch('exhibitor-portal/profile', { headers: authHeaders });
        renderProfilePanel(panel, refreshed, authHeaders);
        syncHeaderLogo(panel, refreshed);
      } catch (err) {
        console.error('[SRAtix] Logo upload error:', err);
        showStatus(panel.querySelector('#sratix-profile-status'), t('exhibitorPortal.logoUploadError'), true);
      }
    });

    // Logo remove
    const removeBtn = panel.querySelector('#sratix-remove-logo');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        try {
          await apiFetch('exhibitor-portal/profile/logo', {
            method: 'DELETE',
            headers: authHeaders,
          });
          const refreshed = await apiFetch('exhibitor-portal/profile', { headers: authHeaders });
          renderProfilePanel(panel, refreshed, authHeaders);
          syncHeaderLogo(panel, refreshed);
        } catch (err) {
          console.error('[SRAtix] Logo remove error:', err);
        }
      });
    }

    // Profile save
    panel.querySelector('#sratix-profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const saveBtn = form.querySelector('#sratix-save-profile');
      const statusEl = form.querySelector('#sratix-profile-status');
      saveBtn.disabled = true;

      const body = {
        companyName: form.companyName.value.trim(),
        legalName: form.legalName.value.trim() || undefined,
        website: form.website.value.trim() || undefined,
        description: form.description.value.trim() || undefined,
        contactEmail: form.contactEmail.value.trim() || undefined,
        contactPhone: form.contactPhone.value.trim() || undefined,
        socialLinks: {
          linkedin: form.social_linkedin.value.trim() || undefined,
          twitter: form.social_twitter.value.trim() || undefined,
          youtube: form.social_youtube.value.trim() || undefined,
          instagram: form.social_instagram.value.trim() || undefined,
        },
      };

      try {
        await apiFetch('exhibitor-portal/profile', {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify(body),
        });
        showStatus(statusEl, t('exhibitorPortal.saved'), false);
      } catch (err) {
        console.error('[SRAtix] Profile save error:', err);
        showStatus(statusEl, t('exhibitorPortal.saveError'), true);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  function renderEventsPanel(panel, events, authHeaders) {
    if (!events || events.length === 0) {
      panel.innerHTML = `<p class="sratix-info">${escHtml(t('exhibitorPortal.noEvents'))}</p>`;
      return;
    }

    panel.innerHTML = events.map(ev => `
      <div class="sratix-event-card" data-event-id="${escAttr(ev.eventId)}">
        <div class="sratix-event-card__header">
          <h3 class="sratix-event-card__title">${escHtml(ev.event?.name || ev.eventId)}</h3>
          <span class="sratix-badge sratix-badge--${ev.status === 'confirmed' ? 'valid' : 'pending'}">
            ${escHtml(ev.status || 'draft')}
          </span>
        </div>
        <div class="sratix-portal-info-box">
          <span class="sratix-portal-info-box__icon">${PORTAL_ICONS.tip}</span>
          <p>${escHtml(t('exhibitorPortal.boothAssignedByOrganizers'))}</p>
        </div>
        <div class="sratix-portal-fields sratix-portal-fields--readonly">
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.boothNumber'))}</label>
            <div class="sratix-readonly-value">${escHtml(ev.boothNumber || '—')}</div>
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.expoArea'))}</label>
            <div class="sratix-readonly-value">${escHtml(ev.expoArea || '—')}</div>
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.exhibitorCategory'))}</label>
            <div class="sratix-readonly-value">${escHtml(ev.exhibitorCategory || '—')}</div>
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.exhibitorType'))}</label>
            <div class="sratix-readonly-value">${escHtml(ev.exhibitorType || '—')}</div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // ─── Staff panel ───────────────────────────────────────────────────────────

  function renderStaffPanel(panel, events, authHeaders) {
    if (!events || events.length === 0) {
      panel.innerHTML = `<p class="sratix-info">${escHtml(t('exhibitorPortal.noEvents'))}</p>`;
      return;
    }

    // Staff panel is per-event; show first event with selector if multiple
    const selectedEventId = events[0].eventId;
    renderStaffForEvent(panel, selectedEventId, events, authHeaders);
  }

  async function renderStaffForEvent(panel, eventId, events, authHeaders) {
    const ev = events.find(e => e.eventId === eventId);
    const eventName = ev?.event?.name || eventId;

    panel.innerHTML = `
      <div class="sratix-staff-panel">
        ${events.length > 1
          ? `<div class="sratix-field-group">
               <label class="sratix-label">${escHtml(t('exhibitorPortal.selectEvent'))}</label>
               <select class="sratix-input" id="sratix-staff-event-select">
                 ${events.map(e => `<option value="${escAttr(e.eventId)}" ${e.eventId === eventId ? 'selected' : ''}>${escHtml(e.event?.name || e.eventId)}</option>`).join('')}
               </select>
             </div>`
          : `<h3 class="sratix-staff-panel__title">${escHtml(eventName)}</h3>`}
        <div id="sratix-staff-list">
          <p class="sratix-info">${escHtml(t('exhibitorPortal.loading'))}</p>
        </div>
      </div>
    `;

    // Event selector handler
    const eventSelect = panel.querySelector('#sratix-staff-event-select');
    if (eventSelect) {
      eventSelect.addEventListener('change', () => {
        renderStaffForEvent(panel, eventSelect.value, events, authHeaders);
      });
    }

    try {
      const staffList = await apiFetch(`exhibitor-portal/events/${eventId}/staff`, { headers: authHeaders });
      renderStaffList(panel.querySelector('#sratix-staff-list'), eventId, staffList, authHeaders);
    } catch (err) {
      console.error('[SRAtix] Staff load error:', err);
      panel.querySelector('#sratix-staff-list').innerHTML = `<p class="sratix-error">${escHtml(t('exhibitorPortal.staffLoadError'))}</p>`;
    }
  }

  function renderStaffList(container, eventId, staffList, authHeaders) {
    const passStatusBadge = (status) => {
      const cls = status === 'registered' || status === 'checked_in' ? 'valid' : (status === 'invited' ? 'pending' : 'default');
      return `<span class="sratix-badge sratix-badge--${cls}">${escHtml(status)}</span>`;
    };

    let html = `
      <div class="sratix-staff-header">
        <span class="sratix-staff-count">${staffList.length} ${escHtml(t('exhibitorPortal.staffMembers'))}</span>
        <button type="button" class="sratix-btn sratix-btn--primary sratix-btn--sm" id="sratix-add-staff">
          + ${escHtml(t('exhibitorPortal.addStaff'))}
        </button>
      </div>
    `;

    if (staffList.length > 0) {
      html += `<div class="sratix-staff-table-wrap"><table class="sratix-staff-table">
        <thead>
          <tr>
            <th>${escHtml(t('exhibitorPortal.staffName'))}</th>
            <th>${escHtml(t('exhibitorPortal.staffEmail'))}</th>
            <th>${escHtml(t('exhibitorPortal.staffRole'))}</th>
            <th>${escHtml(t('exhibitorPortal.staffPass'))}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${staffList.map(s => `
            <tr data-staff-id="${escAttr(s.id)}">
              <td>${escHtml(s.firstName)} ${escHtml(s.lastName)}</td>
              <td>${escHtml(s.email)}</td>
              <td>${escHtml(s.role)}</td>
              <td>${passStatusBadge(s.passStatus)}</td>
              <td class="sratix-staff-actions">
                ${s.passStatus === 'pending' ? `<button type="button" class="sratix-btn sratix-btn--outline sratix-btn--xs" data-action="invite">${escHtml(t('exhibitorPortal.inviteStaff'))}</button>` : ''}
                <button type="button" class="sratix-btn sratix-btn--ghost sratix-btn--xs" data-action="edit">✎</button>
                <button type="button" class="sratix-btn sratix-btn--ghost sratix-btn--xs sratix-btn--danger" data-action="remove">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>`;
    }

    html += `
      <div id="sratix-staff-form-area" style="display:none"></div>
      <span class="sratix-portal-status" id="sratix-staff-status"></span>
    `;

    container.innerHTML = html;

    // Add staff button
    container.querySelector('#sratix-add-staff').addEventListener('click', () => {
      showStaffForm(container, eventId, null, authHeaders);
    });

    // Per-row actions
    container.querySelectorAll('tr[data-staff-id]').forEach(row => {
      const staffId = row.dataset.staffId;
      const staff = staffList.find(s => s.id === staffId);

      const inviteBtn = row.querySelector('[data-action="invite"]');
      if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
          inviteBtn.disabled = true;
          try {
            await apiFetch(`exhibitor-portal/events/${eventId}/staff/${staffId}/invite`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ registrationBaseUrl: window.location.origin + '/register' }),
            });
            showStatus(container.querySelector('#sratix-staff-status'), t('exhibitorPortal.staffInvited'), false);
            // Refresh list
            const refreshed = await apiFetch(`exhibitor-portal/events/${eventId}/staff`, { headers: authHeaders });
            renderStaffList(container, eventId, refreshed, authHeaders);
          } catch (err) {
            showStatus(container.querySelector('#sratix-staff-status'), err.message || t('exhibitorPortal.staffInviteError'), true);
            inviteBtn.disabled = false;
          }
        });
      }

      const editBtn = row.querySelector('[data-action="edit"]');
      if (editBtn) {
        editBtn.addEventListener('click', () => {
          showStaffForm(container, eventId, staff, authHeaders);
        });
      }

      const removeBtn = row.querySelector('[data-action="remove"]');
      if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
          if (!confirm(t('exhibitorPortal.confirmRemoveStaff'))) return;
          try {
            await apiFetch(`exhibitor-portal/events/${eventId}/staff/${staffId}`, {
              method: 'DELETE',
              headers: authHeaders,
            });
            const refreshed = await apiFetch(`exhibitor-portal/events/${eventId}/staff`, { headers: authHeaders });
            renderStaffList(container, eventId, refreshed, authHeaders);
          } catch (err) {
            showStatus(container.querySelector('#sratix-staff-status'), err.message || t('exhibitorPortal.saveError'), true);
          }
        });
      }
    });
  }

  function showStaffForm(container, eventId, existingStaff, authHeaders) {
    const formArea = container.querySelector('#sratix-staff-form-area');
    const isEdit = !!existingStaff;

    formArea.style.display = '';
    formArea.innerHTML = `
      <form class="sratix-portal-form sratix-staff-form" id="sratix-staff-inline-form">
        <h4 class="sratix-staff-form__title">${escHtml(isEdit ? t('exhibitorPortal.editStaff') : t('exhibitorPortal.addStaff'))}</h4>
        <div class="sratix-portal-fields">
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.staffFirstName'))} <span class="sratix-required">*</span></label>
            <input type="text" name="firstName" value="${escAttr(existingStaff?.firstName || '')}" required class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.staffLastName'))} <span class="sratix-required">*</span></label>
            <input type="text" name="lastName" value="${escAttr(existingStaff?.lastName || '')}" required class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.staffEmail'))} <span class="sratix-required">*</span></label>
            <input type="email" name="email" value="${escAttr(existingStaff?.email || '')}" required class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.staffPhone'))}</label>
            <input type="tel" name="phone" value="${escAttr(existingStaff?.phone || '')}" class="sratix-input" />
          </div>
          <div class="sratix-field-group">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.staffRole'))}</label>
            <select name="role" class="sratix-input">
              <option value="staff" ${existingStaff?.role === 'staff' || !existingStaff ? 'selected' : ''}>${escHtml(t('exhibitorPortal.roleStaff'))}</option>
              <option value="booth_manager" ${existingStaff?.role === 'booth_manager' ? 'selected' : ''}>${escHtml(t('exhibitorPortal.roleBoothManager'))}</option>
              <option value="demo_presenter" ${existingStaff?.role === 'demo_presenter' ? 'selected' : ''}>${escHtml(t('exhibitorPortal.roleDemoPresenter'))}</option>
            </select>
          </div>
        </div>
        <div class="sratix-portal-actions">
          <button type="submit" class="sratix-btn sratix-btn--primary sratix-btn--sm">
            ${escHtml(isEdit ? t('exhibitorPortal.saveEvent') : t('exhibitorPortal.addStaff'))}
          </button>
          <button type="button" class="sratix-btn sratix-btn--ghost sratix-btn--sm" id="sratix-staff-cancel">
            ${escHtml(t('exhibitorPortal.cancel'))}
          </button>
        </div>
      </form>
    `;

    formArea.querySelector('#sratix-staff-cancel').addEventListener('click', () => {
      formArea.style.display = 'none';
      formArea.innerHTML = '';
    });

    formArea.querySelector('#sratix-staff-inline-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;

      const body = {
        firstName: form.firstName.value.trim(),
        lastName: form.lastName.value.trim(),
        email: form.email.value.trim(),
        phone: form.phone.value.trim() || undefined,
        role: form.role.value,
      };

      try {
        if (isEdit) {
          await apiFetch(`exhibitor-portal/events/${eventId}/staff/${existingStaff.id}`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify(body),
          });
        } else {
          await apiFetch(`exhibitor-portal/events/${eventId}/staff`, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(body),
          });
        }
        formArea.style.display = 'none';
        formArea.innerHTML = '';
        const refreshed = await apiFetch(`exhibitor-portal/events/${eventId}/staff`, { headers: authHeaders });
        renderStaffList(container, eventId, refreshed, authHeaders);
      } catch (err) {
        showStatus(container.querySelector('#sratix-staff-status'), err.message || t('exhibitorPortal.saveError'), true);
        btn.disabled = false;
      }
    });

    // Scroll form into view
    formArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ─── Media panel ──────────────────────────────────────────────────────────

  function renderMediaPanel(panel, profile, events, authHeaders) {
    // ── Section 1: Booth Demo (event-scoped) ──
    // ── Section 2: Exhibitor Media (profile-scoped) ──

    const profileGallery = Array.isArray(profile.mediaGallery) ? profile.mediaGallery : [];
    const profileVideos  = Array.isArray(profile.videoLinks) ? profile.videoLinks : [];

    // Use first event with demo data (or first event)
    const ev = events && events.length > 0 ? events[0] : null;
    const demoGallery = ev && Array.isArray(ev.demoMediaGallery) ? ev.demoMediaGallery : [];
    const demoVideos  = ev && Array.isArray(ev.demoVideoLinks)  ? ev.demoVideoLinks  : [];

    panel.innerHTML = `
      <div class="sratix-media-panel">

        <!-- ═══ SECTION 1: BOOTH DEMO ═══ -->
        <section class="sratix-media-section">
          <div class="sratix-media-section__header">
            <h3 class="sratix-media-section__title"><span class="sratix-media-section__icon">${PORTAL_ICONS.booth}</span> ${escHtml(t('exhibitorPortal.demoMediaTitle'))}</h3>
            <p class="sratix-media-section__desc">${escHtml(t('exhibitorPortal.demoMediaDesc'))}</p>
            <div class="sratix-media-tip">
              <span class="sratix-media-tip__icon">${PORTAL_ICONS.tip}</span>
              <span>${escHtml(t('exhibitorPortal.demoMediaTip'))}</span>
            </div>
          </div>

          ${ev ? `
          <div class="sratix-field-group sratix-field-group--full">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.demoTitle'))}</label>
            <input type="text" id="sratix-demo-title" value="${escAttr(ev.demoTitle || '')}" class="sratix-input" maxlength="255" />
          </div>
          <div class="sratix-field-group sratix-field-group--full">
            <label class="sratix-label">${escHtml(t('exhibitorPortal.demoDescription'))}</label>
            <textarea id="sratix-demo-desc" rows="3" class="sratix-input" maxlength="10000">${escHtml(ev.demoDescription || '')}</textarea>
          </div>

          <h4 class="sratix-media-sub-title">${escHtml(t('exhibitorPortal.demoImages'))}</h4>
          <div class="sratix-media-gallery" id="sratix-demo-gallery">
            ${renderGalleryItems(demoGallery, 'demo')}
          </div>
          <div class="sratix-media-add">
            <div class="sratix-field-group">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.chooseImage'))}</label>
              <input type="file" id="sratix-add-demo-image-file" class="sratix-input" accept="image/*" />
            </div>
            <div class="sratix-field-group">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.imageCaption'))}</label>
              <input type="text" id="sratix-add-demo-image-caption" class="sratix-input" maxlength="200" />
            </div>
            <button type="button" class="sratix-btn sratix-btn--outline sratix-btn--sm" id="sratix-add-demo-image-btn">
              + ${escHtml(t('exhibitorPortal.uploadImage'))}
            </button>
            <span class="sratix-portal-status" id="sratix-demo-upload-status"></span>
          </div>

          <h4 class="sratix-media-sub-title">${escHtml(t('exhibitorPortal.demoVideos'))}</h4>
          <p class="sratix-portal-hint">${escHtml(t('exhibitorPortal.videoHint', { maxMb: VIDEO_MAX_SIZE_MB }))}</p>
          <div id="sratix-demo-video-list">
            ${demoVideos.map((url, i) => renderVideoRow('demo', url, i)).join('')}
          </div>
          <div class="sratix-media-add">
            <div class="sratix-field-group sratix-field-group--grow">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.videoUrlOrYt'))}</label>
              <input type="url" id="sratix-add-demo-video-url" class="sratix-input" placeholder="https://youtube.com/watch?v=... or https://..." />
            </div>
            <button type="button" class="sratix-btn sratix-btn--outline sratix-btn--sm" id="sratix-add-demo-video-btn">
              + ${escHtml(t('exhibitorPortal.addVideo'))}
            </button>
          </div>

          <div class="sratix-portal-actions">
            <button type="button" class="sratix-btn sratix-btn--primary" id="sratix-save-demo-media">
              ${escHtml(t('exhibitorPortal.saveDemoMedia'))}
            </button>
            <span class="sratix-portal-status" id="sratix-demo-media-status"></span>
          </div>
          ` : `<p class="sratix-info">${escHtml(t('exhibitorPortal.noEvents'))}</p>`}
        </section>

        <!-- ═══ SECTION 2: EXHIBITOR MEDIA ═══ -->
        <section class="sratix-media-section">
          <div class="sratix-media-section__header">
            <h3 class="sratix-media-section__title"><span class="sratix-media-section__icon">${PORTAL_ICONS.institution}</span> ${escHtml(t('exhibitorPortal.exhibitorMediaTitle'))}</h3>
            <p class="sratix-media-section__desc">${escHtml(t('exhibitorPortal.exhibitorMediaDesc'))}</p>
          </div>

          <h4 class="sratix-media-sub-title">${escHtml(t('exhibitorPortal.companyImages'))}</h4>
          <div class="sratix-media-gallery" id="sratix-profile-gallery">
            ${renderGalleryItems(profileGallery, 'profile')}
          </div>
          <div class="sratix-media-add">
            <div class="sratix-field-group">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.chooseImage'))}</label>
              <input type="file" id="sratix-add-image-file" class="sratix-input" accept="image/*" />
            </div>
            <div class="sratix-field-group">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.imageCaption'))}</label>
              <input type="text" id="sratix-add-image-caption" class="sratix-input" maxlength="200" />
            </div>
            <button type="button" class="sratix-btn sratix-btn--outline sratix-btn--sm" id="sratix-add-image-btn">
              + ${escHtml(t('exhibitorPortal.uploadImage'))}
            </button>
            <span class="sratix-portal-status" id="sratix-profile-upload-status"></span>
          </div>

          <h4 class="sratix-media-sub-title">${escHtml(t('exhibitorPortal.companyVideos'))}</h4>
          <p class="sratix-portal-hint">${escHtml(t('exhibitorPortal.videoHint', { maxMb: VIDEO_MAX_SIZE_MB }))}</p>
          <div id="sratix-video-links-list">
            ${profileVideos.map((url, i) => renderVideoRow('profile', url, i)).join('')}
          </div>
          <div class="sratix-media-add">
            <div class="sratix-field-group sratix-field-group--grow">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.videoUrlOrYt'))}</label>
              <input type="url" id="sratix-add-video-url" class="sratix-input" placeholder="https://youtube.com/watch?v=... or https://..." />
            </div>
            <button type="button" class="sratix-btn sratix-btn--outline sratix-btn--sm" id="sratix-add-video-btn">
              + ${escHtml(t('exhibitorPortal.addVideo'))}
            </button>
          </div>

          <div class="sratix-portal-actions">
            <button type="button" class="sratix-btn sratix-btn--primary" id="sratix-save-media">
              ${escHtml(t('exhibitorPortal.saveMedia'))}
            </button>
            <span class="sratix-portal-status" id="sratix-media-status"></span>
          </div>
        </section>
      </div>
    `;

    // ── Local state ──
    var currentDemoGallery = [...demoGallery];
    var currentDemoVideos  = [...demoVideos];
    var currentGallery     = [...profileGallery];
    var currentVideos      = [...profileVideos];

    /** Upload image file to server and add to gallery */
    async function uploadImageToGallery(scope, fileInput, captionInput, statusEl) {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        showStatus(statusEl, t('exhibitorPortal.onlyImages'), true);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showStatus(statusEl, t('exhibitorPortal.fileTooLarge'), true);
        return;
      }
      var fd = new FormData();
      fd.append('file', file);
      fd.append('caption', captionInput.value.trim());
      var endpoint = scope === 'demo'
        ? 'exhibitor-portal/events/' + ev.eventId + '/media/upload'
        : 'exhibitor-portal/profile/media/upload';
      statusEl.textContent = t('exhibitorPortal.uploading');
      statusEl.className = 'sratix-portal-status';
      try {
        var item = await apiFetch(endpoint, { method: 'POST', headers: authHeaders, body: fd });
        if (scope === 'demo') {
          currentDemoGallery.push(item);
          refreshGalleryDisplay(panel.querySelector('#sratix-demo-gallery'), currentDemoGallery, 'demo');
        } else {
          currentGallery.push(item);
          refreshGalleryDisplay(panel.querySelector('#sratix-profile-gallery'), currentGallery, 'profile');
        }
        fileInput.value = '';
        captionInput.value = '';
        showStatus(statusEl, t('exhibitorPortal.imageUploaded'), false);
        bindAllMediaRemoveHandlers(panel, currentDemoGallery, currentDemoVideos, currentGallery, currentVideos, authHeaders, ev);
      } catch (err) {
        showStatus(statusEl, err.message || t('exhibitorPortal.saveError'), true);
      }
    }

    // ── Demo section handlers ──
    if (ev) {
      panel.querySelector('#sratix-add-demo-image-btn').addEventListener('click', function () {
        uploadImageToGallery(
          'demo',
          panel.querySelector('#sratix-add-demo-image-file'),
          panel.querySelector('#sratix-add-demo-image-caption'),
          panel.querySelector('#sratix-demo-upload-status')
        );
      });

      panel.querySelector('#sratix-add-demo-video-btn').addEventListener('click', function () {
        var urlInput = panel.querySelector('#sratix-add-demo-video-url');
        var raw = urlInput.value.trim();
        if (!raw) return;
        currentDemoVideos.push(raw);
        urlInput.value = '';
        refreshVideoDisplay(panel.querySelector('#sratix-demo-video-list'), currentDemoVideos, 'demo');
        bindAllMediaRemoveHandlers(panel, currentDemoGallery, currentDemoVideos, currentGallery, currentVideos, authHeaders, ev);
      });

      panel.querySelector('#sratix-save-demo-media').addEventListener('click', async function () {
        var btn = panel.querySelector('#sratix-save-demo-media');
        var statusEl = panel.querySelector('#sratix-demo-media-status');
        btn.disabled = true;
        try {
          var body = {
            demoTitle: panel.querySelector('#sratix-demo-title').value.trim() || undefined,
            demoDescription: panel.querySelector('#sratix-demo-desc').value.trim() || undefined,
          };
          // Save event details (demo title/desc)
          await apiFetch('exhibitor-portal/events/' + ev.eventId + '/details', {
            method: 'PUT', headers: authHeaders, body: JSON.stringify(body),
          });
          // Save video links
          await apiFetch('exhibitor-portal/events/' + ev.eventId + '/media', {
            method: 'PUT', headers: authHeaders,
            body: JSON.stringify({ mediaGallery: currentDemoGallery, videoLinks: currentDemoVideos }),
          });
          showStatus(statusEl, t('exhibitorPortal.saved'), false);
        } catch (err) {
          showStatus(statusEl, err.message || t('exhibitorPortal.saveError'), true);
        } finally { btn.disabled = false; }
      });
    }

    // ── Profile media handlers ──
    panel.querySelector('#sratix-add-image-btn').addEventListener('click', function () {
      uploadImageToGallery(
        'profile',
        panel.querySelector('#sratix-add-image-file'),
        panel.querySelector('#sratix-add-image-caption'),
        panel.querySelector('#sratix-profile-upload-status')
      );
    });

    panel.querySelector('#sratix-add-video-btn').addEventListener('click', function () {
      var urlInput = panel.querySelector('#sratix-add-video-url');
      var raw = urlInput.value.trim();
      if (!raw) return;
      currentVideos.push(raw);
      urlInput.value = '';
      refreshVideoDisplay(panel.querySelector('#sratix-video-links-list'), currentVideos, 'profile');
      bindAllMediaRemoveHandlers(panel, currentDemoGallery, currentDemoVideos, currentGallery, currentVideos, authHeaders, ev);
    });

    panel.querySelector('#sratix-save-media').addEventListener('click', async function () {
      var btn = panel.querySelector('#sratix-save-media');
      var statusEl = panel.querySelector('#sratix-media-status');
      btn.disabled = true;
      try {
        await apiFetch('exhibitor-portal/profile/media', {
          method: 'PUT', headers: authHeaders,
          body: JSON.stringify({ mediaGallery: currentGallery, videoLinks: currentVideos }),
        });
        showStatus(statusEl, t('exhibitorPortal.saved'), false);
      } catch (err) {
        showStatus(statusEl, err.message || t('exhibitorPortal.saveError'), true);
      } finally { btn.disabled = false; }
    });

    bindAllMediaRemoveHandlers(panel, currentDemoGallery, currentDemoVideos, currentGallery, currentVideos, authHeaders, ev);
  }

  /** Render a single video row with YouTube embed preview when applicable. */
  function renderVideoRow(scope, url, index) {
    const embedUrl = parseYouTubeUrl(url);
    let preview = '';
    if (embedUrl) {
      preview = `<div class="sratix-video-embed-preview">
        <iframe src="${escAttr(embedUrl)}" width="280" height="158" frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen loading="lazy" title="Video preview"></iframe>
      </div>`;
    }
    return `<div class="sratix-video-link-row" data-scope="${scope}" data-index="${index}">
      <div class="sratix-video-link-content">
        <input type="url" value="${escAttr(url)}" class="sratix-input sratix-video-link-input" readonly />
        ${embedUrl ? '<span class="sratix-badge sratix-badge--valid sratix-badge--xs">YouTube</span>' : ''}
      </div>
      <button type="button" class="sratix-btn sratix-btn--ghost sratix-btn--xs sratix-btn--danger" data-action="remove-video" data-scope="${scope}" data-index="${index}">✕</button>
      ${preview}
    </div>`;
  }

  function renderGalleryItems(gallery, scope) {
    return gallery.map(function (item, i) {
      var imgSrc = item.url && (item.url.startsWith('http') ? item.url : resolveApiUrl(item.url));
      return '<div class="sratix-media-item" data-index="' + i + '"' +
        (item.fileId ? ' data-file-id="' + escAttr(item.fileId) + '"' : '') + '>' +
        '<img src="' + escAttr(imgSrc) + '" alt="' + escAttr(item.caption || '') + '" class="sratix-media-thumb" />' +
        '<button type="button" class="sratix-media-remove" data-scope="' + scope + '" data-index="' + i + '" title="' + escHtml(t('exhibitorPortal.remove')) + '">✕</button>' +
        '</div>';
    }).join('');
  }

  function refreshGalleryDisplay(container, gallery, scope) {
    container.innerHTML = renderGalleryItems(gallery, scope);
  }

  function refreshVideoDisplay(container, videos, scope) {
    container.innerHTML = videos.map((url, i) => renderVideoRow(scope, url, i)).join('');
  }

  function bindAllMediaRemoveHandlers(panel, demoGallery, demoVideos, profileGallery, profileVideos, authHeaders, ev) {
    panel.querySelectorAll('.sratix-media-remove').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var scope = btn.dataset.scope;
        var idx = parseInt(btn.dataset.index, 10);
        var gallery = scope === 'demo' ? demoGallery : profileGallery;
        var item = gallery[idx];

        // If the item was file-uploaded, delete from server
        if (item && item.fileId) {
          try {
            var endpoint = scope === 'demo'
              ? 'exhibitor-portal/events/' + ev.eventId + '/media/' + item.fileId
              : 'exhibitor-portal/profile/media/' + item.fileId;
            await apiFetch(endpoint, { method: 'DELETE', headers: authHeaders });
          } catch (e) {
            // Continue removing from local state even on error
          }
        }

        gallery.splice(idx, 1);
        if (scope === 'demo') {
          refreshGalleryDisplay(panel.querySelector('#sratix-demo-gallery'), demoGallery, 'demo');
        } else {
          refreshGalleryDisplay(panel.querySelector('#sratix-profile-gallery'), profileGallery, 'profile');
        }
        bindAllMediaRemoveHandlers(panel, demoGallery, demoVideos, profileGallery, profileVideos, authHeaders, ev);
      });
    });

    panel.querySelectorAll('[data-action="remove-video"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var scope = btn.dataset.scope;
        var idx = parseInt(btn.dataset.index, 10);
        if (scope === 'demo') {
          demoVideos.splice(idx, 1);
          refreshVideoDisplay(panel.querySelector('#sratix-demo-video-list'), demoVideos, 'demo');
        } else {
          profileVideos.splice(idx, 1);
          refreshVideoDisplay(panel.querySelector('#sratix-video-links-list'), profileVideos, 'profile');
        }
        bindAllMediaRemoveHandlers(panel, demoGallery, demoVideos, profileGallery, profileVideos, authHeaders, ev);
      });
    });
  }

  // ── Analytics Panel (Phase 1d) ──────────────────────────────────────

  function renderAnalyticsPanel(panel, events, authHeaders) {
    if (!events || events.length === 0) {
      panel.innerHTML = `<p class="sratix-portal-empty">${escHtml(t('exhibitorPortal.noEvents'))}</p>`;
      return;
    }

    let html = `<div class="sratix-analytics-panel">
      <label class="sratix-label">${escHtml(t('exhibitorPortal.selectEvent'))}</label>
      <select class="sratix-input" id="sratix-analytics-event-select">
        <option value="">—</option>
        ${events.map(ev => `<option value="${escAttr(ev.eventId)}">${escHtml(ev.event?.name || ev.eventId)}</option>`).join('')}
      </select>
      <div id="sratix-analytics-content"></div>
    </div>`;
    panel.innerHTML = html;

    panel.querySelector('#sratix-analytics-event-select').addEventListener('change', function () {
      const eventId = this.value;
      const content = panel.querySelector('#sratix-analytics-content');
      if (!eventId) { content.innerHTML = ''; return; }
      loadAnalytics(content, eventId, authHeaders);
    });
  }

  async function loadAnalytics(container, eventId, authHeaders) {
    container.innerHTML = `<p class="sratix-loading">${escHtml(t('common.loading'))}</p>`;

    try {
      const data = await apiFetch('exhibitor-portal/events/' + eventId + '/kpis', { headers: authHeaders });

      let html = `
        <div class="sratix-kpi-cards">
          <div class="sratix-kpi-card">
            <div class="sratix-kpi-value">${data.summary.totalScans}</div>
            <div class="sratix-kpi-label">${escHtml(t('exhibitorPortal.totalScans'))}</div>
          </div>
          <div class="sratix-kpi-card">
            <div class="sratix-kpi-value">${data.summary.uniqueVisitors}</div>
            <div class="sratix-kpi-label">${escHtml(t('exhibitorPortal.uniqueVisitors'))}</div>
          </div>
          <div class="sratix-kpi-card">
            <div class="sratix-kpi-value">${data.summary.totalLeads}</div>
            <div class="sratix-kpi-label">${escHtml(t('exhibitorPortal.totalLeads'))}</div>
          </div>
        </div>
      `;

      // Booth QR section
      html += `
        <div class="sratix-booth-qr-section">
          <h4>${escHtml(t('exhibitorPortal.boothQrCode'))}</h4>
          <p class="sratix-portal-hint">${escHtml(t('exhibitorPortal.boothQrHint'))}</p>
          <div class="sratix-qr-toggle-row">
            <button class="sratix-btn sratix-btn--outline sratix-btn--sm sratix-btn--active" id="sratix-show-qr-image-btn">
              ${escHtml(t('exhibitorPortal.showQrImage'))}
            </button>
            <button class="sratix-btn sratix-btn--outline sratix-btn--sm" id="sratix-show-qr-text-btn">
              ${escHtml(t('exhibitorPortal.showQrText'))}
            </button>
          </div>
          <div id="sratix-qr-display">
            <p class="sratix-loading">${escHtml(t('common.loading'))}</p>
          </div>
        </div>
      `;

      // Charts section
      if (data.timeSeries.scansByDay.length > 0) {
        html += `<div class="sratix-chart-section">
          <h4>${escHtml(t('exhibitorPortal.scansByDay'))}</h4>
          <canvas id="sratix-scans-chart" width="600" height="250"></canvas>
        </div>`;
      }

      if (data.timeSeries.leadsByDay.length > 0) {
        html += `<div class="sratix-chart-section">
          <h4>${escHtml(t('exhibitorPortal.leadsByDay'))}</h4>
          <canvas id="sratix-leads-chart" width="600" height="250"></canvas>
        </div>`;
      }

      container.innerHTML = html;

      // QR code: auto-load and toggle between image/text
      var qrDisplay = container.querySelector('#sratix-qr-display');
      var qrImageBtn = container.querySelector('#sratix-show-qr-image-btn');
      var qrTextBtn = container.querySelector('#sratix-show-qr-text-btn');
      var qrPayloadCache = null;

      function showQrImage() {
        if (!qrPayloadCache) return;
        var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(qrPayloadCache) + '&size=200x200&format=svg';
        qrDisplay.innerHTML = '<div class="sratix-qr-payload">' +
          '<img class="sratix-qr" src="' + escAttr(qrUrl) + '" alt="Booth QR code" width="200" height="200" />' +
          '<p class="sratix-portal-hint">' + escHtml(t('exhibitorPortal.qrImageHint')) + '</p>' +
          '</div>';
        qrImageBtn.classList.add('sratix-btn--active');
        qrTextBtn.classList.remove('sratix-btn--active');
      }

      function showQrText() {
        if (!qrPayloadCache) return;
        qrDisplay.innerHTML = '<div class="sratix-qr-payload">' +
          '<code>' + escHtml(qrPayloadCache) + '</code>' +
          '<p class="sratix-portal-hint">' + escHtml(t('exhibitorPortal.qrPayloadHint')) + '</p>' +
          '</div>';
        qrTextBtn.classList.add('sratix-btn--active');
        qrImageBtn.classList.remove('sratix-btn--active');
      }

      if (qrImageBtn && qrTextBtn) {
        qrImageBtn.addEventListener('click', showQrImage);
        qrTextBtn.addEventListener('click', showQrText);

        // Auto-load QR on analytics open
        apiFetch('exhibitor-portal/events/' + eventId + '/booth-qr', { headers: authHeaders })
          .then(function (qrData) {
            qrPayloadCache = qrData.qrPayload;
            showQrImage();
          })
          .catch(function (err) {
            qrDisplay.innerHTML = '<p class="sratix-portal-status--error">' + escHtml(err.message || t('common.error')) + '</p>';
          });
      }

      // Render charts with simple canvas bars (no Chart.js dependency)
      renderBarChart('sratix-scans-chart', data.timeSeries.scansByDay, 'day', 'count', '#4f8cff');
      renderBarChart('sratix-leads-chart', data.timeSeries.leadsByDay, 'day', 'count', '#22c55e');
    } catch (err) {
      container.innerHTML = `<p class="sratix-portal-status--error">${escHtml(err.message || t('exhibitorPortal.staffLoadError'))}</p>`;
    }
  }

  /**
   * Simple canvas bar chart — no external dependencies.
   */
  function renderBarChart(canvasId, dataPoints, labelKey, valueKey, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !dataPoints || dataPoints.length === 0) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const padding = { top: 20, right: 20, bottom: 50, left: 50 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    const maxVal = Math.max(...dataPoints.map(d => d[valueKey]), 1);
    const barW = Math.max(2, (chartW / dataPoints.length) - 4);

    ctx.clearRect(0, 0, W, H);

    // Y-axis gridlines
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + chartH - (chartH * i / 4);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(W - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(maxVal * i / 4).toString(), padding.left - 8, y + 4);
    }

    // Bars
    ctx.fillStyle = color;
    dataPoints.forEach((d, i) => {
      const barH = (d[valueKey] / maxVal) * chartH;
      const x = padding.left + (chartW / dataPoints.length) * i + 2;
      const y = padding.top + chartH - barH;
      ctx.fillRect(x, y, barW, barH);
    });

    // X-axis labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    dataPoints.forEach((d, i) => {
      const x = padding.left + (chartW / dataPoints.length) * i + barW / 2 + 2;
      const label = d[labelKey].substring(5); // "MM-DD"
      ctx.save();
      ctx.translate(x, H - padding.bottom + 14);
      ctx.rotate(-0.5);
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });
  }

  // ── Contact Organizers Panel ──────────────────────────────────────

  function renderContactPanel(panel, profile, events, authHeaders) {
    if (!events || events.length === 0) {
      panel.innerHTML = `<p class="sratix-portal-empty">${escHtml(t('exhibitorPortal.noEvents'))}</p>`;
      return;
    }

    let html = `<div class="sratix-contact-panel">
      <label class="sratix-label">${escHtml(t('exhibitorPortal.selectEvent'))}</label>
      <select class="sratix-input" id="sratix-contact-event-select">
        <option value="">—</option>
        ${events.map(ev => `<option value="${escAttr(ev.eventId)}">${escHtml(ev.event?.name || ev.eventId)}</option>`).join('')}
      </select>
      <div id="sratix-contact-content"></div>
    </div>`;
    panel.innerHTML = html;

    const sel = panel.querySelector('#sratix-contact-event-select');
    // Auto-select if single event
    if (events.length === 1) {
      sel.value = events[0].eventId;
      loadContactContent(panel.querySelector('#sratix-contact-content'), events[0].eventId, profile, authHeaders);
    }
    sel.addEventListener('change', function () {
      const content = panel.querySelector('#sratix-contact-content');
      if (!this.value) { content.innerHTML = ''; return; }
      loadContactContent(content, this.value, profile, authHeaders);
    });
  }

  async function loadContactContent(container, eventId, profile, authHeaders) {
    container.innerHTML = `<p class="sratix-loading">${escHtml(t('common.loading'))}</p>`;

    try {
      const info = await apiFetch('exhibitor-portal/events/' + eventId + '/contact-info', { headers: authHeaders });

      let contactDetailsHtml = '';
      if (info.contactEmail || info.contactPhone || info.contactWhatsapp) {
        contactDetailsHtml = '<div class="sratix-contact-details">';
        contactDetailsHtml += '<h4>' + escHtml(t('exhibitorPortal.organizerContactDetails')) + '</h4>';
        if (info.contactEmail) {
          contactDetailsHtml += '<p><strong>' + escHtml(t('exhibitorPortal.contactEmail')) + ':</strong> <a href="mailto:' + escAttr(info.contactEmail) + '">' + escHtml(info.contactEmail) + '</a></p>';
        }
        if (info.contactPhone) {
          contactDetailsHtml += '<p><strong>' + escHtml(t('exhibitorPortal.contactPhone')) + ':</strong> <a href="tel:' + escAttr(info.contactPhone) + '">' + escHtml(info.contactPhone) + '</a></p>';
        }
        if (info.contactWhatsapp) {
          var waNumber = info.contactWhatsapp.replace(/[^0-9+]/g, '');
          contactDetailsHtml += '<p><strong>WhatsApp:</strong> <a href="https://wa.me/' + escAttr(waNumber.replace('+', '')) + '" target="_blank" rel="noopener">' + escHtml(info.contactWhatsapp) + '</a></p>';
        }
        contactDetailsHtml += '</div>';
      }

      container.innerHTML = `
        ${contactDetailsHtml}
        <div class="sratix-portal-info-box">
          <span class="sratix-portal-info-box__icon">${PORTAL_ICONS.tip}</span>
          <p>${escHtml(t('exhibitorPortal.contactFormHint'))}</p>
        </div>
        <form class="sratix-portal-form" id="sratix-contact-form">
          <div class="sratix-portal-fields">
            <div class="sratix-field-group sratix-field-group--full">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.contactSubject'))} <span class="sratix-required">*</span></label>
              <input type="text" name="subject" required class="sratix-input" maxlength="200" />
            </div>
            <div class="sratix-field-group sratix-field-group--full">
              <label class="sratix-label">${escHtml(t('exhibitorPortal.contactMessage'))} <span class="sratix-required">*</span></label>
              <textarea name="message" rows="6" required class="sratix-input" maxlength="5000"></textarea>
            </div>
          </div>
          <div class="sratix-portal-actions">
            <button type="submit" class="sratix-btn sratix-btn--primary">
              ${escHtml(t('exhibitorPortal.sendMessage'))}
            </button>
            <span class="sratix-portal-status" id="sratix-contact-status"></span>
          </div>
        </form>
      `;

      container.querySelector('#sratix-contact-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        var form = e.target;
        var btn = form.querySelector('button[type="submit"]');
        var statusEl = form.querySelector('#sratix-contact-status');
        btn.disabled = true;

        try {
          await apiFetch('exhibitor-portal/events/' + eventId + '/contact', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              subject: form.subject.value.trim(),
              message: form.message.value.trim(),
            }),
          });
          showStatus(statusEl, t('exhibitorPortal.messageSent'), false);
          form.subject.value = '';
          form.message.value = '';
        } catch (err) {
          showStatus(statusEl, err.message || t('exhibitorPortal.saveError'), true);
        } finally {
          btn.disabled = false;
        }
      });
    } catch (err) {
      container.innerHTML = `<p class="sratix-portal-status--error">${escHtml(err.message || t('common.error'))}</p>`;
    }
  }

  // ── Logistics Panel (Stock Purchasing) ──────────────────────────────

  function renderLogisticsPanel(panel, events, authHeaders) {
    if (!events || events.length === 0) {
      panel.innerHTML = `<p class="sratix-portal-empty">${escHtml(t('exhibitorPortal.noEvents'))}</p>`;
      return;
    }

    panel.innerHTML = `<div class="sratix-logistics-panel">
      <label class="sratix-label">${escHtml(t('exhibitorPortal.selectEvent'))}</label>
      <select class="sratix-input" id="sratix-logistics-event-select">
        <option value="">—</option>
        ${events.map(ev => `<option value="${escAttr(ev.eventId)}">${escHtml(ev.event?.name || ev.eventId)}</option>`).join('')}
      </select>
      <div id="sratix-logistics-content"></div>
    </div>`;

    panel.querySelector('#sratix-logistics-event-select').addEventListener('change', function () {
      var eventId = this.value;
      var content = panel.querySelector('#sratix-logistics-content');
      if (!eventId) { content.innerHTML = ''; return; }
      loadLogisticsContent(content, eventId, authHeaders);
    });
  }

  async function loadLogisticsContent(container, eventId, authHeaders) {
    container.innerHTML = `<p class="sratix-loading">${escHtml(t('common.loading'))}</p>`;

    try {
      var [itemsRes, ordersRes] = await Promise.all([
        apiFetch('exhibitor-portal/events/' + eventId + '/logistics/items', { headers: authHeaders }),
        apiFetch('exhibitor-portal/events/' + eventId + '/logistics/orders', { headers: authHeaders }),
      ]);

      var items = Array.isArray(itemsRes) ? itemsRes : [];
      var orders = Array.isArray(ordersRes) ? ordersRes : [];

      var html = '';

      // ── Available Items ──
      if (items.length === 0) {
        html += `<p class="sratix-portal-empty" style="margin-top:16px">${escHtml(t('exhibitorPortal.logisticsNoItems'))}</p>`;
      } else {
        html += `<h4 class="sratix-portal-section-title" style="margin-top:16px">${escHtml(t('exhibitorPortal.logisticsAvailableItems'))}</h4>`;
        html += '<div class="sratix-logistics-items">';
        items.forEach(function (item) {
          var available = item.stockAvailable != null ? item.stockAvailable : 0;
          var maxQty = Math.max(0, available);
          html += `<div class="sratix-logistics-item" data-item-id="${escAttr(item.id)}">
            <div class="sratix-logistics-item__info">
              <div class="sratix-logistics-item__name">${escHtml(item.name)}</div>
              ${item.description ? `<div class="sratix-logistics-item__desc">${escHtml(item.description)}</div>` : ''}
              <div class="sratix-logistics-item__price">${escHtml(formatPrice(item.priceCents, item.currency))}</div>
              <div class="sratix-logistics-item__stock">${escHtml(t('exhibitorPortal.logisticsInStock'))}: ${available}</div>
            </div>
            <div class="sratix-logistics-item__qty">
              ${maxQty > 0
                ? `<input type="number" class="sratix-input sratix-logistics-qty" min="0" max="${maxQty}" value="0" data-item-id="${escAttr(item.id)}" data-price="${item.priceCents}" data-currency="${escAttr(item.currency || 'CHF')}" />`
                : `<span class="sratix-logistics-out-of-stock">${escHtml(t('exhibitorPortal.logisticsOutOfStock'))}</span>`}
            </div>
          </div>`;
        });
        html += '</div>';

        // Order summary + button
        html += `<div class="sratix-logistics-order-summary" id="sratix-logistics-summary" style="display:none">
          <div class="sratix-logistics-order-total">
            ${escHtml(t('exhibitorPortal.logisticsTotal'))}: <strong id="sratix-logistics-total">CHF 0.00</strong>
          </div>
          <button type="button" class="sratix-btn sratix-btn--primary" id="sratix-logistics-order-btn">
            ${escHtml(t('exhibitorPortal.logisticsPlaceOrder'))}
          </button>
          <div class="sratix-portal-status" id="sratix-logistics-status"></div>
        </div>`;
      }

      // ── Order History ──
      if (orders.length > 0) {
        html += `<h4 class="sratix-portal-section-title" style="margin-top:32px">${escHtml(t('exhibitorPortal.logisticsOrderHistory'))}</h4>`;
        html += '<div class="sratix-logistics-orders">';
        orders.forEach(function (order) {
          var statusClass = 'sratix-logistics-badge--' + order.status;
          var fulfillClass = 'sratix-logistics-badge--' + order.fulfillmentStatus;
          var orderDate = new Date(order.createdAt).toLocaleDateString();

          html += `<div class="sratix-logistics-order">
            <div class="sratix-logistics-order__header">
              <span class="sratix-logistics-order__number">${escHtml(order.orderNumber)}</span>
              <span class="sratix-logistics-order__date">${escHtml(orderDate)}</span>
              <span class="sratix-logistics-badge ${statusClass}">${escHtml(t('exhibitorPortal.logisticsStatus_' + order.status))}</span>
              ${order.status === 'paid' ? `<span class="sratix-logistics-badge ${fulfillClass}">${escHtml(t('exhibitorPortal.logisticsFulfill_' + order.fulfillmentStatus))}</span>` : ''}
            </div>
            <div class="sratix-logistics-order__items">
              ${(order.items || []).map(function (oi) {
                return `<div class="sratix-logistics-order__line">
                  <span>${escHtml((oi.item && oi.item.name) || '—')} × ${oi.quantity}</span>
                  <span>${escHtml(formatPrice(oi.subtotalCents, order.currency))}</span>
                </div>`;
              }).join('')}
            </div>
            <div class="sratix-logistics-order__total">
              ${escHtml(t('exhibitorPortal.logisticsTotal'))}: <strong>${escHtml(formatPrice(order.totalCents, order.currency))}</strong>
            </div>
          </div>`;
        });
        html += '</div>';
      }

      container.innerHTML = html;

      // ── Bind quantity change → update summary ──
      var qtyInputs = container.querySelectorAll('.sratix-logistics-qty');
      var summaryEl = container.querySelector('#sratix-logistics-summary');
      var totalEl = container.querySelector('#sratix-logistics-total');

      function updateSummary() {
        var total = 0;
        var hasItems = false;
        qtyInputs.forEach(function (inp) {
          var qty = parseInt(inp.value, 10) || 0;
          if (qty > 0) {
            hasItems = true;
            total += qty * parseInt(inp.getAttribute('data-price'), 10);
          }
        });
        if (summaryEl) {
          summaryEl.style.display = hasItems ? '' : 'none';
        }
        if (totalEl) {
          var currency = qtyInputs.length > 0 ? (qtyInputs[0].getAttribute('data-currency') || 'CHF') : 'CHF';
          totalEl.textContent = formatPrice(total, currency);
        }
      }

      qtyInputs.forEach(function (inp) { inp.addEventListener('input', updateSummary); });

      // ── Bind order button ──
      var orderBtn = container.querySelector('#sratix-logistics-order-btn');
      if (orderBtn) {
        orderBtn.addEventListener('click', function () {
          submitLogisticsOrder(container, eventId, authHeaders, qtyInputs);
        });
      }
    } catch (err) {
      container.innerHTML = `<p class="sratix-portal-status--error">${escHtml(err.message || t('exhibitorPortal.staffLoadError'))}</p>`;
    }
  }

  async function submitLogisticsOrder(container, eventId, authHeaders, qtyInputs) {
    var statusEl = container.querySelector('#sratix-logistics-status');
    var orderBtn = container.querySelector('#sratix-logistics-order-btn');

    // Collect selected items
    var selectedItems = [];
    qtyInputs.forEach(function (inp) {
      var qty = parseInt(inp.value, 10) || 0;
      if (qty > 0) {
        selectedItems.push({ logisticsItemId: inp.getAttribute('data-item-id'), quantity: qty });
      }
    });

    if (selectedItems.length === 0) return;

    if (orderBtn) { orderBtn.disabled = true; orderBtn.textContent = t('common.loading'); }

    try {
      var result = await apiFetch('exhibitor-portal/events/' + eventId + '/logistics/checkout', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: selectedItems,
          successUrl: window.location.href,
          cancelUrl: window.location.href,
        }),
      });

      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        throw new Error('Unexpected response from server');
      }
    } catch (err) {
      if (orderBtn) { orderBtn.disabled = false; orderBtn.textContent = t('exhibitorPortal.logisticsPlaceOrder'); }
      showStatus(statusEl, err.message || t('common.error'), true);
    }
  }

  function showStatus(el, message, isError) {
    if (!el) return;
    el.textContent = message;
    el.className = 'sratix-portal-status ' + (isError ? 'sratix-portal-status--error' : 'sratix-portal-status--success');
    setTimeout(() => { el.textContent = ''; el.className = 'sratix-portal-status'; }, 4000);
  }

  /** Sync the header logo with updated profile data */
  function syncHeaderLogo(panelOrChild, profile) {
    var portal = panelOrChild.closest('.sratix-exhibitor-portal');
    if (!portal) return;
    var logoDiv = portal.querySelector('.sratix-portal-header__logo');
    if (!logoDiv) return;
    if (profile.logoUrl) {
      logoDiv.innerHTML = `<label class="sratix-portal-header__logo-wrap sratix-portal-header__logo-wrap--has-img" tabindex="0" title="${escAttr(t('exhibitorPortal.changeLogo'))}">
        <img src="${escAttr(resolveApiUrl(profile.logoUrl))}" alt="${escAttr(profile.companyName || '')}" class="sratix-portal-header__logo-img" />
        <span class="sratix-portal-header__logo-overlay">${escHtml(t('exhibitorPortal.changeLogo'))}</span>
        <input type="file" accept="image/*" class="sratix-header-logo-input" hidden />
      </label>`;
    } else {
      logoDiv.innerHTML = `<label class="sratix-portal-header__logo-wrap sratix-portal-header__logo-wrap--empty" tabindex="0">
        <span class="sratix-portal-header__logo-ph">${escHtml(t('exhibitorPortal.uploadLogo'))}</span>
        <input type="file" accept="image/*" class="sratix-header-logo-input" hidden />
      </label>`;
    }
    // Re-bind the header logo input
    var newInput = logoDiv.querySelector('.sratix-header-logo-input');
    if (newInput) {
      newInput.addEventListener('change', async function () {
        var file = newInput.files[0];
        if (!file) return;
        var fd = new FormData();
        fd.append('file', file);
        try {
          await fetch(API_BASE + '/exhibitor-portal/profile/logo', {
            method: 'POST',
            headers: { Authorization: portal._sratixAuth.Authorization },
            body: fd,
          });
          var refreshed = await apiFetch('exhibitor-portal/profile', { headers: portal._sratixAuth });
          syncHeaderLogo(logoDiv, refreshed);
          // Also refresh profile panel if visible
          var profilePanel = portal.querySelector('#sratix-panel-profile');
          if (profilePanel) renderProfilePanel(profilePanel, refreshed, portal._sratixAuth);
        } catch (err) {
          console.error('[SRAtix] Header logo upload error:', err);
        }
      });
    }
  }

  // ─── Exhibitor Confirmation (post-purchase polling) ──────────────────────────

  function renderExhibitorConfirmation() {
    var params = new URLSearchParams(window.location.search);
    var orderNumber = params.get('sratix_order') || '';

    // Create confirmation container — no polling needed, provisioning happens server-side
    var container = document.createElement('div');
    container.className = 'sratix-exhibitor-confirmation';
    container.setAttribute('role', 'status');
    container.innerHTML =
      '<div class="sratix-confirmation-card">' +
        '<div class="sratix-confirmation-header">' +
          '<span class="sratix-confirmation-icon">✓</span>' +
          '<h2>' + escHtml(t('exhibitorConfirmation.title')) + '</h2>' +
          '<p>' + escHtml(t('exhibitorConfirmation.subtitle')) +
            (orderNumber ? ' ' + escHtml(t('exhibitorConfirmation.orderNumber')) + ' <strong>' + escHtml(orderNumber) + '</strong>' : '') +
          '</p>' +
        '</div>' +
        '<div id="sratix-confirmation-body">' +
          '<div class="sratix-confirmation-ready">' +
            '<p class="sratix-confirmation-note">' + escHtml(t('exhibitorConfirmation.emailNote')) + '</p>' +
            '<div class="sratix-confirmation-actions">' +
              '<button class="sratix-btn sratix-btn-secondary sratix-confirmation-dismiss">' +
                escHtml(t('exhibitorConfirmation.dismiss')) +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Insert at first widget or top of body
    var target = document.getElementById('sratix-tickets-widget') ||
      document.getElementById('sratix-exhibitor-portal-widget') ||
      document.body.firstChild;
    if (target && target.parentNode) {
      target.parentNode.insertBefore(container, target);
    } else {
      document.body.insertBefore(container, document.body.firstChild);
    }

    // Clean URL params
    var cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('sratix_success');
    cleanUrl.searchParams.delete('sratix_order');
    cleanUrl.searchParams.delete('sratix_test');
    cleanUrl.searchParams.delete('sratix_type');
    cleanUrl.searchParams.delete('sratix_email');
    window.history.replaceState(null, '', cleanUrl.toString());

    var dismissBtn = container.querySelector('.sratix-confirmation-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        container.remove();
      });
    }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  function init() {
    var params = new URLSearchParams(window.location.search);
    var isPostPurchase = params.get('sratix_success') === '1';
    if (isPostPurchase) {
      if (params.get('sratix_type') === 'exhibitor') {
        renderExhibitorConfirmation();
        // Hide the portal login widget — the confirmation card handles the flow
        var portalWidget = document.getElementById('sratix-exhibitor-portal-widget');
        if (portalWidget) portalWidget.style.display = 'none';
      } else {
        injectSuccessBanner();
      }
    }
    initTicketsWidget();
    initMyTicketsWidget();
    initScheduleWidget();
    initRegisterWidget();
    initSetPasswordWidget();
    if (!isPostPurchase || params.get('sratix_type') !== 'exhibitor') {
      initExhibitorPortalWidget();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
