import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Field Repository Service — manages the global catalog of form field definitions.
 *
 * The field repository is a curated set of reusable field definitions that can be
 * dragged into form schemas via the Dashboard's visual form builder. Fields are
 * global (not scoped to org/event) so all admins share the same catalog.
 *
 * Fields are organized into groups:
 *   - system:           Hidden auto-populated fields (ticket ID, etc.)
 *   - must_have:        Base fields recommended for every form
 *   - billing:          Billing / invoicing fields
 *   - legal_compliance: T&C, privacy, consent checkboxes
 *   - profile:          Personal profile fields
 *   - company:          Company/organization fields
 *   - b2b:              B2B networking & intent fields
 *   - privacy:          Attendee privacy/sharing toggles
 *   - questions:        Event-specific survey questions
 *   - community:        Community tagging & matching
 */
@Injectable()
export class FieldRepositoryService implements OnModuleInit {
  private readonly logger = new Logger(FieldRepositoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-seed field definitions on startup. Idempotent — skips existing slugs.
   */
  async onModuleInit() {
    try {
      const { created, skipped, updated } = await this.seedDefaults();
      if (created > 0 || updated > 0) {
        this.logger.log(`Field repository seeded: ${created} created, ${updated} updated, ${skipped} skipped`);
      } else {
        this.logger.debug(`Field repository up to date (${skipped} fields exist)`);
      }
    } catch (error) {
      this.logger.warn('Failed to auto-seed field repository — will retry on next restart', error);
    }
  }

  /**
   * Get all field definitions, optionally filtered by group or system flag.
   */
  async findAll(options?: {
    group?: string;
    isSystem?: boolean;
    active?: boolean;
  }) {
    const where: Record<string, unknown> = {};
    if (options?.group) where.group = options.group;
    if (options?.isSystem !== undefined) where.isSystem = options.isSystem;
    if (options?.active !== undefined) where.active = options.active;

    return this.prisma.fieldDefinition.findMany({
      where,
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /**
   * Get non-system, active fields — what the form builder sees.
   */
  async findBuildableFields() {
    return this.prisma.fieldDefinition.findMany({
      where: { isSystem: false, active: true },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  /**
   * Get a single field by ID.
   */
  async findOne(id: string) {
    const field = await this.prisma.fieldDefinition.findUnique({
      where: { id },
    });
    if (!field) throw new NotFoundException(`Field definition ${id} not found`);
    return field;
  }

  /**
   * Get a single field by slug.
   */
  async findBySlug(slug: string) {
    const field = await this.prisma.fieldDefinition.findUnique({
      where: { slug },
    });
    if (!field)
      throw new NotFoundException(`Field definition '${slug}' not found`);
    return field;
  }

  /**
   * Get distinct groups.
   */
  async getGroups() {
    const results = await this.prisma.fieldDefinition.findMany({
      select: { group: true },
      distinct: ['group'],
      orderBy: { group: 'asc' },
    });
    return results.map((r) => r.group);
  }

  /**
   * Create a new field definition (Super Admin only).
   */
  async create(data: {
    slug: string;
    label: Record<string, string>;
    type: string;
    group: string;
    options?: Array<{ value: string; label: Record<string, string> }>;
    defaultWidthDesktop?: number;
    defaultWidthMobile?: number;
    validationRules?: Record<string, unknown>;
    helpText?: Record<string, string>;
    placeholder?: Record<string, string>;
    defaultValue?: unknown;
    categoryFilter?: string[];
    conditionalOn?: Record<string, unknown>;
    documentUrl?: Record<string, string>;
    sortOrder?: number;
    isSystem?: boolean;
  }) {
    // Check slug uniqueness
    const existing = await this.prisma.fieldDefinition.findUnique({
      where: { slug: data.slug },
    });
    if (existing) {
      throw new ConflictException(`Field slug '${data.slug}' already exists`);
    }

    return this.prisma.fieldDefinition.create({
      data: {
        slug: data.slug,
        label: data.label as any,
        type: data.type,
        group: data.group,
        options: data.options as any,
        defaultWidthDesktop: data.defaultWidthDesktop ?? 100,
        defaultWidthMobile: data.defaultWidthMobile ?? 100,
        validationRules: data.validationRules as any,
        helpText: data.helpText as any,
        placeholder: data.placeholder as any,
        defaultValue: data.defaultValue as any,
        categoryFilter: data.categoryFilter as any,
        conditionalOn: data.conditionalOn as any,
        documentUrl: data.documentUrl as any,
        sortOrder: data.sortOrder ?? 0,
        isSystem: data.isSystem ?? false,
      },
    });
  }

  /**
   * Update a field definition.
   */
  async update(
    id: string,
    data: Partial<{
      label: Record<string, string>;
      type: string;
      group: string;
      options: Array<{ value: string; label: Record<string, string> }>;
      defaultWidthDesktop: number;
      defaultWidthMobile: number;
      validationRules: Record<string, unknown>;
      helpText: Record<string, string>;
      placeholder: Record<string, string>;
      defaultValue: unknown;
      categoryFilter: string[];
      conditionalOn: Record<string, unknown>;
      documentUrl: Record<string, string>;
      sortOrder: number;
      active: boolean;
    }>,
  ) {
    await this.findOne(id);
    return this.prisma.fieldDefinition.update({
      where: { id },
      data: data as any,
    });
  }

  /**
   * Seed the repository with default fields. Idempotent — creates missing slugs
   * and syncs selected seeded properties for existing ones.
   * Called by the seed script or manually from the admin.
   */
  async seedDefaults(): Promise<{ created: number; skipped: number; updated: number }> {
    const defaults = getDefaultFieldDefinitions();
    let created = 0;
    let skipped = 0;
    let updated = 0;

    for (const field of defaults) {
      const existing = await this.prisma.fieldDefinition.findUnique({
        where: { slug: field.slug },
      });
      if (existing) {
        const updates: Record<string, unknown> = {};

        // Update tooltip if it changed (or was added)
        const seedTooltip = (field as any).tooltip ?? null;
        const dbTooltip = existing.tooltip ?? null;
        if (JSON.stringify(seedTooltip) !== JSON.stringify(dbTooltip) && seedTooltip !== null) {
          updates.tooltip = seedTooltip;
        }

        // Update options if the seeded field gained or changed choices.
        const seedOptions = (field as any).options ?? null;
        const dbOptions = existing.options ?? null;
        if (JSON.stringify(seedOptions) !== JSON.stringify(dbOptions) && seedOptions !== null) {
          updates.options = seedOptions;
        }

        if (Object.keys(updates).length > 0) {
          await this.prisma.fieldDefinition.update({
            where: { slug: field.slug },
            data: updates as any,
          });
          updated++;
        } else {
          skipped++;
        }
        continue;
      }
      await this.prisma.fieldDefinition.create({ data: field as any });
      created++;
    }

    this.logger.log(`Field repository seeded: ${created} created, ${updated} updated, ${skipped} skipped`);
    return { created, skipped, updated };
  }
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT FIELD DEFINITIONS — derived from SRAtix fields.csv
// ═══════════════════════════════════════════════════════════════

function getDefaultFieldDefinitions() {
  return [
    // ── System Fields (hidden) ───────────────────────────────
    fd('ticket_id', { en: 'Ticket ID', fr: 'ID du billet', de: 'Ticket-ID', it: 'ID biglietto', 'zh-TW': '票券編號' }, 'text', 'system', { isSystem: true, sortOrder: 0 }),
    fd('event_id', { en: 'Event ID', fr: 'ID de l\'événement', de: 'Event-ID', it: 'ID evento', 'zh-TW': '活動編號' }, 'text', 'system', { isSystem: true, sortOrder: 1 }),
    fd('ticket_type_id', { en: 'Ticket Type ID', fr: 'ID du type de billet', de: 'Tickettyp-ID', it: 'ID tipo biglietto', 'zh-TW': '票種編號' }, 'text', 'system', { isSystem: true, sortOrder: 2 }),
    fd('purchase_timestamp', { en: 'Purchase Timestamp', fr: 'Date d\'achat', de: 'Kaufzeitpunkt', it: 'Data di acquisto', 'zh-TW': '購買時間' }, 'text', 'system', { isSystem: true, sortOrder: 3 }),
    fd('payment_status', { en: 'Payment Status', fr: 'Statut du paiement', de: 'Zahlungsstatus', it: 'Stato pagamento', 'zh-TW': '付款狀態' }, 'text', 'system', { isSystem: true, sortOrder: 4 }),
    fd('order_id', { en: 'Order ID', fr: 'ID de commande', de: 'Bestell-ID', it: 'ID ordine', 'zh-TW': '訂單編號' }, 'text', 'system', { isSystem: true, sortOrder: 5 }),
    fd('qr_code_token', { en: 'QR Code Token', fr: 'Jeton QR Code', de: 'QR-Code-Token', it: 'Token codice QR', 'zh-TW': 'QR Code 令牌' }, 'text', 'system', { isSystem: true, sortOrder: 6 }),
    fd('checkin_status', { en: 'Check-in Status', fr: 'Statut d\'enregistrement', de: 'Check-in-Status', it: 'Stato check-in', 'zh-TW': '報到狀態' }, 'text', 'system', { isSystem: true, sortOrder: 7 }),
    fd('checkin_timestamp', { en: 'Check-in Timestamp', fr: 'Heure d\'enregistrement', de: 'Check-in-Zeitpunkt', it: 'Ora check-in', 'zh-TW': '報到時間' }, 'text', 'system', { isSystem: true, sortOrder: 8 }),

    // ── Must Have Fields ─────────────────────────────────────
    fd('first_name', { en: 'First Name', de: 'Vorname', fr: 'Prénom', it: 'Nome', 'zh-TW': '名字' }, 'text', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 0,
      validation: { required: true, minLength: 1, maxLength: 100 },
    }),
    fd('last_name', { en: 'Last Name', de: 'Nachname', fr: 'Nom', it: 'Cognome', 'zh-TW': '姓氏' }, 'text', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 1,
      validation: { required: true, minLength: 1, maxLength: 100 },
    }),
    fd('email', { en: 'Email Address', de: 'E-Mail-Adresse', fr: 'Adresse e-mail', it: 'Indirizzo e-mail', 'zh-TW': '電子郵件' }, 'email', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      validation: { required: true },
    }),
    fd('phone', { en: 'Phone', de: 'Telefon', fr: 'Téléphone', it: 'Telefono', 'zh-TW': '電話' }, 'phone', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
    }),
    fd('city', { en: 'City', de: 'Stadt', fr: 'Ville', it: 'Città', 'zh-TW': '城市' }, 'text', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
    }),
    fd('state_canton', { en: 'State / Canton', de: 'Kanton', fr: 'Canton', it: 'Cantone', 'zh-TW': '州 / 邦' }, 'select', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
      options: swissCantons(),
      tooltip: { en: 'If based in Switzerland, selecting your canton helps us connect you with regional robotics networks.', de: '[DE] If based in Switzerland, selecting your canton helps us connect you with regional robotics networks.', fr: '[FR] If based in Switzerland, selecting your canton helps us connect you with regional robotics networks.', it: '[IT] If based in Switzerland, selecting your canton helps us connect you with regional robotics networks.', 'zh-TW': '[ZH] If based in Switzerland, selecting your canton helps us connect you with regional robotics networks.' },
    }),
    fd('country', { en: 'Country', de: 'Land', fr: 'Pays', it: 'Paese', 'zh-TW': '國家' }, 'country', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
    }),

    // ── Billing Fields ───────────────────────────────────────
    fd('billing_details_differ', { en: 'Billing details differ from above', de: 'Rechnungsangaben weichen ab', fr: 'Les coordonnées de facturation diffèrent', it: 'I dati di fatturazione sono diversi', 'zh-TW': '帳單資料與上方不同' }, 'checkbox', 'billing', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      helpText: { en: 'Check if your billing address is different from your personal details.', de: 'Aktivieren, falls Ihre Rechnungsadresse abweicht.', fr: 'Cochez si votre adresse de facturation est différente.', it: 'Seleziona se l\'indirizzo di fatturazione è diverso.', 'zh-TW': '若帳單地址與個人資料不同，請勾選。' },
      tooltip: { en: 'Enable this if the invoice should go to a different name or address than your personal details.', de: '[DE] Enable this if the invoice should go to a different name or address than your personal details.', fr: '[FR] Enable this if the invoice should go to a different name or address than your personal details.', it: '[IT] Enable this if the invoice should go to a different name or address than your personal details.', 'zh-TW': '[ZH] Enable this if the invoice should go to a different name or address than your personal details.' },
    }),
    fd('billing_name', { en: 'Billing Name', de: 'Rechnungsname', fr: 'Nom de facturation', it: 'Nome fatturazione', 'zh-TW': '帳單姓名' }, 'text', 'billing', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 1,
      conditionalOn: { field: 'billing_details_differ', operator: 'eq', value: true },
    }),
    fd('billing_country', { en: 'Billing Country', de: 'Rechnungsland', fr: 'Pays de facturation', it: 'Paese di fatturazione', 'zh-TW': '帳單國家' }, 'country', 'billing', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      conditionalOn: { field: 'billing_details_differ', operator: 'eq', value: true },
    }),
    fd('vat_tax_id', { en: 'VAT / Tax ID', de: 'USt-IdNr. / Steuernummer', fr: 'Numéro TVA', it: 'Partita IVA / Codice fiscale', 'zh-TW': '統一編號 / 稅號' }, 'text', 'billing', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
      helpText: { en: 'Enter your VAT number for invoicing purposes.', de: 'Geben Sie Ihre USt-IdNr. für die Rechnungsstellung ein.', fr: 'Entrez votre numéro de TVA pour la facturation.', it: 'Inserisci la partita IVA per la fatturazione.', 'zh-TW': '請輸入您的統一編號以供開立發票。' },
      tooltip: { en: 'Provide your company\'s VAT/Tax ID so we can issue a compliant invoice. Required for Swiss and EU companies claiming VAT deductions.', de: '[DE] Provide your company\'s VAT/Tax ID so we can issue a compliant invoice. Required for Swiss and EU companies claiming VAT deductions.', fr: '[FR] Provide your company\'s VAT/Tax ID so we can issue a compliant invoice. Required for Swiss and EU companies claiming VAT deductions.', it: '[IT] Provide your company\'s VAT/Tax ID so we can issue a compliant invoice. Required for Swiss and EU companies claiming VAT deductions.', 'zh-TW': '[ZH] Provide your company\'s VAT/Tax ID so we can issue a compliant invoice. Required for Swiss and EU companies claiming VAT deductions.' },
    }),
    fd('billing_company_name', { en: 'Billing Company Name', de: 'Rechnungsfirma', fr: 'Raison sociale', it: 'Ragione sociale', 'zh-TW': '帳單公司名稱' }, 'text', 'billing', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
      conditionalOn: { field: 'vat_tax_id', operator: 'not_empty', value: null },
    }),
    fd('billing_address', { en: 'Billing Address', de: 'Rechnungsadresse', fr: 'Adresse de facturation', it: 'Indirizzo di fatturazione', 'zh-TW': '帳單地址' }, 'text', 'billing', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 5,
      conditionalOn: { field: 'billing_details_differ', operator: 'eq', value: true },
    }),
    fd('invoice_required', { en: 'Invoice required?', de: 'Rechnung benötigt?', fr: 'Facture requise ?', it: 'Fattura necessaria?', 'zh-TW': '是否需要發票？' }, 'yes-no', 'billing', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
      tooltip: { en: 'Enable this if you need a formal invoice for your accounting department.', de: '[DE] Enable this if you need a formal invoice for your accounting department.', fr: '[FR] Enable this if you need a formal invoice for your accounting department.', it: '[IT] Enable this if you need a formal invoice for your accounting department.', 'zh-TW': '[ZH] Enable this if you need a formal invoice for your accounting department.' },
    }),

    // ── Legal Compliance Fields ──────────────────────────────
    fd('terms_conditions', { en: 'Terms & Conditions', de: 'AGB', fr: 'Conditions générales', it: 'Termini e condizioni', 'zh-TW': '條款與細則' }, 'consent', 'legal_compliance', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      validation: { required: true },
      helpText: { en: 'I agree to the Terms & Conditions.', de: 'Ich stimme den AGB zu.', fr: 'J\'accepte les conditions générales.', it: 'Accetto i termini e le condizioni.', 'zh-TW': '我同意條款與細則。' },
    }),
    fd('privacy_policy', { en: 'Privacy Policy', de: 'Datenschutzrichtlinie', fr: 'Politique de confidentialité', it: 'Informativa sulla privacy', 'zh-TW': '隱私權政策' }, 'consent', 'legal_compliance', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      validation: { required: true },
      helpText: { en: 'I agree to the Privacy Policy.', de: 'Ich stimme der Datenschutzrichtlinie zu.', fr: 'J\'accepte la politique de confidentialité.', it: 'Accetto l\'informativa sulla privacy.', 'zh-TW': '我同意隱私權政策。' },
    }),
    fd('code_of_conduct', { en: 'Code of Conduct', de: 'Verhaltenskodex', fr: 'Code de conduite', it: 'Codice di condotta', 'zh-TW': '行為準則' }, 'consent', 'legal_compliance', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
      validation: { required: true },
    }),
    fd('photography_consent', { en: 'Photography / Media Consent', de: 'Foto- / Medienzustimmung', fr: 'Consentement photo / média', it: 'Consenso foto / media', 'zh-TW': '攝影 / 媒體同意書' }, 'consent', 'legal_compliance', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
      validation: { required: true },
      helpText: {
        en: 'By participating in our programs and events, you consent to being filmed and/or photographed, and you grant Swissnex permission to use your image and other details (such as your name, title, organization and bio) on our website and for marketing purposes.',
        de: 'Mit Ihrer Teilnahme an unseren Programmen und Veranstaltungen stimmen Sie zu, gefilmt und/oder fotografiert zu werden, und Sie erteilen Swissnex die Erlaubnis, Ihr Bild und andere Angaben (wie Name, Titel, Organisation und Biografie) auf unserer Website und zu Marketingzwecken zu verwenden.',
        fr: 'En participant à nos programmes et événements, vous consentez à être filmé(e) et/ou photographié(e), et vous autorisez Swissnex à utiliser votre image et autres informations (telles que votre nom, titre, organisation et biographie) sur notre site web et à des fins marketing.',
        it: 'Partecipando ai nostri programmi ed eventi, acconsentite a essere filmati e/o fotografati e autorizzate Swissnex a utilizzare la vostra immagine e altri dettagli (come nome, titolo, organizzazione e biografia) sul nostro sito web e per scopi di marketing.',
        'zh-TW': '參加我們的計畫與活動即表示您同意被拍攝和/或攝影，並授權 Swissnex 在其網站及行銷用途中使用您的肖像及其他資訊（如姓名、職稱、組織及簡介）。',
      },
    }),

    // ── Profile Fields ───────────────────────────────────────
    fd('attendee_sector', { en: 'I represent…', de: 'Ich vertrete…', fr: 'Je représente…', it: 'Rappresento…', 'zh-TW': '我代表…' }, 'radio', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: -1,
      options: [
        { value: 'industry', label: { en: 'Industry', de: 'Industrie', fr: 'Industrie', it: 'Industria', 'zh-TW': '產業界' } },
        { value: 'academia', label: { en: 'Academia', de: 'Wissenschaft', fr: 'Académie', it: 'Accademia', 'zh-TW': '學術界' } },
        { value: 'government', label: { en: 'Government / Public Sector', de: 'Regierung / Öffentlicher Sektor', fr: 'Gouvernement / Secteur public', it: 'Governo / Settore pubblico', 'zh-TW': '政府 / 公共部門' } },
      ],
      tooltip: { en: 'Helps us tailor the form fields and networking to your sector.', de: 'Hilft uns, die Formularfelder und das Networking auf Ihren Sektor abzustimmen.', fr: 'Nous aide à adapter les champs du formulaire et le réseautage à votre secteur.', it: 'Ci aiuta ad adattare i campi del modulo e il networking al vostro settore.', 'zh-TW': '幫助我們根據您的領域調整表單欄位和交流活動。' },
    }),
    fd('short_bio', { en: 'Short Bio', de: 'Kurzbiografie', fr: 'Biographie courte', it: 'Breve biografia', 'zh-TW': '簡短自介' }, 'textarea', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      tooltip: { en: 'A brief intro about yourself, shown on your attendee profile card. Helps others decide if they want to connect.', de: '[DE] A brief intro about yourself, shown on your attendee profile card. Helps others decide if they want to connect.', fr: '[FR] A brief intro about yourself, shown on your attendee profile card. Helps others decide if they want to connect.', it: '[IT] A brief intro about yourself, shown on your attendee profile card. Helps others decide if they want to connect.', 'zh-TW': '[ZH] A brief intro about yourself, shown on your attendee profile card. Helps others decide if they want to connect.' },
    }),
    fd('job_title', { en: 'Job Title', de: 'Berufsbezeichnung', fr: 'Titre du poste', it: 'Qualifica professionale', 'zh-TW': '職稱' }, 'text', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 1,
    }),
    fd('department', { en: 'Department', de: 'Abteilung', fr: 'Département', it: 'Reparto', 'zh-TW': '部門' }, 'select', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      options: multiOptI18n([
        { en: 'R&D', de: 'F&E', fr: 'R&D', it: 'R&S', 'zh-TW': '研發' },
        { en: 'Engineering', de: 'Technik', fr: 'Ingénierie', it: 'Ingegneria', 'zh-TW': '工程' },
        { en: 'Operations', de: 'Betrieb', fr: 'Opérations', it: 'Operazioni', 'zh-TW': '營運' },
        { en: 'Procurement', de: 'Beschaffung', fr: 'Achats', it: 'Acquisti', 'zh-TW': '採購' },
        { en: 'Sales', de: 'Vertrieb', fr: 'Ventes', it: 'Vendite', 'zh-TW': '銷售' },
        { en: 'Marketing', de: 'Marketing', fr: 'Marketing', it: 'Marketing', 'zh-TW': '行銷' },
        { en: 'Finance', de: 'Finanzen', fr: 'Finance', it: 'Finanza', 'zh-TW': '財務' },
        { en: 'HR', de: 'Personalwesen', fr: 'RH', it: 'Risorse umane', 'zh-TW': '人力資源' },
        { en: 'Legal', de: 'Recht', fr: 'Juridique', it: 'Legale', 'zh-TW': '法務' },
        { en: 'Executive', de: 'Geschäftsleitung', fr: 'Direction', it: 'Direzione', 'zh-TW': '高階管理' },
      ]),
      tooltip: { en: 'Your department helps us match you with relevant sessions and networking opportunities.', de: '[DE] Your department helps us match you with relevant sessions and networking opportunities.', fr: '[FR] Your department helps us match you with relevant sessions and networking opportunities.', it: '[IT] Your department helps us match you with relevant sessions and networking opportunities.', 'zh-TW': '[ZH] Your department helps us match you with relevant sessions and networking opportunities.' },
    }),
    fd('personal_linkedin', { en: 'Personal LinkedIn', de: 'Persönliches LinkedIn', fr: 'LinkedIn personnel', it: 'LinkedIn personale', 'zh-TW': '個人 LinkedIn' }, 'url', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
    }),
    fd('profile_photo', { en: 'Profile Photo', de: 'Profilfoto', fr: 'Photo de profil', it: 'Foto profilo', 'zh-TW': '個人照片' }, 'image-upload', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
      tooltip: { en: 'A photo helps other attendees recognize you during the event and makes your profile more approachable.', de: '[DE] A photo helps other attendees recognize you during the event and makes your profile more approachable.', fr: '[FR] A photo helps other attendees recognize you during the event and makes your profile more approachable.', it: '[IT] A photo helps other attendees recognize you during the event and makes your profile more approachable.', 'zh-TW': '[ZH] A photo helps other attendees recognize you during the event and makes your profile more approachable.' },
    }),
    fd('profile_visibility', { en: 'Profile Visibility', de: 'Profilsichtbarkeit', fr: 'Visibilité du profil', it: 'Visibilità profilo', 'zh-TW': '個人檔案可見度' }, 'radio', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 5,
      options: [
        { value: 'public', label: { en: 'Visible to all attendees', de: 'Für alle Teilnehmenden sichtbar', fr: 'Visible par tous les participants', it: 'Visibile a tutti i partecipanti', 'zh-TW': '所有與會者皆可見' } },
        { value: 'connections', label: { en: 'Visible to connections only', de: 'Nur für Kontakte sichtbar', fr: 'Visible seulement par mes contacts', it: 'Visibile solo ai contatti', 'zh-TW': '僅聯絡人可見' } },
        { value: 'hidden', label: { en: 'Hidden', de: 'Ausgeblendet', fr: 'Masqué', it: 'Nascosto', 'zh-TW': '隱藏' } },
      ],
      tooltip: { en: 'Controls who can see your attendee profile. You can change this after registration too.', de: '[DE] Controls who can see your attendee profile. You can change this after registration too.', fr: '[FR] Controls who can see your attendee profile. You can change this after registration too.', it: '[IT] Controls who can see your attendee profile. You can change this after registration too.', 'zh-TW': '[ZH] Controls who can see your attendee profile. You can change this after registration too.' },
    }),
    fd('skills_expertise', { en: 'Skills / Expertise', de: 'Fähigkeiten / Fachgebiete', fr: 'Compétences / Expertise', it: 'Competenze / Specializzazioni', 'zh-TW': '技能與專業領域' }, 'multi-select', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 6,
      helpText: { en: 'Select your areas of expertise in robotics.', de: 'Wählen Sie Ihre Fachgebiete in der Robotik.', fr: 'Sélectionnez vos domaines d\'expertise en robotique.', it: 'Seleziona le tue aree di competenza nella robotica.', 'zh-TW': '請選擇您在機器人領域的專業範疇。' },
      tooltip: { en: 'Select your areas of expertise so we can recommend relevant sessions and connect you with like-minded attendees.', de: '[DE] Select your areas of expertise so we can recommend relevant sessions and connect you with like-minded attendees.', fr: '[FR] Select your areas of expertise so we can recommend relevant sessions and connect you with like-minded attendees.', it: '[IT] Select your areas of expertise so we can recommend relevant sessions and connect you with like-minded attendees.', 'zh-TW': '[ZH] Select your areas of expertise so we can recommend relevant sessions and connect you with like-minded attendees.' },
    }),
    fd('languages_spoken', { en: 'Languages spoken', de: 'Gesprochene Sprachen', fr: 'Langues parlées', it: 'Lingue parlate', 'zh-TW': '使用語言' }, 'multi-select', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 7,
      options: multiOptI18n([
        { en: 'German', de: 'Deutsch', fr: 'Allemand', it: 'Tedesco', 'zh-TW': '德語' },
        { en: 'French', de: 'Französisch', fr: 'Français', it: 'Francese', 'zh-TW': '法語' },
        { en: 'Italian', de: 'Italienisch', fr: 'Italien', it: 'Italiano', 'zh-TW': '義大利語' },
        { en: 'English', de: 'Englisch', fr: 'Anglais', it: 'Inglese', 'zh-TW': '英語' },
        { en: 'Spanish', de: 'Spanisch', fr: 'Espagnol', it: 'Spagnolo', 'zh-TW': '西班牙語' },
        { en: 'Portuguese', de: 'Portugiesisch', fr: 'Portugais', it: 'Portoghese', 'zh-TW': '葡萄牙語' },
        { en: 'Chinese', de: 'Chinesisch', fr: 'Chinois', it: 'Cinese', 'zh-TW': '中文' },
        { en: 'Japanese', de: 'Japanisch', fr: 'Japonais', it: 'Giapponese', 'zh-TW': '日語' },
        { en: 'Korean', de: 'Koreanisch', fr: 'Coréen', it: 'Coreano', 'zh-TW': '韓語' },
        { en: 'Arabic', de: 'Arabisch', fr: 'Arabe', it: 'Arabo', 'zh-TW': '阿拉伯語' },
        { en: 'Russian', de: 'Russisch', fr: 'Russe', it: 'Russo', 'zh-TW': '俄語' },
        { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' },
      ]),
      tooltip: { en: 'Knowing your languages helps us facilitate networking across Switzerland\'s multilingual community.', de: '[DE] Knowing your languages helps us facilitate networking across Switzerland\'s multilingual community.', fr: '[FR] Knowing your languages helps us facilitate networking across Switzerland\'s multilingual community.', it: '[IT] Knowing your languages helps us facilitate networking across Switzerland\'s multilingual community.', 'zh-TW': '[ZH] Knowing your languages helps us facilitate networking across Switzerland\'s multilingual community.' },
    }),
    fd('preferred_meeting_format', { en: 'Preferred meeting format', de: 'Bevorzugtes Meetingformat', fr: 'Format de réunion préféré', it: 'Formato di incontro preferito', 'zh-TW': '偏好的會議形式' }, 'select', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 8,
      options: multiOptI18n([
        { en: '1:1 onsite', de: '1:1 vor Ort', fr: '1:1 sur place', it: '1:1 in loco', 'zh-TW': '一對一現場' },
        { en: 'Group session', de: 'Gruppensitzung', fr: 'Session de groupe', it: 'Sessione di gruppo', 'zh-TW': '團體會議' },
        { en: 'Online / Virtual', de: 'Online / Virtuell', fr: 'En ligne / Virtuel', it: 'Online / Virtuale', 'zh-TW': '線上 / 虛擬' },
        { en: 'Either', de: 'Beides', fr: 'L\'un ou l\'autre', it: 'Qualsiasi', 'zh-TW': '皆可' },
      ]),
      tooltip: { en: 'Tell us how you prefer to meet — we\'ll use this for our matchmaking features.', de: '[DE] Tell us how you prefer to meet — we\'ll use this for our matchmaking features.', fr: '[FR] Tell us how you prefer to meet — we\'ll use this for our matchmaking features.', it: '[IT] Tell us how you prefer to meet — we\'ll use this for our matchmaking features.', 'zh-TW': '[ZH] Tell us how you prefer to meet — we\'ll use this for our matchmaking features.' },
    }),
    fd('community_tags', { en: 'Community Tags', de: 'Community-Tags', fr: 'Tags communauté', it: 'Tag della community', 'zh-TW': '社群標籤' }, 'multi-select', 'community', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      options: multiOptI18n([
        { en: 'Women in Robotics', de: 'Frauen in der Robotik', fr: 'Femmes en robotique', it: 'Donne nella robotica', 'zh-TW': '機器人領域女性' },
        { en: 'Students', de: 'Studierende', fr: 'Étudiants', it: 'Studenti', 'zh-TW': '學生' },
        { en: 'Startup Founders', de: 'Startup-Gründer', fr: 'Fondateurs de startups', it: 'Fondatori di startup', 'zh-TW': '新創企業創辦人' },
        { en: 'Hiring', de: 'Einstellend', fr: 'Recruteurs', it: 'In fase di assunzione', 'zh-TW': '招募中' },
        { en: 'Investors', de: 'Investoren', fr: 'Investisseurs', it: 'Investitori', 'zh-TW': '投資人' },
      ]),
      tooltip: { en: 'Join community groups to connect with like-minded attendees and get invited to special meetups at the event.', de: '[DE] Join community groups to connect with like-minded attendees and get invited to special meetups at the event.', fr: '[FR] Join community groups to connect with like-minded attendees and get invited to special meetups at the event.', it: '[IT] Join community groups to connect with like-minded attendees and get invited to special meetups at the event.', 'zh-TW': '[ZH] Join community groups to connect with like-minded attendees and get invited to special meetups at the event.' },
    }),

    // ── Company Fields ───────────────────────────────────────
    fd('company_name', { en: 'Company / Institution Name', de: 'Firma / Institution', fr: 'Entreprise / Institution', it: 'Azienda / Istituzione', 'zh-TW': '公司 / 機構名稱' }, 'text', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 0,
    }),
    fd('company_website', { en: 'Company Website', de: 'Firmenwebsite', fr: 'Site web', it: 'Sito web aziendale', 'zh-TW': '公司網站' }, 'url', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 1,
    }),
    fd('company_email', { en: 'Company Email', de: 'Firmen-E-Mail', fr: 'E-mail entreprise', it: 'E-mail aziendale', 'zh-TW': '公司電子郵件' }, 'email', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
    }),
    // industry_sector: Options are synced daily from WP `robotics_field` taxonomy
    // by TaxonomySyncService. The hardcoded list below serves as initial fallback
    // only — it will be overwritten on the first successful sync.
    fd('industry_sector', { en: 'Industry / Sector', de: 'Branche / Sektor', fr: 'Industrie / Secteur', it: 'Settore industriale', 'zh-TW': '產業 / 領域' }, 'multi-select', 'company', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
      options: multiOptI18n([
        { en: 'Manufacturing', de: 'Fertigung', fr: 'Fabrication', it: 'Manifattura', 'zh-TW': '製造業' },
        { en: 'Medical', de: 'Medizin', fr: 'Médical', it: 'Medicale', 'zh-TW': '醫療' },
        { en: 'Logistics', de: 'Logistik', fr: 'Logistique', it: 'Logistica', 'zh-TW': '物流' },
        { en: 'Energy', de: 'Energie', fr: 'Énergie', it: 'Energia', 'zh-TW': '能源' },
        { en: 'Defense', de: 'Verteidigung', fr: 'Défense', it: 'Difesa', 'zh-TW': '國防' },
        { en: 'Education', de: 'Bildung', fr: 'Éducation', it: 'Istruzione', 'zh-TW': '教育' },
        { en: 'Research', de: 'Forschung', fr: 'Recherche', it: 'Ricerca', 'zh-TW': '研究' },
        { en: 'Agriculture', de: 'Landwirtschaft', fr: 'Agriculture', it: 'Agricoltura', 'zh-TW': '農業' },
        { en: 'Automotive', de: 'Automobilbranche', fr: 'Automobile', it: 'Automotive', 'zh-TW': '汽車產業' },
        { en: 'Aerospace', de: 'Luft- und Raumfahrt', fr: 'Aérospatiale', it: 'Aerospaziale', 'zh-TW': '航太' },
        { en: 'Construction', de: 'Bauwesen', fr: 'Construction', it: 'Edilizia', 'zh-TW': '營建業' },
        { en: 'Retail', de: 'Einzelhandel', fr: 'Commerce de détail', it: 'Vendita al dettaglio', 'zh-TW': '零售業' },
        { en: 'Finance', de: 'Finanzwesen', fr: 'Finance', it: 'Finanza', 'zh-TW': '金融業' },
        { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' },
      ]),
      tooltip: { en: 'Helps us understand which industries are represented and tailor content accordingly.', de: '[DE] Helps us understand which industries are represented and tailor content accordingly.', fr: '[FR] Helps us understand which industries are represented and tailor content accordingly.', it: '[IT] Helps us understand which industries are represented and tailor content accordingly.', 'zh-TW': '[ZH] Helps us understand which industries are represented and tailor content accordingly.' },
    }),
    fd('company_size', { en: 'Company Size', de: 'Firmengrösse', fr: 'Taille entreprise', it: 'Dimensione azienda', 'zh-TW': '公司規模' }, 'select', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
      options: multiOpt(['1–10', '11–50', '51–200', '201–1000', '1000+']),
      tooltip: { en: 'Company size helps us group attendees for relevant networking sessions (startup meetups, enterprise roundtables, etc.).', de: '[DE] Company size helps us group attendees for relevant networking sessions (startup meetups, enterprise roundtables, etc.).', fr: '[FR] Company size helps us group attendees for relevant networking sessions (startup meetups, enterprise roundtables, etc.).', it: '[IT] Company size helps us group attendees for relevant networking sessions (startup meetups, enterprise roundtables, etc.).', 'zh-TW': '[ZH] Company size helps us group attendees for relevant networking sessions (startup meetups, enterprise roundtables, etc.).' },
    }),
    fd('hq_country', { en: 'HQ Country', de: 'Hauptsitz Land', fr: 'Pays du siège', it: 'Paese della sede', 'zh-TW': '總部國家' }, 'country', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
    }),
    fd('company_linkedin', { en: 'Company LinkedIn', de: 'Firmen-LinkedIn', fr: 'LinkedIn entreprise', it: 'LinkedIn aziendale', 'zh-TW': '公司 LinkedIn' }, 'url', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
    }),
    fd('add_to_robotics_map', { en: 'Add company to the Swiss Robotics Map?', de: 'Firma auf der Robotics Map hinzufügen?', fr: 'Ajouter à la carte Robotics ?', it: 'Aggiungere alla Swiss Robotics Map?', 'zh-TW': '是否將公司加入瑞士機器人地圖？' }, 'yes-no', 'company', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 7,
      categoryFilter: ['legal'],
      helpText: { en: 'If yes, your company/institution will be added to the Swiss Robotics Map on swiss-robotics.org.', de: 'Falls ja, wird Ihre Firma auf der Swiss Robotics Map auf swiss-robotics.org eingetragen.', fr: 'Si oui, votre entreprise sera ajoutée à la carte Robotics sur swiss-robotics.org.', it: 'Se sì, la vostra azienda verrà aggiunta alla Swiss Robotics Map su swiss-robotics.org.', 'zh-TW': '若選「是」，您的公司或機構將被加入 swiss-robotics.org 的瑞士機器人地圖。' },
      tooltip: { en: 'The Swiss Robotics Map is a public directory of robotics organizations in Switzerland. Opting in gives your company free visibility.', de: '[DE] The Swiss Robotics Map is a public directory of robotics organizations in Switzerland. Opting in gives your company free visibility.', fr: '[FR] The Swiss Robotics Map is a public directory of robotics organizations in Switzerland. Opting in gives your company free visibility.', it: '[IT] The Swiss Robotics Map is a public directory of robotics organizations in Switzerland. Opting in gives your company free visibility.', 'zh-TW': '[ZH] The Swiss Robotics Map is a public directory of robotics organizations in Switzerland. Opting in gives your company free visibility.' },
    }),
    fd('create_company_profile', { en: 'Create a Company Profile on SRA?', de: 'Firmenprofil auf SRA erstellen?', fr: 'Créer un profil entreprise SRA ?', it: 'Creare un profilo aziendale su SRA?', 'zh-TW': '是否在 SRA 建立公司簡介？' }, 'yes-no', 'company', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 8,
      categoryFilter: ['legal'],
      helpText: { en: 'If yes, a corporate member profile page will be created on swiss-robotics.org.', de: 'Falls ja, wird eine Firmenmitgliedsseite auf swiss-robotics.org erstellt.', fr: 'Si oui, une page de profil d\'entreprise sera créée sur swiss-robotics.org.', it: 'Se sì, verrà creata una pagina profilo aziendale su swiss-robotics.org.', 'zh-TW': '若選「是」，將在 swiss-robotics.org 上建立企業會員簡介頁面。' },
      tooltip: { en: 'A company profile on swiss-robotics.org gives your organization a dedicated page with logo, description, and contact info visible to the SRA community.', de: '[DE] A company profile on swiss-robotics.org gives your organization a dedicated page with logo, description, and contact info visible to the SRA community.', fr: '[FR] A company profile on swiss-robotics.org gives your organization a dedicated page with logo, description, and contact info visible to the SRA community.', it: '[IT] A company profile on swiss-robotics.org gives your organization a dedicated page with logo, description, and contact info visible to the SRA community.', 'zh-TW': '[ZH] A company profile on swiss-robotics.org gives your organization a dedicated page with logo, description, and contact info visible to the SRA community.' },
    }),

    // ── Privacy / Sharing Toggles ───────────────────────────
    fd('allow_messaging', { en: 'Allow attendees to message me in-platform', de: 'Nachrichten erlauben', fr: 'Autoriser les messages', it: 'Consentire messaggi da altri partecipanti', 'zh-TW': '允許與會者透過平台傳送訊息給我' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      tooltip: { en: 'When enabled, other attendees can send you messages through the event platform. Your email stays hidden.', de: '[DE] When enabled, other attendees can send you messages through the event platform. Your email stays hidden.', fr: '[FR] When enabled, other attendees can send you messages through the event platform. Your email stays hidden.', it: '[IT] When enabled, other attendees can send you messages through the event platform. Your email stays hidden.', 'zh-TW': '[ZH] When enabled, other attendees can send you messages through the event platform. Your email stays hidden.' },
    }),
    fd('show_email', { en: 'Allow attendees to see my email', de: 'E-Mail anzeigen', fr: 'Afficher mon e-mail', it: 'Mostrare la mia e-mail ai partecipanti', 'zh-TW': '允許與會者查看我的電子郵件' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      defaultValue: false,
      helpText: { en: 'Defaults to OFF for your privacy.', de: 'Standardmässig deaktiviert.', fr: 'Désactivé par défaut pour votre confidentialité.', it: 'Disattivato per impostazione predefinita.', 'zh-TW': '預設為關閉以保護您的隱私。' },
      tooltip: { en: 'By default, your email is hidden. Enable this only if you want other attendees to see and contact you directly via email.', de: '[DE] By default, your email is hidden. Enable this only if you want other attendees to see and contact you directly via email.', fr: '[FR] By default, your email is hidden. Enable this only if you want other attendees to see and contact you directly via email.', it: '[IT] By default, your email is hidden. Enable this only if you want other attendees to see and contact you directly via email.', 'zh-TW': '[ZH] By default, your email is hidden. Enable this only if you want other attendees to see and contact you directly via email.' },
    }),
    fd('allow_exhibitor_contact', { en: 'Allow exhibitors/sponsors to contact me', de: 'Kontakt durch Aussteller erlauben', fr: 'Autoriser le contact par les exposants', it: 'Consentire il contatto da espositori/sponsor', 'zh-TW': '允許展商/贊助商聯繫我' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
      tooltip: { en: 'Exhibitors and sponsors may want to follow up about products or services you showed interest in.', de: '[DE] Exhibitors and sponsors may want to follow up about products or services you showed interest in.', fr: '[FR] Exhibitors and sponsors may want to follow up about products or services you showed interest in.', it: '[IT] Exhibitors and sponsors may want to follow up about products or services you showed interest in.', 'zh-TW': '[ZH] Exhibitors and sponsors may want to follow up about products or services you showed interest in.' },
    }),
    fd('share_with_sponsors', { en: 'Allow my info to be shared with sponsors', de: 'Infos mit Sponsoren teilen', fr: 'Partager mes infos avec les sponsors', it: 'Condividere le mie informazioni con gli sponsor', 'zh-TW': '允許將我的資料分享給贊助商' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
      tooltip: { en: 'Event sponsors may receive a list of attendees who opted in. Your data is never shared without your explicit consent here.', de: '[DE] Event sponsors may receive a list of attendees who opted in. Your data is never shared without your explicit consent here.', fr: '[FR] Event sponsors may receive a list of attendees who opted in. Your data is never shared without your explicit consent here.', it: '[IT] Event sponsors may receive a list of attendees who opted in. Your data is never shared without your explicit consent here.', 'zh-TW': '[ZH] Event sponsors may receive a list of attendees who opted in. Your data is never shared without your explicit consent here.' },
    }),
    fd('allow_b2b_qr_scan', { en: 'Allow B2B QR scan exchanges', de: 'B2B QR-Scan erlauben', fr: 'Autoriser échanges QR B2B', it: 'Consentire lo scambio tramite scansione QR B2B', 'zh-TW': '允許 B2B QR Code 交換' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
      tooltip: { en: 'When enabled, other attendees can scan your badge QR code to instantly exchange contact details — great for networking!', de: '[DE] When enabled, other attendees can scan your badge QR code to instantly exchange contact details — great for networking!', fr: '[FR] When enabled, other attendees can scan your badge QR code to instantly exchange contact details — great for networking!', it: '[IT] When enabled, other attendees can scan your badge QR code to instantly exchange contact details — great for networking!', 'zh-TW': '[ZH] When enabled, other attendees can scan your badge QR code to instantly exchange contact details — great for networking!' },
    }),

    // ── B2B / Networking Questions ──────────────────────────
    fd('purchasing_decisions', { en: 'Are you involved in purchasing decisions?', de: 'Sind Sie an Kaufentscheidungen beteiligt?', fr: 'Participez-vous aux décisions d\'achat ?', it: 'Siete coinvolti nelle decisioni di acquisto?', 'zh-TW': '您是否參與採購決策？' }, 'yes-no', 'b2b', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 0,
      tooltip: { en: 'Lets exhibitors know if you have decision-making power — they can prioritize demos and meetings accordingly.', de: '[DE] Lets exhibitors know if you have decision-making power — they can prioritize demos and meetings accordingly.', fr: '[FR] Lets exhibitors know if you have decision-making power — they can prioritize demos and meetings accordingly.', it: '[IT] Lets exhibitors know if you have decision-making power — they can prioritize demos and meetings accordingly.', 'zh-TW': '[ZH] Lets exhibitors know if you have decision-making power — they can prioritize demos and meetings accordingly.' },
    }),
    fd('buying_timeframe', { en: 'Buying timeframe', de: 'Kaufzeitraum', fr: 'Délai d\'achat', it: 'Tempistica di acquisto', 'zh-TW': '採購時程' }, 'select', 'b2b', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 1,
      options: multiOptI18n([
        { en: '0–3 months', de: '0–3 Monate', fr: '0–3 mois', it: '0–3 mesi', 'zh-TW': '0–3 個月' },
        { en: '3–6 months', de: '3–6 Monate', fr: '3–6 mois', it: '3–6 mesi', 'zh-TW': '3–6 個月' },
        { en: '6–12 months', de: '6–12 Monate', fr: '6–12 mois', it: '6–12 mesi', 'zh-TW': '6–12 個月' },
        { en: '12+ months', de: '12+ Monate', fr: 'Plus de 12 mois', it: 'Oltre 12 mesi', 'zh-TW': '12 個月以上' },
        { en: 'Just exploring', de: 'Nur orientieren', fr: 'Juste en exploration', it: 'Solo esplorazione', 'zh-TW': '僅在探索階段' },
      ]),
      tooltip: { en: 'Helps exhibitors understand your buying stage so they can tailor their conversations.', de: '[DE] Helps exhibitors understand your buying stage so they can tailor their conversations.', fr: '[FR] Helps exhibitors understand your buying stage so they can tailor their conversations.', it: '[IT] Helps exhibitors understand your buying stage so they can tailor their conversations.', 'zh-TW': '[ZH] Helps exhibitors understand your buying stage so they can tailor their conversations.' },
    }),
    fd('interested_in_demos', { en: 'Interested in demos/meetings during event', de: 'Interesse an Demos/Meetings', fr: 'Intéressé par des démos/réunions', it: 'Interessato a demo/incontri durante l\'evento', 'zh-TW': '是否有興趣在活動期間參加展示或會議' }, 'multi-select', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
      tooltip: { en: 'Select which demos or meetings you\'d like to attend, so exhibitors can prepare and reserve time for you.', de: '[DE] Select which demos or meetings you\'d like to attend, so exhibitors can prepare and reserve time for you.', fr: '[FR] Select which demos or meetings you\'d like to attend, so exhibitors can prepare and reserve time for you.', it: '[IT] Select which demos or meetings you\'d like to attend, so exhibitors can prepare and reserve time for you.', 'zh-TW': '[ZH] Select which demos or meetings you\'d like to attend, so exhibitors can prepare and reserve time for you.' },
    }),
    fd('looking_for', { en: 'What are you looking for?', de: 'Was suchen Sie?', fr: 'Que recherchez-vous ?', it: 'Cosa state cercando?', 'zh-TW': '您在尋找什麼？' }, 'multi-select', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
      options: multiOptI18n([
        { en: 'Robots', de: 'Roboter', fr: 'Robots', it: 'Robot', 'zh-TW': '機器人' },
        { en: 'Sensors', de: 'Sensoren', fr: 'Capteurs', it: 'Sensori', 'zh-TW': '感測器' },
        { en: 'Vision', de: 'Bildverarbeitung', fr: 'Vision', it: 'Visione', 'zh-TW': '視覺系統' },
        { en: 'Actuators', de: 'Aktoren', fr: 'Actionneurs', it: 'Attuatori', 'zh-TW': '致動器' },
        { en: 'Software', de: 'Software', fr: 'Logiciels', it: 'Software', 'zh-TW': '軟體' },
        { en: 'Integrators', de: 'Systemintegratoren', fr: 'Intégrateurs', it: 'Integratori', 'zh-TW': '系統整合商' },
        { en: 'Research Partnerships', de: 'Forschungspartnerschaften', fr: 'Partenariats de recherche', it: 'Partnership di ricerca', 'zh-TW': '研究合作夥伴' },
        { en: 'Funding', de: 'Finanzierung', fr: 'Financement', it: 'Finanziamenti', 'zh-TW': '資金' },
      ]),
      tooltip: { en: 'Tell us what you\'re looking for so we can match you with the right exhibitors and attendees.', de: '[DE] Tell us what you\'re looking for so we can match you with the right exhibitors and attendees.', fr: '[FR] Tell us what you\'re looking for so we can match you with the right exhibitors and attendees.', it: '[IT] Tell us what you\'re looking for so we can match you with the right exhibitors and attendees.', 'zh-TW': '[ZH] Tell us what you\'re looking for so we can match you with the right exhibitors and attendees.' },
    }),
    fd('agree_exhibitor_contact', { en: 'I agree to be contacted by exhibitors/sponsors', de: 'Kontakt durch Aussteller', fr: 'Contact par exposants', it: 'Acconsento ad essere contattato da espositori/sponsor', 'zh-TW': '我同意展商/贊助商與我聯繫' }, 'yes-no', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
      tooltip: { en: 'Allows exhibitors and sponsors to contact you after the event about products or collaborations discussed.', de: '[DE] Allows exhibitors and sponsors to contact you after the event about products or collaborations discussed.', fr: '[FR] Allows exhibitors and sponsors to contact you after the event about products or collaborations discussed.', it: '[IT] Allows exhibitors and sponsors to contact you after the event about products or collaborations discussed.', 'zh-TW': '[ZH] Allows exhibitors and sponsors to contact you after the event about products or collaborations discussed.' },
    }),
    fd('share_b2b_profile', { en: 'I agree to share my B2B profile with attendees', de: 'B2B-Profil teilen', fr: 'Partager profil B2B', it: 'Acconsento a condividere il mio profilo B2B con i partecipanti', 'zh-TW': '我同意與其他與會者分享我的 B2B 個人檔案' }, 'yes-no', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 5,
      tooltip: { en: 'Shares your professional profile (name, company, interests) with other attendees for networking purposes.', de: '[DE] Shares your professional profile (name, company, interests) with other attendees for networking purposes.', fr: '[FR] Shares your professional profile (name, company, interests) with other attendees for networking purposes.', it: '[IT] Shares your professional profile (name, company, interests) with other attendees for networking purposes.', 'zh-TW': '[ZH] Shares your professional profile (name, company, interests) with other attendees for networking purposes.' },
    }),
    fd('want_to_meet', { en: 'I want to meet', de: 'Ich möchte treffen', fr: 'Je veux rencontrer', it: 'Vorrei incontrare', 'zh-TW': '我想認識' }, 'multi-select', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      options: multiOptI18n([
        { en: 'Buyers', de: 'Einkäufer', fr: 'Acheteurs', it: 'Acquirenti', 'zh-TW': '買家' },
        { en: 'Vendors', de: 'Anbieter', fr: 'Fournisseurs', it: 'Fornitori', 'zh-TW': '供應商' },
        { en: 'Investors', de: 'Investoren', fr: 'Investisseurs', it: 'Investitori', 'zh-TW': '投資人' },
        { en: 'Founders', de: 'Gründer', fr: 'Fondateurs', it: 'Fondatori', 'zh-TW': '創辦人' },
        { en: 'Researchers', de: 'Forscher', fr: 'Chercheurs', it: 'Ricercatori', 'zh-TW': '研究人員' },
        { en: 'Students', de: 'Studierende', fr: 'Étudiants', it: 'Studenti', 'zh-TW': '學生' },
        { en: 'Recruiters', de: 'Recruiter', fr: 'Recruteurs', it: 'Recruiter', 'zh-TW': '招募人員' },
      ]),
      tooltip: { en: 'Tell us who you\'d like to meet, and we\'ll try to facilitate introductions at the event.', de: '[DE] Tell us who you\'d like to meet, and we\'ll try to facilitate introductions at the event.', fr: '[FR] Tell us who you\'d like to meet, and we\'ll try to facilitate introductions at the event.', it: '[IT] Tell us who you\'d like to meet, and we\'ll try to facilitate introductions at the event.', 'zh-TW': '[ZH] Tell us who you\'d like to meet, and we\'ll try to facilitate introductions at the event.' },
    }),
    fd('collaboration_interests', { en: 'Collaboration interests', de: 'Kooperationsinteressen', fr: 'Intérêts de collaboration', it: 'Interessi di collaborazione', 'zh-TW': '合作意向' }, 'multi-select', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      options: multiOptI18n([
        { en: 'R&D Partnership', de: 'F&E-Partnerschaft', fr: 'Partenariat R&D', it: 'Partnership R&S', 'zh-TW': '研發合作' },
        { en: 'Pilot Projects', de: 'Pilotprojekte', fr: 'Projets pilotes', it: 'Progetti pilota', 'zh-TW': '試行計畫' },
        { en: 'Distribution', de: 'Vertrieb', fr: 'Distribution', it: 'Distribuzione', 'zh-TW': '經銷通路' },
        { en: 'Hiring', de: 'Einstellung', fr: 'Recrutement', it: 'Assunzioni', 'zh-TW': '人才招募' },
        { en: 'Funding', de: 'Finanzierung', fr: 'Financement', it: 'Finanziamenti', 'zh-TW': '融資' },
        { en: 'Media', de: 'Medien', fr: 'Médias', it: 'Media', 'zh-TW': '媒體' },
      ]),
      tooltip: { en: 'Select your collaboration interests so we can suggest relevant networking sessions and matchmaking.', de: '[DE] Select your collaboration interests so we can suggest relevant networking sessions and matchmaking.', fr: '[FR] Select your collaboration interests so we can suggest relevant networking sessions and matchmaking.', it: '[IT] Select your collaboration interests so we can suggest relevant networking sessions and matchmaking.', 'zh-TW': '[ZH] Select your collaboration interests so we can suggest relevant networking sessions and matchmaking.' },
    }),
    fd('what_offering', { en: 'What I\'m offering', de: 'Was ich anbiete', fr: 'Ce que j\'offre', it: 'Cosa offro', 'zh-TW': '我能提供' }, 'multi-select', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      options: multiOptI18n([
        { en: 'Capital', de: 'Kapital', fr: 'Capital', it: 'Capitale', 'zh-TW': '資金' },
        { en: 'Expertise', de: 'Expertise', fr: 'Expertise', it: 'Competenze', 'zh-TW': '專業知識' },
        { en: 'Products', de: 'Produkte', fr: 'Produits', it: 'Prodotti', 'zh-TW': '產品' },
        { en: 'Research', de: 'Forschung', fr: 'Recherche', it: 'Ricerca', 'zh-TW': '研究成果' },
        { en: 'Hiring', de: 'Stellen', fr: 'Emplois', it: 'Posizioni lavorative', 'zh-TW': '工作機會' },
        { en: 'Speaking', de: 'Vorträge', fr: 'Conférences', it: 'Interventi', 'zh-TW': '演講分享' },
      ]),
      tooltip: { en: 'What can you bring to the table? Helps other attendees find you for the right opportunities.', de: '[DE] What can you bring to the table? Helps other attendees find you for the right opportunities.', fr: '[FR] What can you bring to the table? Helps other attendees find you for the right opportunities.', it: '[IT] What can you bring to the table? Helps other attendees find you for the right opportunities.', 'zh-TW': '[ZH] What can you bring to the table? Helps other attendees find you for the right opportunities.' },
    }),
    fd('what_seeking', { en: 'What I\'m seeking', de: 'Was ich suche', fr: 'Ce que je recherche', it: 'Cosa cerco', 'zh-TW': '我正在尋找' }, 'multi-select', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
      options: multiOptI18n([
        { en: 'Capital', de: 'Kapital', fr: 'Capital', it: 'Capitale', 'zh-TW': '資金' },
        { en: 'Expertise', de: 'Expertise', fr: 'Expertise', it: 'Competenze', 'zh-TW': '專業知識' },
        { en: 'Products', de: 'Produkte', fr: 'Produits', it: 'Prodotti', 'zh-TW': '產品' },
        { en: 'Research', de: 'Forschung', fr: 'Recherche', it: 'Ricerca', 'zh-TW': '研究資源' },
        { en: 'Hiring', de: 'Einstellungen', fr: 'Recrutement', it: 'Assunzioni', 'zh-TW': '人才' },
        { en: 'Speaking', de: 'Redner', fr: 'Conférenciers', it: 'Relatori', 'zh-TW': '演講機會' },
      ]),
      tooltip: { en: 'What are you looking for? Helps us match you with the right people and opportunities.', de: '[DE] What are you looking for? Helps us match you with the right people and opportunities.', fr: '[FR] What are you looking for? Helps us match you with the right people and opportunities.', it: '[IT] What are you looking for? Helps us match you with the right people and opportunities.', 'zh-TW': '[ZH] What are you looking for? Helps us match you with the right people and opportunities.' },
    }),
    fd('topics_happy_to_talk', { en: 'Topics I\'m happy to talk about', de: 'Themen über die ich spreche', fr: 'Sujets dont j\'aime parler', it: 'Argomenti di cui parlo volentieri', 'zh-TW': '我樂意聊的話題' }, 'multi-select', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
      options: multiOptI18n([
        { en: 'Robotics applications', de: 'Robotikanwendungen', fr: 'Applications robotiques', it: 'Applicazioni robotiche', 'zh-TW': '機器人應用' },
        { en: 'AI and autonomy', de: 'KI und Autonomie', fr: 'IA et autonomie', it: 'IA e autonomia', 'zh-TW': '人工智慧與自主系統' },
        { en: 'Manufacturing and automation', de: 'Fertigung und Automatisierung', fr: 'Fabrication et automatisation', it: 'Produzione e automazione', 'zh-TW': '製造與自動化' },
        { en: 'Research and academia', de: 'Forschung und Hochschulen', fr: 'Recherche et milieu académique', it: 'Ricerca e mondo accademico', 'zh-TW': '研究與學術界' },
        { en: 'Startups and entrepreneurship', de: 'Startups und Unternehmertum', fr: 'Startups et entrepreneuriat', it: 'Startup e imprenditorialità', 'zh-TW': '新創與創業' },
        { en: 'Investment and funding', de: 'Investitionen und Finanzierung', fr: 'Investissement et financement', it: 'Investimenti e finanziamenti', 'zh-TW': '投資與資金' },
        { en: 'Hiring and careers', de: 'Recruiting und Karriere', fr: 'Recrutement et carrières', it: 'Recruiting e carriere', 'zh-TW': '招募與職涯' },
        { en: 'Partnerships and collaboration', de: 'Partnerschaften und Zusammenarbeit', fr: 'Partenariats et collaboration', it: 'Partnership e collaborazione', 'zh-TW': '合作夥伴與協作' },
        { en: 'Swiss robotics ecosystem', de: 'Schweizer Robotik-Ökosystem', fr: 'Écosystème suisse de la robotique', it: 'Ecosistema svizzero della robotica', 'zh-TW': '瑞士機器人生態系' },
        { en: 'Ethics and regulation', de: 'Ethik und Regulierung', fr: 'Éthique et réglementation', it: 'Etica e regolamentazione', 'zh-TW': '倫理與法規' },
      ]),
      tooltip: { en: 'Topics you\'re happy to discuss casually. Shown on your profile to encourage spontaneous conversations.', de: '[DE] Topics you\'re happy to discuss casually. Shown on your profile to encourage spontaneous conversations.', fr: '[FR] Topics you\'re happy to discuss casually. Shown on your profile to encourage spontaneous conversations.', it: '[IT] Topics you\'re happy to discuss casually. Shown on your profile to encourage spontaneous conversations.', 'zh-TW': '[ZH] Topics you\'re happy to discuss casually. Shown on your profile to encourage spontaneous conversations.' },
    }),

    // ── Event Questions ─────────────────────────────────────
    fd('dietary_requirements', { en: 'Dietary requirements', de: 'Ernährungsbedürfnisse', fr: 'Régime alimentaire', it: 'Esigenze alimentari', 'zh-TW': '飲食需求' }, 'multi-select', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
      options: multiOptI18n([
        { en: 'Vegetarian', de: 'Vegetarisch', fr: 'Végétarien', it: 'Vegetariano', 'zh-TW': '素食' },
        { en: 'Vegan', de: 'Vegan', fr: 'Végan', it: 'Vegano', 'zh-TW': '純素' },
        { en: 'Gluten-free', de: 'Glutenfrei', fr: 'Sans gluten', it: 'Senza glutine', 'zh-TW': '無麩質' },
        { en: 'Halal', de: 'Halal', fr: 'Halal', it: 'Halal', 'zh-TW': '清真' },
        { en: 'Kosher', de: 'Koscher', fr: 'Casher', it: 'Kosher', 'zh-TW': '猶太潔食' },
        { en: 'Lactose-free', de: 'Laktosefrei', fr: 'Sans lactose', it: 'Senza lattosio', 'zh-TW': '無乳糖' },
        { en: 'Nut allergy', de: 'Nussallergie', fr: 'Allergie aux noix', it: 'Allergia alla frutta a guscio', 'zh-TW': '堅果過敏' },
        { en: 'No restrictions', de: 'Keine Einschränkungen', fr: 'Aucune restriction', it: 'Nessuna restrizione', 'zh-TW': '無特殊需求' },
      ]),
      tooltip: { en: 'We collect dietary needs so our catering team can point you to safe food options at the event.', de: '[DE] We collect dietary needs so our catering team can point you to safe food options at the event.', fr: '[FR] We collect dietary needs so our catering team can point you to safe food options at the event.', it: '[IT] We collect dietary needs so our catering team can point you to safe food options at the event.', 'zh-TW': '[ZH] We collect dietary needs so our catering team can point you to safe food options at the event.' },
    }),
    fd('badge_name_preference', { en: 'Badge name preference', de: 'Badgename', fr: 'Nom sur le badge', it: 'Nome preferito sul badge', 'zh-TW': '名牌顯示名稱' }, 'text', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
      helpText: { en: 'If different from your first/last name.', de: 'Falls abweichend von Vor-/Nachname.', fr: 'Si différent de votre nom.', it: 'Se diverso dal vostro nome/cognome.', 'zh-TW': '若與您的姓名不同，請填寫。' },
      tooltip: { en: 'If you go by a different name (nickname, preferred name), enter it here and we\'ll print it on your badge.', de: '[DE] If you go by a different name (nickname, preferred name), enter it here and we\'ll print it on your badge.', fr: '[FR] If you go by a different name (nickname, preferred name), enter it here and we\'ll print it on your badge.', it: '[IT] If you go by a different name (nickname, preferred name), enter it here and we\'ll print it on your badge.', 'zh-TW': '[ZH] If you go by a different name (nickname, preferred name), enter it here and we\'ll print it on your badge.' },
    }),
    fd('accessibility_requirements', { en: 'Accessibility requirements', de: 'Barrierefreiheit', fr: 'Besoins d\'accessibilité', it: 'Esigenze di accessibilità', 'zh-TW': '無障礙需求' }, 'textarea', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 7,
      tooltip: { en: 'Let us know about any accessibility needs (wheelchair access, hearing assistance, etc.) so we can ensure a comfortable experience.', de: '[DE] Let us know about any accessibility needs (wheelchair access, hearing assistance, etc.) so we can ensure a comfortable experience.', fr: '[FR] Let us know about any accessibility needs (wheelchair access, hearing assistance, etc.) so we can ensure a comfortable experience.', it: '[IT] Let us know about any accessibility needs (wheelchair access, hearing assistance, etc.) so we can ensure a comfortable experience.', 'zh-TW': '[ZH] Let us know about any accessibility needs (wheelchair access, hearing assistance, etc.) so we can ensure a comfortable experience.' },
    }),
    fd('hotel_needed', { en: 'Hotel needed?', de: 'Hotel benötigt?', fr: 'Hôtel nécessaire ?', it: 'Necessità di hotel?', 'zh-TW': '是否需要住宿？' }, 'yes-no', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 8,
      tooltip: { en: 'We can share information about partner hotels with negotiated rates near the venue.', de: '[DE] We can share information about partner hotels with negotiated rates near the venue.', fr: '[FR] We can share information about partner hotels with negotiated rates near the venue.', it: '[IT] We can share information about partner hotels with negotiated rates near the venue.', 'zh-TW': '[ZH] We can share information about partner hotels with negotiated rates near the venue.' },
    }),
    fd('emergency_contact_name', { en: 'Emergency contact name', de: 'Notfallkontakt Name', fr: 'Contact d\'urgence nom', it: 'Nome contatto di emergenza', 'zh-TW': '緊急聯絡人姓名' }, 'text', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 9,
    }),
    fd('emergency_contact_phone', { en: 'Emergency contact phone', de: 'Notfallkontakt Telefon', fr: 'Contact d\'urgence téléphone', it: 'Telefono contatto di emergenza', 'zh-TW': '緊急聯絡人電話' }, 'phone', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 10,
    }),

    // ── Reduced Ticket Fields ───────────────────────────────
    fd('reduced_status', { en: 'Reduced ticket status', de: 'Ermässigungsstatus', fr: 'Statut de réduction', it: 'Stato riduzione', 'zh-TW': '優惠票身分' }, 'select', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 11,
      options: multiOptI18n([
        { en: 'Unemployed', de: 'Arbeitslos', fr: 'Sans emploi', it: 'Disoccupato', 'zh-TW': '待業中' },
        { en: 'Retired', de: 'Pensioniert', fr: 'Retraité', it: 'In pensione', 'zh-TW': '已退休' },
        { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' },
      ]),
      tooltip: { en: 'Select your status to verify eligibility for the reduced-price ticket.', de: '[DE] Select your status to verify eligibility for the reduced-price ticket.', fr: '[FR] Select your status to verify eligibility for the reduced-price ticket.', it: '[IT] Select your status to verify eligibility for the reduced-price ticket.', 'zh-TW': '[ZH] Select your status to verify eligibility for the reduced-price ticket.' },
    }),
    fd('reduced_note', { en: 'Additional note', de: 'Zusätzliche Bemerkung', fr: 'Remarque supplémentaire', it: 'Nota aggiuntiva', 'zh-TW': '補充說明' }, 'textarea', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 12,
      tooltip: { en: 'Provide any additional context about your reduced ticket eligibility if needed.', de: '[DE] Provide any additional context about your reduced ticket eligibility if needed.', fr: '[FR] Provide any additional context about your reduced ticket eligibility if needed.', it: '[IT] Provide any additional context about your reduced ticket eligibility if needed.', 'zh-TW': '[ZH] Provide any additional context about your reduced ticket eligibility if needed.' },
    }),

    // ── Academic / Institution Fields ────────────────────────
    fd('institution_name', { en: 'Institution Name', de: 'Institutionsname', fr: 'Nom de l\'institution', it: 'Nome istituzione', 'zh-TW': '機構名稱' }, 'text', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 10,
    }),
    fd('institution_department', { en: 'Department / Lab', de: 'Abteilung / Labor', fr: 'Département / Laboratoire', it: 'Dipartimento / Laboratorio', 'zh-TW': '系所 / 實驗室' }, 'text', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 11,
    }),
    fd('academic_role', { en: 'Role', de: 'Rolle', fr: 'Rôle', it: 'Ruolo', 'zh-TW': '職位' }, 'select', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 12,
      options: multiOptI18n([
        { en: 'Faculty', de: 'Fakultät', fr: 'Corps professoral', it: 'Docente', 'zh-TW': '教職員' },
        { en: 'Researcher', de: 'Forscher/in', fr: 'Chercheur/euse', it: 'Ricercatore', 'zh-TW': '研究員' },
        { en: 'Postdoc', de: 'Postdoktorand/in', fr: 'Post-doctorant/e', it: 'Post-doc', 'zh-TW': '博士後研究員' },
        { en: 'PhD student', de: 'Doktorand/in', fr: 'Doctorant/e', it: 'Dottorando', 'zh-TW': '博士生' },
        { en: 'Admin / Staff', de: 'Verwaltung / Personal', fr: 'Administration / Personnel', it: 'Amministrazione / Staff', 'zh-TW': '行政人員' },
        { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' },
      ]),
    }),
    fd('research_areas', { en: 'Research / Technology Areas', de: 'Forschungs- / Technologiebereiche', fr: 'Domaines de recherche / technologie', it: 'Aree di ricerca / tecnologia', 'zh-TW': '研究 / 技術領域' }, 'multi-select', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 13,
      options: roboticsExpertiseAreas(),
      helpText: { en: 'Select your areas of research in robotics.', de: 'Wählen Sie Ihre Forschungsbereiche in der Robotik.', fr: 'Sélectionnez vos domaines de recherche en robotique.', it: 'Seleziona le tue aree di ricerca nella robotica.', 'zh-TW': '請選擇您在機器人領域的研究範疇。' },
      tooltip: { en: 'Select your research areas so we can suggest relevant talks, posters, and potential collaborators.', de: '[DE] Select your research areas so we can suggest relevant talks, posters, and potential collaborators.', fr: '[FR] Select your research areas so we can suggest relevant talks, posters, and potential collaborators.', it: '[IT] Select your research areas so we can suggest relevant talks, posters, and potential collaborators.', 'zh-TW': '[ZH] Select your research areas so we can suggest relevant talks, posters, and potential collaborators.' },
    }),

    // ── Student Fields ──────────────────────────────────────
    fd('student_institution', { en: 'University / School', de: 'Universität / Schule', fr: 'Université / École', it: 'Università / Scuola', 'zh-TW': '大學 / 學校' }, 'text', 'student', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 0,
      categoryFilter: ['individual'],
    }),
    fd('student_level', { en: 'Study Level', de: 'Studienstufe', fr: 'Niveau d\'études', it: 'Livello di studio', 'zh-TW': '學歷程度' }, 'select', 'student', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 1,
      categoryFilter: ['individual'],
      options: [
        { value: 'bsc', label: { en: 'Bachelor\'s (BSc)', de: 'Bachelor (BSc)', fr: 'Bachelor (BSc)', it: 'Bachelor (BSc)', 'zh-TW': '學士 (BSc)' } },
        { value: 'msc', label: { en: 'Master\'s (MSc)', de: 'Master (MSc)', fr: 'Master (MSc)', it: 'Master (MSc)', 'zh-TW': '碩士 (MSc)' } },
        { value: 'phd', label: { en: 'PhD', de: 'Doktorat', fr: 'Doctorat', it: 'Dottorato', 'zh-TW': '博士' } },
      ],
    }),
    fd('student_field_of_study', { en: 'Field of Study', de: 'Studienrichtung', fr: 'Domaine d\'études', it: 'Campo di studio', 'zh-TW': '研究領域' }, 'text', 'student', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      categoryFilter: ['individual'],
    }),
    fd('student_graduation_year', { en: 'Graduation Year', de: 'Abschlussjahr', fr: 'Année de diplôme', it: 'Anno di laurea', 'zh-TW': '畢業年份' }, 'text', 'student', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 3,
      categoryFilter: ['individual'],
      validation: { pattern: '[0-9]{4}' },
      placeholder: { en: 'e.g. 2026', de: 'z.B. 2026', fr: 'ex. 2026', it: 'es. 2026', 'zh-TW': '例：2026' },
    }),
    fd('student_in_progress', { en: 'Diploma in progress', de: 'Studium laufend', fr: 'Diplôme en cours', it: 'Diploma in corso', 'zh-TW': '在學中' }, 'checkbox', 'student', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 4,
      categoryFilter: ['individual'],
    }),
    fd('student_supervisor', { en: 'Supervisor / Lab', de: 'Betreuer/in / Labor', fr: 'Superviseur / Laboratoire', it: 'Supervisore / Laboratorio', 'zh-TW': '指導教授 / 實驗室' }, 'text', 'student', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
      categoryFilter: ['individual'],
      tooltip: { en: 'Sharing your supervisor or lab helps other researchers and companies find you for collaboration or hiring.', de: '[DE] Sharing your supervisor or lab helps other researchers and companies find you for collaboration or hiring.', fr: '[FR] Sharing your supervisor or lab helps other researchers and companies find you for collaboration or hiring.', it: '[IT] Sharing your supervisor or lab helps other researchers and companies find you for collaboration or hiring.', 'zh-TW': '[ZH] Sharing your supervisor or lab helps other researchers and companies find you for collaboration or hiring.' },
    }),
    fd('student_seeking', { en: 'Seeking opportunities', de: 'Suche nach Möglichkeiten', fr: 'Recherche d\'opportunités', it: 'Cerco opportunità', 'zh-TW': '尋求機會' }, 'multi-select', 'student', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 6,
      categoryFilter: ['individual'],
      options: multiOptI18n([
        { en: 'Internship', de: 'Praktikum', fr: 'Stage', it: 'Tirocinio', 'zh-TW': '實習' },
        { en: 'Thesis project', de: 'Abschlussarbeit', fr: 'Projet de thèse', it: 'Progetto di tesi', 'zh-TW': '畢業論文專案' },
        { en: 'Full-time position', de: 'Vollzeitstelle', fr: 'Poste à plein temps', it: 'Posizione a tempo pieno', 'zh-TW': '全職工作' },
      ]),
      tooltip: { en: 'Let companies and researchers know what opportunities you\'re looking for.', de: '[DE] Let companies and researchers know what opportunities you\'re looking for.', fr: '[FR] Let companies and researchers know what opportunities you\'re looking for.', it: '[IT] Let companies and researchers know what opportunities you\'re looking for.', 'zh-TW': '[ZH] Let companies and researchers know what opportunities you\'re looking for.' },
    }),

    // ── Startup Fields ──────────────────────────────────────
    fd('startup_incorporated_recently', { en: 'Company incorporated within last 5 years', de: 'Firma in den letzten 5 Jahren gegründet', fr: 'Société constituée il y a moins de 5 ans', it: 'Società costituita negli ultimi 5 anni', 'zh-TW': '公司於過去 5 年內成立' }, 'checkbox', 'startup', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      categoryFilter: ['individual', 'legal'],
      tooltip: { en: 'Confirms startup status for access to special startup programs, pitching sessions, and networking events.', de: '[DE] Confirms startup status for access to special startup programs, pitching sessions, and networking events.', fr: '[FR] Confirms startup status for access to special startup programs, pitching sessions, and networking events.', it: '[IT] Confirms startup status for access to special startup programs, pitching sessions, and networking events.', 'zh-TW': '[ZH] Confirms startup status for access to special startup programs, pitching sessions, and networking events.' },
    }),
    fd('startup_incorporation_year', { en: 'Incorporation Year', de: 'Gründungsjahr', fr: 'Année de création', it: 'Anno di costituzione', 'zh-TW': '成立年份' }, 'text', 'startup', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 1,
      categoryFilter: ['individual', 'legal'],
      validation: { pattern: '[0-9]{4}' },
      placeholder: { en: 'e.g. 2023', de: 'z.B. 2023', fr: 'ex. 2023', it: 'es. 2023', 'zh-TW': '例：2023' },
    }),
    fd('startup_pitch_deck_url', { en: 'Website / Pitch Deck URL', de: 'Website / Pitch Deck URL', fr: 'Site web / URL du pitch deck', it: 'Sito web / URL pitch deck', 'zh-TW': '網站 / 簡報連結' }, 'url', 'startup', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      categoryFilter: ['individual', 'legal'],
      tooltip: { en: 'Share your pitch deck so investors and potential partners can learn about your startup before the event.', de: '[DE] Share your pitch deck so investors and potential partners can learn about your startup before the event.', fr: '[FR] Share your pitch deck so investors and potential partners can learn about your startup before the event.', it: '[IT] Share your pitch deck so investors and potential partners can learn about your startup before the event.', 'zh-TW': '[ZH] Share your pitch deck so investors and potential partners can learn about your startup before the event.' },
    }),
    fd('startup_team_size', { en: 'Team Size', de: 'Teamgrösse', fr: 'Taille de l\'équipe', it: 'Dimensione del team', 'zh-TW': '團隊規模' }, 'select', 'startup', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 3,
      categoryFilter: ['individual', 'legal'],
      options: multiOpt(['1–5', '6–15', '16–50', '50+']),
    }),
    fd('startup_looking_for', { en: 'What are you looking for?', de: 'Was suchen Sie?', fr: 'Que recherchez-vous ?', it: 'Cosa cercate?', 'zh-TW': '您在尋找什麼？' }, 'multi-select', 'startup', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
      categoryFilter: ['individual', 'legal'],
      options: multiOptI18n([
        { en: 'Partners', de: 'Partner', fr: 'Partenaires', it: 'Partner', 'zh-TW': '合作夥伴' },
        { en: 'Pilot projects', de: 'Pilotprojekte', fr: 'Projets pilotes', it: 'Progetti pilota', 'zh-TW': '試行計畫' },
        { en: 'Hiring talent', de: 'Talente einstellen', fr: 'Recrutement', it: 'Assunzione talenti', 'zh-TW': '招募人才' },
        { en: 'Funding', de: 'Finanzierung', fr: 'Financement', it: 'Finanziamenti', 'zh-TW': '資金' },
        { en: 'Customers', de: 'Kunden', fr: 'Clients', it: 'Clienti', 'zh-TW': '客戶' },
        { en: 'Mentors', de: 'Mentoren', fr: 'Mentors', it: 'Mentor', 'zh-TW': '導師' },
      ]),
      tooltip: { en: 'Tell us what your startup needs — we\'ll try to connect you with the right people at the event.', de: '[DE] Tell us what your startup needs — we\'ll try to connect you with the right people at the event.', fr: '[FR] Tell us what your startup needs — we\'ll try to connect you with the right people at the event.', it: '[IT] Tell us what your startup needs — we\'ll try to connect you with the right people at the event.', 'zh-TW': '[ZH] Tell us what your startup needs — we\'ll try to connect you with the right people at the event.' },
    }),

    // ═══════════════════════════════════════════════════════════
    // SRA MEMBERSHIP — Resume Creation Path (individual/student)
    // ═══════════════════════════════════════════════════════════

    // ── SRA Membership Opt-in Fields ────────────────────────
    fd('create_sra_profile', { en: 'Create my SRA public profile', de: 'Mein öffentliches SRA-Profil erstellen', fr: 'Créer mon profil public SRA', it: 'Crea il mio profilo pubblico SRA', 'zh-TW': '建立我的 SRA 公開檔案' }, 'yes-no', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      categoryFilter: ['individual'],
      defaultValue: true,
      helpText: { en: 'Your profile will be visible on swiss-robotics.org.', de: 'Ihr Profil wird auf swiss-robotics.org sichtbar sein.', fr: 'Votre profil sera visible sur swiss-robotics.org.', it: 'Il tuo profilo sarà visibile su swiss-robotics.org.', 'zh-TW': '您的個人檔案將顯示在 swiss-robotics.org。' },
      tooltip: { en: 'Creates a public profile on swiss-robotics.org, making you visible to the Swiss robotics community.', de: '[DE] Creates a public profile on swiss-robotics.org, making you visible to the Swiss robotics community.', fr: '[FR] Creates a public profile on swiss-robotics.org, making you visible to the Swiss robotics community.', it: '[IT] Creates a public profile on swiss-robotics.org, making you visible to the Swiss robotics community.', 'zh-TW': '[ZH] Creates a public profile on swiss-robotics.org, making you visible to the Swiss robotics community.' },
    }),
    fd('publish_resume', { en: 'Publish my resume on SRA', de: 'Meinen Lebenslauf auf SRA veröffentlichen', fr: 'Publier mon CV sur SRA', it: 'Pubblica il mio CV su SRA', 'zh-TW': '在 SRA 發布我的履歷' }, 'yes-no', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      categoryFilter: ['individual'],
      defaultValue: false,
      helpText: { en: 'Your resume will be searchable by employers on swiss-robotics.org.', de: 'Ihr Lebenslauf wird für Arbeitgeber auf swiss-robotics.org durchsuchbar sein.', fr: 'Votre CV sera consultable par les employeurs sur swiss-robotics.org.', it: 'Il tuo CV sarà ricercabile dai datori di lavoro su swiss-robotics.org.', 'zh-TW': '您的履歷將可被 swiss-robotics.org 上的雇主搜尋。' },
      tooltip: { en: 'Makes your resume searchable by employers on swiss-robotics.org. You can unpublish anytime.', de: '[DE] Makes your resume searchable by employers on swiss-robotics.org. You can unpublish anytime.', fr: '[FR] Makes your resume searchable by employers on swiss-robotics.org. You can unpublish anytime.', it: '[IT] Makes your resume searchable by employers on swiss-robotics.org. You can unpublish anytime.', 'zh-TW': '[ZH] Makes your resume searchable by employers on swiss-robotics.org. You can unpublish anytime.' },
    }),
    fd('profile_visibility_resume', { en: 'Profile visibility', de: 'Profilsichtbarkeit', fr: 'Visibilité du profil', it: 'Visibilità del profilo', 'zh-TW': '個人檔案可見度' }, 'radio', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
      categoryFilter: ['individual'],
      options: [
        { value: 'public', label: { en: 'Public — visible to everyone', de: 'Öffentlich — für alle sichtbar', fr: 'Public — visible par tous', it: 'Pubblico — visibile a tutti', 'zh-TW': '公開 — 所有人可見' } },
        { value: 'members', label: { en: 'Members only — visible to SRA members', de: 'Nur Mitglieder — für SRA-Mitglieder sichtbar', fr: 'Membres uniquement — visible par les membres SRA', it: 'Solo membri — visibile ai membri SRA', 'zh-TW': '僅限會員 — SRA 會員可見' } },
        { value: 'hidden', label: { en: 'Hidden — not listed', de: 'Ausgeblendet — nicht gelistet', fr: 'Masqué — non listé', it: 'Nascosto — non elencato', 'zh-TW': '隱藏 — 不公開列出' } },
      ],
      tooltip: { en: 'Controls who can see your resume — public, SRA members only, or hidden.', de: '[DE] Controls who can see your resume — public, SRA members only, or hidden.', fr: '[FR] Controls who can see your resume — public, SRA members only, or hidden.', it: '[IT] Controls who can see your resume — public, SRA members only, or hidden.', 'zh-TW': '[ZH] Controls who can see your resume — public, SRA members only, or hidden.' },
    }),
    fd('allow_employer_contact', { en: 'Allow employers to contact me', de: 'Arbeitgebern erlauben, mich zu kontaktieren', fr: 'Autoriser les employeurs à me contacter', it: 'Consenti ai datori di lavoro di contattarmi', 'zh-TW': '允許雇主聯繫我' }, 'yes-no', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
      categoryFilter: ['individual'],
      tooltip: { en: 'When enabled, employers browsing resumes on swiss-robotics.org can reach out to you directly.', de: '[DE] When enabled, employers browsing resumes on swiss-robotics.org can reach out to you directly.', fr: '[FR] When enabled, employers browsing resumes on swiss-robotics.org can reach out to you directly.', it: '[IT] When enabled, employers browsing resumes on swiss-robotics.org can reach out to you directly.', 'zh-TW': '[ZH] When enabled, employers browsing resumes on swiss-robotics.org can reach out to you directly.' },
    }),

    // ── Resume Data Fields ──────────────────────────────────
    fd('professional_title', { en: 'Professional Title / Headline', de: 'Berufstitel / Überschrift', fr: 'Titre professionnel', it: 'Titolo professionale', 'zh-TW': '職稱 / 標題' }, 'text', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
      categoryFilter: ['individual'],
      placeholder: { en: 'e.g. Robotics Engineer, PhD Candidate in AI', de: 'z.B. Robotik-Ingenieur, Doktorand in KI', fr: 'ex. Ingénieur robotique, Doctorant en IA', it: 'es. Ingegnere robotico, Dottorando in IA', 'zh-TW': '例：機器人工程師、AI 博士候選人' },
    }),
    fd('short_bio_resume', { en: 'Short Bio / Pitch', de: 'Kurzbiografie / Pitch', fr: 'Bio courte / Pitch', it: 'Breve bio / Pitch', 'zh-TW': '簡短自介 / 電梯簡報' }, 'textarea', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 5,
      categoryFilter: ['individual'],
      validation: { maxLength: 500 },
      helpText: { en: 'Max 500 characters. Describe yourself in 2-3 sentences.', de: 'Max. 500 Zeichen. Beschreiben Sie sich in 2-3 Sätzen.', fr: 'Max. 500 caractères. Décrivez-vous en 2-3 phrases.', it: 'Max. 500 caratteri. Descriviti in 2-3 frasi.', 'zh-TW': '最多 500 字元。用 2-3 句話描述自己。' },
      tooltip: { en: 'A short pitch about yourself for your SRA resume. Employers see this first when browsing candidates.', de: '[DE] A short pitch about yourself for your SRA resume. Employers see this first when browsing candidates.', fr: '[FR] A short pitch about yourself for your SRA resume. Employers see this first when browsing candidates.', it: '[IT] A short pitch about yourself for your SRA resume. Employers see this first when browsing candidates.', 'zh-TW': '[ZH] A short pitch about yourself for your SRA resume. Employers see this first when browsing candidates.' },
    }),
    fd('personal_photo', { en: 'Personal Photo', de: 'Persönliches Foto', fr: 'Photo personnelle', it: 'Foto personale', 'zh-TW': '個人照片' }, 'image-upload', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
      categoryFilter: ['individual'],
      helpText: { en: 'Upload a professional photo for your SRA profile. Max 5 MB, JPG/PNG.', de: 'Laden Sie ein professionelles Foto für Ihr SRA-Profil hoch. Max. 5 MB, JPG/PNG.', fr: 'Téléchargez une photo professionnelle pour votre profil SRA. Max 5 Mo, JPG/PNG.', it: 'Carica una foto professionale per il tuo profilo SRA. Max 5 MB, JPG/PNG.', 'zh-TW': '上傳一張專業照片作為您的 SRA 個人檔案。最大 5 MB，JPG/PNG。' },
      tooltip: { en: 'A professional photo makes your SRA profile more credible and approachable to potential employers.', de: '[DE] A professional photo makes your SRA profile more credible and approachable to potential employers.', fr: '[FR] A professional photo makes your SRA profile more credible and approachable to potential employers.', it: '[IT] A professional photo makes your SRA profile more credible and approachable to potential employers.', 'zh-TW': '[ZH] A professional photo makes your SRA profile more credible and approachable to potential employers.' },
    }),
    fd('position_type_sought', { en: 'Type of position sought', de: 'Art der gesuchten Stelle', fr: 'Type de poste recherché', it: 'Tipo di posizione cercata', 'zh-TW': '尋求的職位類型' }, 'multi-select', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
      categoryFilter: ['individual'],
      options: [
        { value: 'full-time', label: { en: 'Full-time', de: 'Vollzeit', fr: 'Temps plein', it: 'Tempo pieno', 'zh-TW': '全職' } },
        { value: 'part-time', label: { en: 'Part-time', de: 'Teilzeit', fr: 'Temps partiel', it: 'Part-time', 'zh-TW': '兼職' } },
        { value: 'internship', label: { en: 'Internship', de: 'Praktikum', fr: 'Stage', it: 'Tirocinio', 'zh-TW': '實習' } },
        { value: 'freelance', label: { en: 'Freelance / Consulting', de: 'Freiberuflich / Beratung', fr: 'Freelance / Conseil', it: 'Freelance / Consulenza', 'zh-TW': '自由工作 / 顧問' } },
      ],
    }),
    fd('remote_preference', { en: 'Remote work preference', de: 'Remote-Arbeit Präferenz', fr: 'Préférence de télétravail', it: 'Preferenza lavoro da remoto', 'zh-TW': '遠端工作偏好' }, 'select', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 7,
      categoryFilter: ['individual'],
      options: [
        { value: 'remote', label: { en: 'Remote only', de: 'Nur Remote', fr: 'Télétravail uniquement', it: 'Solo da remoto', 'zh-TW': '僅限遠端' } },
        { value: 'hybrid', label: { en: 'Hybrid', de: 'Hybrid', fr: 'Hybride', it: 'Ibrido', 'zh-TW': '混合模式' } },
        { value: 'onsite', label: { en: 'On-site', de: 'Vor Ort', fr: 'Sur place', it: 'In loco', 'zh-TW': '實體辦公' } },
      ],
    }),
    fd('availability_date', { en: 'Available from', de: 'Verfügbar ab', fr: 'Disponible à partir de', it: 'Disponibile dal', 'zh-TW': '可開始日期' }, 'date', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 8,
      categoryFilter: ['individual'],
    }),
    fd('work_permit', { en: 'Work permit status', de: 'Arbeitsbewilligungsstatus', fr: 'Statut du permis de travail', it: 'Stato permesso di lavoro', 'zh-TW': '工作許可狀態' }, 'select', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 9,
      categoryFilter: ['individual'],
      options: [
        { value: 'none', label: { en: 'None', de: 'Keine', fr: 'Aucun', it: 'Nessuno', 'zh-TW': '無' } },
        { value: 'l_g_permit', label: { en: 'L or G Permit', de: 'L- oder G-Bewilligung', fr: 'Permis L ou G', it: 'Permesso L o G', 'zh-TW': 'L 或 G 許可' } },
        { value: 'b_permit', label: { en: 'B Permit', de: 'B-Bewilligung', fr: 'Permis B', it: 'Permesso B', 'zh-TW': 'B 許可' } },
        { value: 'c_permit', label: { en: 'C Permit', de: 'C-Bewilligung', fr: 'Permis C', it: 'Permesso C', 'zh-TW': 'C 許可' } },
        { value: 'swiss_citizen', label: { en: 'Swiss citizen', de: 'Schweizer Bürger/in', fr: 'Citoyen(ne) suisse', it: 'Cittadino/a svizzero/a', 'zh-TW': '瑞士公民' } },
      ],
      tooltip: { en: 'Swiss employers need to know your work permit status to understand hiring requirements.', de: '[DE] Swiss employers need to know your work permit status to understand hiring requirements.', fr: '[FR] Swiss employers need to know your work permit status to understand hiring requirements.', it: '[IT] Swiss employers need to know your work permit status to understand hiring requirements.', 'zh-TW': '[ZH] Swiss employers need to know your work permit status to understand hiring requirements.' },
    }),
    fd('expertise_area', { en: 'Field(s) of experience', de: 'Erfahrungsbereiche', fr: 'Domaine(s) d\'expérience', it: 'Aree di esperienza', 'zh-TW': '經驗領域' }, 'multi-select', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 10,
      categoryFilter: ['individual'],
      options: roboticsExpertiseAreas(),
      helpText: { en: 'Select your areas of expertise in robotics.', de: 'Wählen Sie Ihre Fachgebiete in der Robotik.', fr: 'Sélectionnez vos domaines d\'expertise en robotique.', it: 'Seleziona le tue aree di competenza nella robotica.', 'zh-TW': '請選擇您在機器人領域的專業範疇。' },
      tooltip: { en: 'Select your robotics expertise areas to appear in relevant search results on swiss-robotics.org.', de: '[DE] Select your robotics expertise areas to appear in relevant search results on swiss-robotics.org.', fr: '[FR] Select your robotics expertise areas to appear in relevant search results on swiss-robotics.org.', it: '[IT] Select your robotics expertise areas to appear in relevant search results on swiss-robotics.org.', 'zh-TW': '[ZH] Select your robotics expertise areas to appear in relevant search results on swiss-robotics.org.' },
    }),
    fd('sub_expertise', { en: 'Sub-areas of expertise', de: 'Unterbereiche', fr: 'Sous-domaines d\'expertise', it: 'Sotto-aree di competenza', 'zh-TW': '專業子領域' }, 'multi-select', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 11,
      categoryFilter: ['individual'],
      helpText: { en: 'Specify more detailed sub-areas if applicable.', de: 'Geben Sie bei Bedarf detailliertere Unterbereiche an.', fr: 'Précisez les sous-domaines si applicable.', it: 'Specifica sotto-aree più dettagliate se applicabile.', 'zh-TW': '如適用，請指定更詳細的子領域。' },
      tooltip: { en: 'Narrow down your expertise to specific sub-areas for more targeted employer matches.', de: '[DE] Narrow down your expertise to specific sub-areas for more targeted employer matches.', fr: '[FR] Narrow down your expertise to specific sub-areas for more targeted employer matches.', it: '[IT] Narrow down your expertise to specific sub-areas for more targeted employer matches.', 'zh-TW': '[ZH] Narrow down your expertise to specific sub-areas for more targeted employer matches.' },
    }),
    fd('skills_tools', { en: 'Skills & Tools', de: 'Fähigkeiten & Werkzeuge', fr: 'Compétences & Outils', it: 'Competenze & Strumenti', 'zh-TW': '技能與工具' }, 'multi-select', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 12,
      categoryFilter: ['individual'],
      options: roboticsSkillsTools(),
    }),
    fd('languages_proficiency', { en: 'Languages spoken (with proficiency)', de: 'Sprachkenntnisse (mit Niveau)', fr: 'Langues parlées (avec niveau)', it: 'Lingue parlate (con livello)', 'zh-TW': '語言能力（含程度）' }, 'text', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 13,
      categoryFilter: ['individual'],
      placeholder: { en: 'e.g. English (C1), German (B2), French (A2)', de: 'z.B. Deutsch (C1), Englisch (B2), Französisch (A2)', fr: 'ex. Français (C1), Anglais (B2), Allemand (A2)', it: 'es. Italiano (C1), Inglese (B2), Tedesco (A2)', 'zh-TW': '例：英語 (C1)、德語 (B2)、法語 (A2)' },
    }),
    fd('education_level', { en: 'Highest level of education', de: 'Höchster Bildungsabschluss', fr: 'Plus haut niveau d\'études', it: 'Più alto livello di istruzione', 'zh-TW': '最高學歷' }, 'select', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 14,
      categoryFilter: ['individual'],
      options: [
        { value: 'bachelors', label: { en: 'Bachelor\'s', de: 'Bachelor', fr: 'Bachelor', it: 'Bachelor', 'zh-TW': '學士' } },
        { value: 'masters', label: { en: 'Master\'s', de: 'Master', fr: 'Master', it: 'Master', 'zh-TW': '碩士' } },
        { value: 'phd', label: { en: 'PhD', de: 'Doktorat', fr: 'Doctorat', it: 'Dottorato', 'zh-TW': '博士' } },
      ],
    }),
    fd('diploma_specialization', { en: 'Specialization as per diploma', de: 'Spezialisierung gemäss Abschluss', fr: 'Spécialisation selon diplôme', it: 'Specializzazione da diploma', 'zh-TW': '學位專業' }, 'text', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 15,
      categoryFilter: ['individual'],
    }),
    fd('diploma_year', { en: 'Year of diploma', de: 'Abschlussjahr', fr: 'Année du diplôme', it: 'Anno di diploma', 'zh-TW': '畢業年份' }, 'text', 'resume', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 16,
      categoryFilter: ['individual'],
      validation: { pattern: '[0-9]{4}' },
    }),
    fd('diploma_in_progress', { en: 'Diploma in progress', de: 'Studium laufend', fr: 'Diplôme en cours', it: 'Diploma in corso', 'zh-TW': '在學中' }, 'checkbox', 'resume', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 17,
      categoryFilter: ['individual'],
    }),
    fd('resume_upload', { en: 'Upload full CV', de: 'Vollständigen Lebenslauf hochladen', fr: 'Télécharger le CV complet', it: 'Carica il CV completo', 'zh-TW': '上傳完整履歷' }, 'file', 'resume', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 18,
      categoryFilter: ['individual'],
    }),
    fd('portfolio_url', { en: 'Portfolio link', de: 'Portfolio-Link', fr: 'Lien du portfolio', it: 'Link al portfolio', 'zh-TW': '作品集連結' }, 'url', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 19,
      categoryFilter: ['individual'],
    }),
    fd('scholar_github_url', { en: 'Google Scholar / GitHub', de: 'Google Scholar / GitHub', fr: 'Google Scholar / GitHub', it: 'Google Scholar / GitHub', 'zh-TW': 'Google Scholar / GitHub' }, 'url', 'resume', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 20,
      categoryFilter: ['individual'],
    }),

    // ── SRA Membership Tier — Industry Size Selector ───────
    fd('sra_industry_size', { en: 'Industry Size (for SRA membership tier)', de: 'Industriegrösse (für SRA-Mitgliedschaftsstufe)', fr: 'Taille de l\'entreprise (niveau adhésion SRA)', it: 'Dimensione azienda (livello iscrizione SRA)', 'zh-TW': '企業規模（SRA 會員等級）' }, 'select', 'company', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 50,
      categoryFilter: ['legal'],
      helpText: { en: 'Determines your SRA corporate membership tier.', de: 'Bestimmt Ihre SRA-Firmenmitgliedschaftsstufe.', fr: 'Détermine votre niveau d\'adhésion entreprise SRA.', it: 'Determina il livello di iscrizione aziendale SRA.', 'zh-TW': '決定您的 SRA 企業會員等級。' },
      options: multiOptI18n([
        { en: 'Large (250+ employees)', de: 'Gross (250+ Mitarbeitende)', fr: 'Grande (250+ employés)', it: 'Grande (250+ dipendenti)', 'zh-TW': '大型（250+ 員工）' },
        { en: 'Medium (50–249 employees)', de: 'Mittel (50–249 Mitarbeitende)', fr: 'Moyenne (50–249 employés)', it: 'Media (50–249 dipendenti)', 'zh-TW': '中型（50–249 員工）' },
        { en: 'Small (1–49 employees)', de: 'Klein (1–49 Mitarbeitende)', fr: 'Petite (1–49 employés)', it: 'Piccola (1–49 dipendenti)', 'zh-TW': '小型（1–49 員工）' },
      ]),
    }),

    // ═══════════════════════════════════════════════════════════
    // SRA MEMBERSHIP — Organization Profile + Map Card Path (legal)
    // ═══════════════════════════════════════════════════════════

    // ── Org Profile Opt-in Fields ───────────────────────────
    fd('create_org_profile', { en: 'Create/claim organization profile in SRA directory', de: 'Organisationsprofil im SRA-Verzeichnis erstellen/beanspruchen', fr: 'Créer/revendiquer le profil dans l\'annuaire SRA', it: 'Crea/rivendica il profilo nell\'elenco SRA', 'zh-TW': '在 SRA 目錄中建立/認領組織檔案' }, 'yes-no', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      categoryFilter: ['legal'],
      defaultValue: true,
      tooltip: { en: 'Creates a directory listing for your organization on swiss-robotics.org, visible to all SRA members.', de: '[DE] Creates a directory listing for your organization on swiss-robotics.org, visible to all SRA members.', fr: '[FR] Creates a directory listing for your organization on swiss-robotics.org, visible to all SRA members.', it: '[IT] Creates a directory listing for your organization on swiss-robotics.org, visible to all SRA members.', 'zh-TW': '[ZH] Creates a directory listing for your organization on swiss-robotics.org, visible to all SRA members.' },
    }),
    fd('create_map_listing', { en: 'Create listing on Swiss Robotics Map', de: 'Eintrag auf der Swiss Robotics Map erstellen', fr: 'Créer une entrée sur la Swiss Robotics Map', it: 'Crea un\'inserzione sulla Swiss Robotics Map', 'zh-TW': '在瑞士機器人地圖建立據點' }, 'yes-no', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      categoryFilter: ['legal'],
      defaultValue: true,
      tooltip: { en: 'Adds a pin for your organization on the Swiss Robotics Map — an interactive directory of the robotics ecosystem.', de: '[DE] Adds a pin for your organization on the Swiss Robotics Map — an interactive directory of the robotics ecosystem.', fr: '[FR] Adds a pin for your organization on the Swiss Robotics Map — an interactive directory of the robotics ecosystem.', it: '[IT] Adds a pin for your organization on the Swiss Robotics Map — an interactive directory of the robotics ecosystem.', 'zh-TW': '[ZH] Adds a pin for your organization on the Swiss Robotics Map — an interactive directory of the robotics ecosystem.' },
    }),
    fd('org_profile_visibility', { en: 'Make profile public immediately?', de: 'Profil sofort veröffentlichen?', fr: 'Rendre le profil public immédiatement ?', it: 'Rendere il profilo pubblico immediatamente?', 'zh-TW': '立即公開個人檔案？' }, 'radio', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
      categoryFilter: ['legal'],
      options: [
        { value: 'publish', label: { en: 'Yes — publish now', de: 'Ja — jetzt veröffentlichen', fr: 'Oui — publier maintenant', it: 'Sì — pubblica ora', 'zh-TW': '是 — 立即發佈' } },
        { value: 'draft', label: { en: 'No — save as draft pending review', de: 'Nein — als Entwurf speichern', fr: 'Non — enregistrer comme brouillon', it: 'No — salva come bozza', 'zh-TW': '否 — 儲存為草稿待審核' } },
      ],
      tooltip: { en: 'Choose whether your listing goes live immediately or stays as a draft for review first.', de: '[DE] Choose whether your listing goes live immediately or stays as a draft for review first.', fr: '[FR] Choose whether your listing goes live immediately or stays as a draft for review first.', it: '[IT] Choose whether your listing goes live immediately or stays as a draft for review first.', 'zh-TW': '[ZH] Choose whether your listing goes live immediately or stays as a draft for review first.' },
    }),

    // ── Org Identity ────────────────────────────────────────
    fd('org_legal_name', { en: 'Legal Name', de: 'Offizieller Name', fr: 'Raison sociale', it: 'Denominazione legale', 'zh-TW': '法定名稱' }, 'text', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
      categoryFilter: ['legal'],
      validation: { required: true },
    }),
    fd('org_display_name', { en: 'Display Name', de: 'Anzeigename', fr: 'Nom d\'affichage', it: 'Nome di visualizzazione', 'zh-TW': '顯示名稱' }, 'text', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
      categoryFilter: ['legal'],
    }),
    fd('org_type', { en: 'Organization Type', de: 'Organisationstyp', fr: 'Type d\'organisation', it: 'Tipo di organizzazione', 'zh-TW': '組織類型' }, 'select', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
      categoryFilter: ['legal'],
      options: [
        { value: 'industry-large', label: { en: 'Industry Large', de: 'Grossunternehmen', fr: 'Grande industrie', it: 'Grande industria', 'zh-TW': '大型企業' } },
        { value: 'industry-sme', label: { en: 'Industry SME', de: 'KMU', fr: 'PME', it: 'PMI', 'zh-TW': '中小企業' } },
        { value: 'research', label: { en: 'Research / University', de: 'Forschung / Universität', fr: 'Recherche / Université', it: 'Ricerca / Università', 'zh-TW': '研究 / 大學' } },
        { value: 'infrastructure-funding-providers', label: { en: 'Infrastructure & Funding', de: 'Infrastruktur & Finanzierung', fr: 'Infrastructure & Financement', it: 'Infrastruttura & Finanziamento', 'zh-TW': '基礎設施與資金' } },
        { value: 'startup', label: { en: 'Startup / Spin-off', de: 'Startup / Spin-off', fr: 'Startup / Spin-off', it: 'Startup / Spin-off', 'zh-TW': '新創 / 衍生企業' } },
        { value: 'ngo', label: { en: 'NGO / Non-profit', de: 'NGO / Non-Profit', fr: 'ONG / Association', it: 'ONG / Non-profit', 'zh-TW': 'NGO / 非營利組織' } },
        { value: 'government', label: { en: 'Government / Public', de: 'Staat / Öffentlich', fr: 'Gouvernement / Public', it: 'Governo / Pubblico', 'zh-TW': '政府 / 公家機關' } },
      ],
      tooltip: { en: 'Helps categorize your organization in the SRA directory and determines which filters visitors can use to find you.', de: '[DE] Helps categorize your organization in the SRA directory and determines which filters visitors can use to find you.', fr: '[FR] Helps categorize your organization in the SRA directory and determines which filters visitors can use to find you.', it: '[IT] Helps categorize your organization in the SRA directory and determines which filters visitors can use to find you.', 'zh-TW': '[ZH] Helps categorize your organization in the SRA directory and determines which filters visitors can use to find you.' },
    }),
    fd('org_website', { en: 'Organization Website', de: 'Website der Organisation', fr: 'Site web de l\'organisation', it: 'Sito web dell\'organizzazione', 'zh-TW': '組織網站' }, 'url', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
      categoryFilter: ['legal'],
    }),
    fd('org_contact_email', { en: 'Public Contact Email', de: 'Öffentliche Kontakt-E-Mail', fr: 'E-mail de contact public', it: 'E-mail di contatto pubblica', 'zh-TW': '公開聯絡信箱' }, 'email', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 7,
      categoryFilter: ['legal'],
    }),
    fd('org_phone', { en: 'Public Phone', de: 'Öffentliche Telefonnummer', fr: 'Téléphone public', it: 'Telefono pubblico', 'zh-TW': '公開電話' }, 'phone', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 8,
      categoryFilter: ['legal'],
    }),

    // ── Org Location ────────────────────────────────────────
    fd('org_address', { en: 'Address', de: 'Adresse', fr: 'Adresse', it: 'Indirizzo', 'zh-TW': '地址' }, 'text', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 9,
      categoryFilter: ['legal'],
    }),
    fd('org_city', { en: 'City', de: 'Stadt', fr: 'Ville', it: 'Città', 'zh-TW': '城市' }, 'text', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 10,
      categoryFilter: ['legal'],
    }),
    fd('org_canton', { en: 'Canton', de: 'Kanton', fr: 'Canton', it: 'Cantone', 'zh-TW': '邦' }, 'select', 'org_profile', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 11,
      categoryFilter: ['legal'],
      options: swissCantons(),
    }),
    fd('org_country', { en: 'Country', de: 'Land', fr: 'Pays', it: 'Paese', 'zh-TW': '國家' }, 'country', 'org_profile', {
      widthDesktop: 25, widthMobile: 50, sortOrder: 12,
      categoryFilter: ['legal'],
      defaultValue: 'ch',
    }),

    // ── Org Directory Content ───────────────────────────────
    fd('org_description', { en: 'Short Description', de: 'Kurzbeschreibung', fr: 'Description courte', it: 'Descrizione breve', 'zh-TW': '簡短描述' }, 'textarea', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 13,
      categoryFilter: ['legal'],
      tooltip: { en: 'A short description of your organization shown on your SRA directory listing.', de: '[DE] A short description of your organization shown on your SRA directory listing.', fr: '[FR] A short description of your organization shown on your SRA directory listing.', it: '[IT] A short description of your organization shown on your SRA directory listing.', 'zh-TW': '[ZH] A short description of your organization shown on your SRA directory listing.' },
    }),
    fd('org_logo', { en: 'Organization Logo', de: 'Organisationslogo', fr: 'Logo de l\'organisation', it: 'Logo dell\'organizzazione', 'zh-TW': '組織標誌' }, 'image-upload', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 14,
      categoryFilter: ['legal'],
    }),
    fd('org_we_offer', { en: 'We offer…', de: 'Wir bieten…', fr: 'Nous offrons…', it: 'Offriamo…', 'zh-TW': '我們提供…' }, 'textarea', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 15,
      categoryFilter: ['legal'],
      helpText: { en: 'Describe what your organization offers (products, services, expertise).', de: 'Beschreiben Sie, was Ihre Organisation anbietet.', fr: 'Décrivez ce que votre organisation propose.', it: 'Descrivi ciò che la tua organizzazione offre.', 'zh-TW': '說明您的組織提供的產品、服務或專業。' },
      tooltip: { en: 'Describe what your organization offers — this is displayed on your directory profile to attract collaborators.', de: '[DE] Describe what your organization offers — this is displayed on your directory profile to attract collaborators.', fr: '[FR] Describe what your organization offers — this is displayed on your directory profile to attract collaborators.', it: '[IT] Describe what your organization offers — this is displayed on your directory profile to attract collaborators.', 'zh-TW': '[ZH] Describe what your organization offers — this is displayed on your directory profile to attract collaborators.' },
    }),
    fd('org_we_seek', { en: 'We are looking for…', de: 'Wir suchen…', fr: 'Nous recherchons…', it: 'Cerchiamo…', 'zh-TW': '我們正在尋找…' }, 'textarea', 'org_profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 16,
      categoryFilter: ['legal'],
      helpText: { en: 'Describe what your organization is looking for (partners, talent, etc.).', de: 'Beschreiben Sie, was Ihre Organisation sucht.', fr: 'Décrivez ce que votre organisation recherche.', it: 'Descrivi ciò che la tua organizzazione cerca.', 'zh-TW': '說明您的組織正在尋找的合作夥伴、人才等。' },
      tooltip: { en: 'Describe what your organization is looking for — partners, talent, or services. Displayed on your directory profile.', de: '[DE] Describe what your organization is looking for — partners, talent, or services. Displayed on your directory profile.', fr: '[FR] Describe what your organization is looking for — partners, talent, or services. Displayed on your directory profile.', it: '[IT] Describe what your organization is looking for — partners, talent, or services. Displayed on your directory profile.', 'zh-TW': '[ZH] Describe what your organization is looking for — partners, talent, or services. Displayed on your directory profile.' },
    }),

    // ── Org Taxonomy Mapping (for map filters) ──────────────
    fd('org_robotics_fields', { en: 'Robotics Fields', de: 'Robotik-Bereiche', fr: 'Domaines de la robotique', it: 'Campi della robotica', 'zh-TW': '機器人領域' }, 'multi-select', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 17,
      categoryFilter: ['legal'],
      options: roboticsFieldOptions(),
      tooltip: { en: 'Select which robotics fields your organization works in. Used for map filters so visitors can discover you.', de: '[DE] Select which robotics fields your organization works in. Used for map filters so visitors can discover you.', fr: '[FR] Select which robotics fields your organization works in. Used for map filters so visitors can discover you.', it: '[IT] Select which robotics fields your organization works in. Used for map filters so visitors can discover you.', 'zh-TW': '[ZH] Select which robotics fields your organization works in. Used for map filters so visitors can discover you.' },
    }),
    fd('org_robotics_subfields', { en: 'Robotics Sub-fields', de: 'Robotik-Unterbereiche', fr: 'Sous-domaines de la robotique', it: 'Sotto-campi della robotica', 'zh-TW': '機器人子領域' }, 'multi-select', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 18,
      categoryFilter: ['legal'],
      options: roboticsSubfieldOptions(),
      tooltip: { en: 'Specify more detailed sub-fields for finer-grained discoverability on the map.', de: '[DE] Specify more detailed sub-fields for finer-grained discoverability on the map.', fr: '[FR] Specify more detailed sub-fields for finer-grained discoverability on the map.', it: '[IT] Specify more detailed sub-fields for finer-grained discoverability on the map.', 'zh-TW': '[ZH] Specify more detailed sub-fields for finer-grained discoverability on the map.' },
    }),
    fd('org_tags', { en: 'Tags / Keywords', de: 'Tags / Schlüsselwörter', fr: 'Tags / Mots-clés', it: 'Tag / Parole chiave', 'zh-TW': '標籤 / 關鍵字' }, 'multi-select', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 19,
      categoryFilter: ['legal'],
      tooltip: { en: 'Add keywords so other members can find your organization through search and filters.', de: '[DE] Add keywords so other members can find your organization through search and filters.', fr: '[FR] Add keywords so other members can find your organization through search and filters.', it: '[IT] Add keywords so other members can find your organization through search and filters.', 'zh-TW': '[ZH] Add keywords so other members can find your organization through search and filters.' },
    }),
    fd('org_authorized_rep', { en: 'I confirm I am authorized to represent this organization', de: 'Ich bestätige, dass ich berechtigt bin, diese Organisation zu vertreten', fr: 'Je confirme être autorisé/e à représenter cette organisation', it: 'Confermo di essere autorizzato a rappresentare questa organizzazione', 'zh-TW': '我確認我有權代表此組織' }, 'checkbox', 'org_profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 20,
      categoryFilter: ['legal'],
      validation: { required: true },
      tooltip: { en: 'Confirms you have the authority to create or manage this organization\'s profile on behalf of the company.', de: '[DE] Confirms you have the authority to create or manage this organization\'s profile on behalf of the company.', fr: '[FR] Confirms you have the authority to create or manage this organization\'s profile on behalf of the company.', it: '[IT] Confirms you have the authority to create or manage this organization\'s profile on behalf of the company.', 'zh-TW': '[ZH] Confirms you have the authority to create or manage this organization\'s profile on behalf of the company.' },
    }),

    // ═══════════════════════════════════════════════════════════
    // EXHIBITOR FIELDS
    // ═══════════════════════════════════════════════════════════

    // ── Exhibitor Package (Buyer/Admin) Fields ─────────────
    fd('exhibitor_vat_uid', { en: 'VAT / UID Number', de: 'MwSt / UID-Nummer', fr: 'Numéro TVA / IDE', it: 'Numero IVA / IDI', 'zh-TW': '統一編號 / UID' }, 'text', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 0,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_billing_address', { en: 'Billing Address', de: 'Rechnungsadresse', fr: 'Adresse de facturation', it: 'Indirizzo di fatturazione', 'zh-TW': '帳單地址' }, 'text', 'exhibitor', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_billing_email', { en: 'Billing Email', de: 'Rechnungs-E-Mail', fr: 'E-mail de facturation', it: 'E-mail fatturazione', 'zh-TW': '帳單信箱' }, 'email', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 2,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_po_number', { en: 'PO Number (optional)', de: 'Bestellnummer (optional)', fr: 'Numéro de commande (optionnel)', it: 'Numero d\'ordine (opzionale)', 'zh-TW': '訂單編號（選填）' }, 'text', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_onsite_contact_name', { en: 'Primary On-site Contact Name', de: 'Kontaktperson vor Ort (Name)', fr: 'Nom du contact sur place', it: 'Nome referente in loco', 'zh-TW': '現場主要聯絡人姓名' }, 'text', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_onsite_contact_phone', { en: 'Primary On-site Contact Phone', de: 'Kontaktperson vor Ort (Telefon)', fr: 'Téléphone du contact sur place', it: 'Telefono referente in loco', 'zh-TW': '現場主要聯絡人電話' }, 'phone', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 5,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_company_description', { en: 'Company Description (for directory)', de: 'Firmenbeschreibung (für Verzeichnis)', fr: 'Description entreprise (pour l\'annuaire)', it: 'Descrizione azienda (per elenco)', 'zh-TW': '公司描述（供目錄使用）' }, 'textarea', 'exhibitor', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 6,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_logo', { en: 'Company Logo', de: 'Firmenlogo', fr: 'Logo entreprise', it: 'Logo aziendale', 'zh-TW': '公司標誌' }, 'image-upload', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 7,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_robotics_fields', { en: 'Robotics Fields (for map & exhibitor list)', de: 'Robotik-Bereiche (für Karte & Ausstellerliste)', fr: 'Domaines robotique (pour carte & liste)', it: 'Campi robotica (per mappa & elenco)', 'zh-TW': '機器人領域（供地圖與展商列表）' }, 'multi-select', 'exhibitor', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 8,
      categoryFilter: ['legal'],
      options: roboticsFieldOptions(),
    }),
    fd('exhibitor_robotics_subfields', { en: 'Robotics Sub-fields', de: 'Robotik-Unterbereiche', fr: 'Sous-domaines robotique', it: 'Sotto-campi robotica', 'zh-TW': '機器人子領域' }, 'multi-select', 'exhibitor', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 9,
      categoryFilter: ['legal'],
      options: roboticsSubfieldOptions(),
    }),
    fd('exhibitor_assign_passes_now', { en: 'Assign included passes now?', de: 'Inkludierte Pässe jetzt zuweisen?', fr: 'Attribuer les passes inclus maintenant ?', it: 'Assegnare i pass inclusi ora?', 'zh-TW': '現在分配包含的通行證？' }, 'yes-no', 'exhibitor', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 10,
      categoryFilter: ['legal'],
    }),
    fd('exhibitor_member_id', { en: 'SRA Legal Entity Member ID (for discount)', de: 'SRA-Mitgliedsnummer (für Rabatt)', fr: 'Numéro de membre SRA (pour réduction)', it: 'ID membro SRA (per sconto)', 'zh-TW': 'SRA 法人會員編號（折扣用）' }, 'text', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 11,
      categoryFilter: ['legal'],
    }),

    // ── Exhibitor Staff Pass Fields ─────────────────────────
    fd('exhibitor_staff_company', { en: 'Exhibiting Company', de: 'Ausstellende Firma', fr: 'Entreprise exposante', it: 'Azienda espositrice', 'zh-TW': '展出公司' }, 'text', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 12,
      categoryFilter: ['general'],
      helpText: { en: 'Pre-filled by the exhibitor admin. Cannot be changed.', de: 'Vom Aussteller-Admin vorausgefüllt. Kann nicht geändert werden.', fr: 'Pré-rempli par l\'administrateur exposant. Ne peut pas être modifié.', it: 'Pre-compilato dall\'amministratore espositore. Non modificabile.', 'zh-TW': '由展商管理員預填。不可更改。' },
    }),
    fd('exhibitor_booth_role', { en: 'Booth Role', de: 'Rolle am Stand', fr: 'Rôle au stand', it: 'Ruolo allo stand', 'zh-TW': '展位角色' }, 'select', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 13,
      categoryFilter: ['general'],
      options: multiOptI18n([
        { en: 'Booth Manager', de: 'Standleiter/in', fr: 'Responsable du stand', it: 'Responsabile dello stand', 'zh-TW': '展位經理' },
        { en: 'Sales', de: 'Vertrieb', fr: 'Ventes', it: 'Vendite', 'zh-TW': '業務' },
        { en: 'Technical Demo', de: 'Technische Demo', fr: 'Démo technique', it: 'Demo tecnica', 'zh-TW': '技術展示' },
        { en: 'Logistics', de: 'Logistik', fr: 'Logistique', it: 'Logistica', 'zh-TW': '物流' },
        { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' },
      ]),
    }),
    fd('exhibitor_setup_access', { en: 'Setup/teardown access needed', de: 'Zugang für Auf-/Abbau benötigt', fr: 'Accès montage/démontage nécessaire', it: 'Accesso allestimento/smontaggio necessario', 'zh-TW': '需要搭建/拆卸通行權限' }, 'checkbox', 'exhibitor', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 14,
      categoryFilter: ['general'],
    }),
  ];
}

// ─── Helpers ────────────────────────────────────────────────

/** Shorthand field definition builder. */
function fd(
  slug: string,
  label: Record<string, string>,
  type: string,
  group: string,
  opts?: {
    widthDesktop?: number;
    widthMobile?: number;
    sortOrder?: number;
    options?: Array<{ value: string; label: Record<string, string> }>;
    validation?: Record<string, unknown>;
    helpText?: Record<string, string>;
    tooltip?: Record<string, string>;
    placeholder?: Record<string, string>;
    defaultValue?: unknown;
    categoryFilter?: string[];
    conditionalOn?: Record<string, unknown>;
    documentUrl?: Record<string, string>;
    isSystem?: boolean;
  },
) {
  return {
    slug,
    label,
    type,
    group,
    defaultWidthDesktop: opts?.widthDesktop ?? 100,
    defaultWidthMobile: opts?.widthMobile ?? 100,
    sortOrder: opts?.sortOrder ?? 0,
    options: opts?.options ?? null,
    validationRules: opts?.validation ?? null,
    helpText: opts?.helpText ?? null,
    tooltip: opts?.tooltip ?? null,
    placeholder: opts?.placeholder ?? null,
    defaultValue: opts?.defaultValue ?? null,
    categoryFilter: opts?.categoryFilter ?? null,
    conditionalOn: opts?.conditionalOn ?? null,
    documentUrl: opts?.documentUrl ?? null,
    isSystem: opts?.isSystem ?? false,
    active: true,
  };
}

/** Create simple options array from string values (EN-only, for numeric/code values). */
function multiOpt(values: string[]) {
  return values.map((v) => ({
    value: v.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, ''),
    label: { en: v },
  }));
}

/**
 * Create i18n options array from objects with translations per locale.
 * The `en` value is used to generate the slug.
 */
function multiOptI18n(items: Array<Record<string, string>>) {
  return items.map((item) => ({
    value: item.en.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, ''),
    label: item,
  }));
}

/** Swiss cantons as select options. */
function swissCantons() {
  const cantons: [string, string][] = [
    ['ag', 'Aargau'], ['ai', 'Appenzell Innerrhoden'], ['ar', 'Appenzell Ausserrhoden'],
    ['be', 'Bern'], ['bl', 'Basel-Landschaft'], ['bs', 'Basel-Stadt'],
    ['fr', 'Fribourg'], ['ge', 'Genève'], ['gl', 'Glarus'],
    ['gr', 'Graubünden'], ['ju', 'Jura'], ['lu', 'Luzern'],
    ['ne', 'Neuchâtel'], ['nw', 'Nidwalden'], ['ow', 'Obwalden'],
    ['sg', 'St. Gallen'], ['sh', 'Schaffhausen'], ['so', 'Solothurn'],
    ['sz', 'Schwyz'], ['tg', 'Thurgau'], ['ti', 'Ticino'],
    ['ur', 'Uri'], ['vd', 'Vaud'], ['vs', 'Valais'],
    ['zg', 'Zug'], ['zh', 'Zürich'],
  ];
  return cantons.map(([value, name]) => ({
    value,
    label: { en: name, de: name, fr: name },
  }));
}

/**
 * Robotics expertise areas — mirrors SRA Jobs Augmenter `expertise_area` exactly.
 * 20 options matching the slugs used in resume creation.
 */
function roboticsExpertiseAreas() {
  return [
    { value: 'mechanical_design', label: { en: 'Robot Mechanics & Mechanical Design', de: 'Robotermechanik & Konstruktion', fr: 'Mécanique robotique & conception', it: 'Meccanica robotica & design', 'zh-TW': '機器人力學與機構設計' } },
    { value: 'biorobotics', label: { en: 'Biorobotics', de: 'Biorobotik', fr: 'Biorobotique', it: 'Biorobotica', 'zh-TW': '生物機器人學' } },
    { value: 'soft_robotics', label: { en: 'Soft Robotics', de: 'Soft Robotik', fr: 'Robotique souple', it: 'Soft Robotics', 'zh-TW': '軟性機器人' } },
    { value: 'robot_perception', label: { en: 'Robot Perception & Vision', de: 'Roboterwahrnehmung & Vision', fr: 'Perception & vision robotique', it: 'Percezione robotica & visione', 'zh-TW': '機器人感知與視覺' } },
    { value: 'cognitive_ai', label: { en: 'Cognitive Robotics & AI', de: 'Kognitive Robotik & KI', fr: 'Robotique cognitive & IA', it: 'Robotica cognitiva & IA', 'zh-TW': '認知機器人與 AI' } },
    { value: 'slam', label: { en: 'SLAM & Sensor Fusion', de: 'SLAM & Sensorfusion', fr: 'SLAM & fusion de capteurs', it: 'SLAM & fusione sensori', 'zh-TW': 'SLAM 與感測器融合' } },
    { value: 'motion_planning', label: { en: 'Motion Planning & Control', de: 'Bewegungsplanung & Regelung', fr: 'Planification de mouvement & contrôle', it: 'Pianificazione del moto & controllo', 'zh-TW': '運動規劃與控制' } },
    { value: 'grasping', label: { en: 'Grasping & Manipulation', de: 'Greifen & Manipulation', fr: 'Préhension & manipulation', it: 'Presa & manipolazione', 'zh-TW': '抓取與操作' } },
    { value: 'multi_robot', label: { en: 'Multi-Robot Systems', de: 'Multi-Roboter-Systeme', fr: 'Systèmes multi-robots', it: 'Sistemi multi-robot', 'zh-TW': '多機器人系統' } },
    { value: 'hri', label: { en: 'Human–Robot Interaction (HRI)', de: 'Mensch-Roboter-Interaktion (MRI)', fr: 'Interaction homme-robot (IHR)', it: 'Interazione uomo-robot (HRI)', 'zh-TW': '人機互動 (HRI)' } },
    { value: 'teleoperation', label: { en: 'Teleoperation & Shared Autonomy', de: 'Teleoperation & geteilte Autonomie', fr: 'Téléopération & autonomie partagée', it: 'Teleoperazione & autonomia condivisa', 'zh-TW': '遙控操作與共享自主' } },
    { value: 'aerial_robots', label: { en: 'Aerial & UAV Robotics', de: 'Luft- & UAV-Robotik', fr: 'Robotique aérienne & drones', it: 'Robotica aerea & UAV', 'zh-TW': '空中與無人機機器人' } },
    { value: 'marine', label: { en: 'Marine / Underwater Robotics', de: 'Marine / Unterwasser-Robotik', fr: 'Robotique marine / sous-marine', it: 'Robotica marina / subacquea', 'zh-TW': '海洋 / 水下機器人' } },
    { value: 'industrial', label: { en: 'Industrial & Manufacturing Robotics', de: 'Industrie- & Fertigungsrobotik', fr: 'Robotique industrielle & manufacturière', it: 'Robotica industriale & manifatturiera', 'zh-TW': '工業與製造機器人' } },
    { value: 'rehab', label: { en: 'Rehabilitation & Assistive Robotics', de: 'Rehabilitations- & Assistenzrobotik', fr: 'Robotique de réadaptation & assistive', it: 'Robotica riabilitativa & assistiva', 'zh-TW': '復健與輔助機器人' } },
    { value: 'surgical', label: { en: 'Surgical Robotics', de: 'Chirurgische Robotik', fr: 'Robotique chirurgicale', it: 'Robotica chirurgica', 'zh-TW': '手術機器人' } },
    { value: 'autonomous_nav', label: { en: 'Autonomous Navigation', de: 'Autonome Navigation', fr: 'Navigation autonome', it: 'Navigazione autonoma', 'zh-TW': '自主導航' } },
    { value: 'ros', label: { en: 'ROS / Middleware Systems', de: 'ROS / Middleware-Systeme', fr: 'ROS / systèmes middleware', it: 'ROS / sistemi middleware', 'zh-TW': 'ROS / 中介軟體系統' } },
    { value: 'simulation', label: { en: 'Simulation & Digital Twins', de: 'Simulation & Digitale Zwillinge', fr: 'Simulation & jumeaux numériques', it: 'Simulazione & gemelli digitali', 'zh-TW': '模擬與數位分身' } },
    { value: 'bioinspired', label: { en: 'Bio-Inspired Robotics', de: 'Bioinspirierte Robotik', fr: 'Robotique bio-inspirée', it: 'Robotica bio-ispirata', 'zh-TW': '仿生機器人' } },
  ];
}

/**
 * Skills & tools — mirrors SRA Jobs Augmenter `skills_tools` exactly.
 * 25 options matching the slugs used in resume creation.
 */
function roboticsSkillsTools() {
  return [
    { value: 'python', label: { en: 'Python', de: 'Python', fr: 'Python', it: 'Python', 'zh-TW': 'Python' } },
    { value: 'c_cpp', label: { en: 'C / C++', de: 'C / C++', fr: 'C / C++', it: 'C / C++', 'zh-TW': 'C / C++' } },
    { value: 'java', label: { en: 'Java', de: 'Java', fr: 'Java', it: 'Java', 'zh-TW': 'Java' } },
    { value: 'ros', label: { en: 'ROS / ROS2', de: 'ROS / ROS2', fr: 'ROS / ROS2', it: 'ROS / ROS2', 'zh-TW': 'ROS / ROS2' } },
    { value: 'gazebo', label: { en: 'Gazebo', de: 'Gazebo', fr: 'Gazebo', it: 'Gazebo', 'zh-TW': 'Gazebo' } },
    { value: 'webots', label: { en: 'Webots', de: 'Webots', fr: 'Webots', it: 'Webots', 'zh-TW': 'Webots' } },
    { value: 'isaacsim', label: { en: 'IsaacSim', de: 'IsaacSim', fr: 'IsaacSim', it: 'IsaacSim', 'zh-TW': 'IsaacSim' } },
    { value: 'opencv', label: { en: 'OpenCV', de: 'OpenCV', fr: 'OpenCV', it: 'OpenCV', 'zh-TW': 'OpenCV' } },
    { value: 'moveit', label: { en: 'MoveIt!', de: 'MoveIt!', fr: 'MoveIt!', it: 'MoveIt!', 'zh-TW': 'MoveIt!' } },
    { value: 'solidworks', label: { en: 'SolidWorks', de: 'SolidWorks', fr: 'SolidWorks', it: 'SolidWorks', 'zh-TW': 'SolidWorks' } },
    { value: 'fusion360', label: { en: 'Fusion 360', de: 'Fusion 360', fr: 'Fusion 360', it: 'Fusion 360', 'zh-TW': 'Fusion 360' } },
    { value: 'arduino', label: { en: 'Arduino', de: 'Arduino', fr: 'Arduino', it: 'Arduino', 'zh-TW': 'Arduino' } },
    { value: 'rpi', label: { en: 'Raspberry Pi', de: 'Raspberry Pi', fr: 'Raspberry Pi', it: 'Raspberry Pi', 'zh-TW': 'Raspberry Pi' } },
    { value: 'jetson', label: { en: 'NVIDIA Jetson', de: 'NVIDIA Jetson', fr: 'NVIDIA Jetson', it: 'NVIDIA Jetson', 'zh-TW': 'NVIDIA Jetson' } },
    { value: 'docker', label: { en: 'Docker', de: 'Docker', fr: 'Docker', it: 'Docker', 'zh-TW': 'Docker' } },
    { value: 'matlab', label: { en: 'MATLAB / Simulink', de: 'MATLAB / Simulink', fr: 'MATLAB / Simulink', it: 'MATLAB / Simulink', 'zh-TW': 'MATLAB / Simulink' } },
    { value: 'tensorflow', label: { en: 'TensorFlow', de: 'TensorFlow', fr: 'TensorFlow', it: 'TensorFlow', 'zh-TW': 'TensorFlow' } },
    { value: 'pytorch', label: { en: 'PyTorch', de: 'PyTorch', fr: 'PyTorch', it: 'PyTorch', 'zh-TW': 'PyTorch' } },
    { value: 'git', label: { en: 'Git / GitHub / GitLab', de: 'Git / GitHub / GitLab', fr: 'Git / GitHub / GitLab', it: 'Git / GitHub / GitLab', 'zh-TW': 'Git / GitHub / GitLab' } },
    { value: 'linux', label: { en: 'Linux / Ubuntu', de: 'Linux / Ubuntu', fr: 'Linux / Ubuntu', it: 'Linux / Ubuntu', 'zh-TW': 'Linux / Ubuntu' } },
    { value: 'digitaltwin', label: { en: 'Digital Twin Platforms', de: 'Digital-Twin-Plattformen', fr: 'Plateformes de jumeaux numériques', it: 'Piattaforme digital twin', 'zh-TW': '數位分身平台' } },
    { value: 'slack_jira', label: { en: 'Slack / Jira / Trello', de: 'Slack / Jira / Trello', fr: 'Slack / Jira / Trello', it: 'Slack / Jira / Trello', 'zh-TW': 'Slack / Jira / Trello' } },
    { value: 'vr_training', label: { en: 'VR for Training & Simulation', de: 'VR für Training & Simulation', fr: 'RV pour formation & simulation', it: 'VR per formazione & simulazione', 'zh-TW': 'VR 訓練與模擬' } },
    { value: 'cybersecurity', label: { en: 'Cybersecurity for Robotics', de: 'Cybersicherheit für Robotik', fr: 'Cybersécurité pour la robotique', it: 'Cybersicurezza per la robotica', 'zh-TW': '機器人網路安全' } },
    { value: 'cloud_infra', label: { en: 'Cloud Platforms (AWS, Azure, GCP)', de: 'Cloud-Plattformen (AWS, Azure, GCP)', fr: 'Plateformes cloud (AWS, Azure, GCP)', it: 'Piattaforme cloud (AWS, Azure, GCP)', 'zh-TW': '雲端平台 (AWS, Azure, GCP)' } },
  ];
}

/**
 * Academic department options — used by client-side dynamic override
 * when attendee_sector is 'academia'. Stored in the field repository for
 * reference; the actual swap happens on the client.
 */
function academicDepartmentOptions() {
  return multiOptI18n([
    { en: 'Robotics Lab / Institute', de: '[DE] Robotics Lab / Institute', fr: '[FR] Robotics Lab / Institute', it: '[IT] Robotics Lab / Institute', 'zh-TW': '[ZH] Robotics Lab / Institute' },
    { en: 'Computer Science', de: '[DE] Computer Science', fr: '[FR] Computer Science', it: '[IT] Computer Science', 'zh-TW': '[ZH] Computer Science' },
    { en: 'Electrical Engineering', de: '[DE] Electrical Engineering', fr: '[FR] Electrical Engineering', it: '[IT] Electrical Engineering', 'zh-TW': '[ZH] Electrical Engineering' },
    { en: 'Mechanical Engineering', de: '[DE] Mechanical Engineering', fr: '[FR] Mechanical Engineering', it: '[IT] Mechanical Engineering', 'zh-TW': '[ZH] Mechanical Engineering' },
    { en: 'Biomedical Engineering', de: '[DE] Biomedical Engineering', fr: '[FR] Biomedical Engineering', it: '[IT] Biomedical Engineering', 'zh-TW': '[ZH] Biomedical Engineering' },
    { en: 'AI / Machine Learning', de: '[DE] AI / Machine Learning', fr: '[FR] AI / Machine Learning', it: '[IT] AI / Machine Learning', 'zh-TW': '[ZH] AI / Machine Learning' },
    { en: 'Control Systems & Automation', de: '[DE] Control Systems & Automation', fr: '[FR] Control Systems & Automation', it: '[IT] Control Systems & Automation', 'zh-TW': '[ZH] Control Systems & Automation' },
    { en: 'Mechatronics', de: '[DE] Mechatronics', fr: '[FR] Mechatronics', it: '[IT] Mechatronics', 'zh-TW': '[ZH] Mechatronics' },
    { en: 'Materials Science', de: '[DE] Materials Science', fr: '[FR] Materials Science', it: '[IT] Materials Science', 'zh-TW': '[ZH] Materials Science' },
    { en: 'Physics', de: '[DE] Physics', fr: '[FR] Physics', it: '[IT] Physics', 'zh-TW': '[ZH] Physics' },
    { en: 'Mathematics', de: '[DE] Mathematics', fr: '[FR] Mathematics', it: '[IT] Mathematics', 'zh-TW': '[ZH] Mathematics' },
    { en: 'Neuroscience / Cognitive Science', de: '[DE] Neuroscience / Cognitive Science', fr: '[FR] Neuroscience / Cognitive Science', it: '[IT] Neuroscience / Cognitive Science', 'zh-TW': '[ZH] Neuroscience / Cognitive Science' },
    { en: 'Industrial Engineering', de: '[DE] Industrial Engineering', fr: '[FR] Industrial Engineering', it: '[IT] Industrial Engineering', 'zh-TW': '[ZH] Industrial Engineering' },
    { en: 'Research Management / Administration', de: '[DE] Research Management / Administration', fr: '[FR] Research Management / Administration', it: '[IT] Research Management / Administration', 'zh-TW': '[ZH] Research Management / Administration' },
    { en: 'Dean\'s Office / Faculty Leadership', de: '[DE] Dean\'s Office / Faculty Leadership', fr: '[FR] Dean\'s Office / Faculty Leadership', it: '[IT] Dean\'s Office / Faculty Leadership', 'zh-TW': '[ZH] Dean\'s Office / Faculty Leadership' },
  ]);
}

/**
 * Government / public-sector department options — used by client-side dynamic
 * override when attendee_sector is 'government'. Stored in the field repository
 * for reference; the actual swap happens on the client.
 */
function governmentDepartmentOptions() {
  return multiOptI18n([
    { en: 'Federal Administration', de: 'Bundesverwaltung', fr: 'Administration fédérale', it: 'Amministrazione federale', 'zh-TW': '聯邦行政機關' },
    { en: 'Cantonal Administration', de: 'Kantonale Verwaltung', fr: 'Administration cantonale', it: 'Amministrazione cantonale', 'zh-TW': '邦行政機關' },
    { en: 'Municipal / City Administration', de: 'Gemeinde- / Stadtverwaltung', fr: 'Administration municipale', it: 'Amministrazione comunale', 'zh-TW': '市政 / 地方行政' },
    { en: 'Innovation & Economic Development Agency', de: 'Innovations- & Wirtschaftsförderung', fr: 'Agence d\'innovation & développement économique', it: 'Agenzia innovazione & sviluppo economico', 'zh-TW': '創新與經濟發展機構' },
    { en: 'Research Funding Agency', de: 'Forschungsförderung', fr: 'Agence de financement de la recherche', it: 'Agenzia di finanziamento della ricerca', 'zh-TW': '研究資助機構' },
    { en: 'Education / Training Authority', de: 'Bildungs- / Ausbildungsbehörde', fr: 'Autorité éducation / formation', it: 'Autorità istruzione / formazione', 'zh-TW': '教育 / 培訓主管機關' },
    { en: 'Health Authority', de: 'Gesundheitsbehörde', fr: 'Autorité sanitaire', it: 'Autorità sanitaria', 'zh-TW': '衛生主管機關' },
    { en: 'Transport / Infrastructure Authority', de: 'Verkehrs- / Infrastrukturbehörde', fr: 'Autorité transports / infrastructures', it: 'Autorità trasporti / infrastrutture', 'zh-TW': '交通 / 基礎設施主管機關' },
    { en: 'Defense / Security', de: 'Verteidigung / Sicherheit', fr: 'Défense / Sécurité', it: 'Difesa / Sicurezza', 'zh-TW': '國防 / 安全' },
    { en: 'Regulatory / Standards Body', de: 'Regulierungs- / Normungsstelle', fr: 'Organisme de régulation / normalisation', it: 'Ente regolatorio / normazione', 'zh-TW': '監管 / 標準機構' },
    { en: 'Public Procurement', de: 'Öffentliches Beschaffungswesen', fr: 'Achats publics', it: 'Appalti pubblici', 'zh-TW': '公共採購' },
    { en: 'International Organization (UN, EU, etc.)', de: 'Internationale Organisation (UN, EU, etc.)', fr: 'Organisation internationale (ONU, UE, etc.)', it: 'Organizzazione internazionale (ONU, UE, ecc.)', 'zh-TW': '國際組織（聯合國、歐盟等）' },
    { en: 'Embassy / Consulate', de: 'Botschaft / Konsulat', fr: 'Ambassade / Consulat', it: 'Ambasciata / Consolato', 'zh-TW': '大使館 / 領事館' },
    { en: 'Other Public-Sector Entity', de: 'Andere öffentliche Stelle', fr: 'Autre entité du secteur public', it: 'Altro ente pubblico', 'zh-TW': '其他公共部門單位' },
  ]);
}

/**
 * Robotics field options — mirrors SRA MAP `robotics_field` taxonomy exactly.
 * 4 top-level parent-field categories from the SRA MAP plugin.
 */
function roboticsFieldOptions() {
  return [
    { value: 'industrial_automation', label: { en: 'Industrial Automation', de: 'Industrieautomation', fr: 'Automatisation industrielle', it: 'Automazione industriale', 'zh-TW': '工業自動化' } },
    { value: 'healthcare_medical', label: { en: 'Healthcare & Medical Robotics', de: 'Gesundheit & Medizinrobotik', fr: 'Robotique médicale & santé', it: 'Robotica sanitaria & medica', 'zh-TW': '醫療與健康機器人' } },
    { value: 'agriculture_environmental', label: { en: 'Agriculture & Environmental', de: 'Landwirtschaft & Umwelt', fr: 'Agriculture & environnement', it: 'Agricoltura & ambiente', 'zh-TW': '農業與環境' } },
    { value: 'transportation_logistics', label: { en: 'Transportation & Logistics', de: 'Transport & Logistik', fr: 'Transport & logistique', it: 'Trasporti & logistica', 'zh-TW': '運輸與物流' } },
  ];
}

/**
 * Robotics subfield options — mirrors SRA MAP `robotics_subfield` taxonomy exactly.
 * 20 subfields organized under the 4 parent fields.
 */
function roboticsSubfieldOptions() {
  return [
    // Industrial Automation subfields
    { value: 'assembly_robotics', label: { en: 'Assembly Robotics', de: 'Montagerobotik', fr: 'Robotique d\'assemblage', it: 'Robotica di assemblaggio', 'zh-TW': '組裝機器人' } },
    { value: 'motion_control', label: { en: 'Motion Control Systems', de: 'Bewegungssteuerungssysteme', fr: 'Systèmes de contrôle de mouvements', it: 'Sistemi di controllo del moto', 'zh-TW': '運動控制系統' } },
    { value: 'plc_integration', label: { en: 'PLC Integration', de: 'SPS-Integration', fr: 'Intégration API', it: 'Integrazione PLC', 'zh-TW': 'PLC 整合' } },
    { value: 'robot_vision', label: { en: 'Robot Vision Systems', de: 'Roboterbildverarbeitungssysteme', fr: 'Systèmes de vision robotique', it: 'Sistemi di visione robotica', 'zh-TW': '機器人視覺系統' } },
    { value: 'collaborative_robots', label: { en: 'Collaborative Robots (Cobots)', de: 'Kollaborative Roboter (Cobots)', fr: 'Robots collaboratifs (cobots)', it: 'Robot collaborativi (cobot)', 'zh-TW': '協作機器人 (Cobot)' } },
    // Healthcare & Medical subfields
    { value: 'surgical_robotics', label: { en: 'Surgical Robotics', de: 'Chirurgische Robotik', fr: 'Robotique chirurgicale', it: 'Robotica chirurgica', 'zh-TW': '手術機器人' } },
    { value: 'rehabilitation', label: { en: 'Rehabilitation Robotics', de: 'Rehabilitationsrobotik', fr: 'Robotique de réadaptation', it: 'Robotica riabilitativa', 'zh-TW': '復健機器人' } },
    { value: 'prosthetics', label: { en: 'Prosthetics & Exoskeletons', de: 'Prothetik & Exoskelette', fr: 'Prothèses & exosquelettes', it: 'Protesi & esoscheletri', 'zh-TW': '義肢與外骨骼' } },
    { value: 'telepresence', label: { en: 'Medical Telepresence', de: 'Medizinische Telepräsenz', fr: 'Téléprésence médicale', it: 'Telepresenza medica', 'zh-TW': '醫療遠端臨場' } },
    { value: 'laboratory_automation', label: { en: 'Laboratory Automation', de: 'Laborautomation', fr: 'Automatisation de laboratoire', it: 'Automazione di laboratorio', 'zh-TW': '實驗室自動化' } },
    // Agriculture & Environmental subfields
    { value: 'precision_farming', label: { en: 'Precision Farming', de: 'Präzisionslandwirtschaft', fr: 'Agriculture de précision', it: 'Agricoltura di precisione', 'zh-TW': '精準農業' } },
    { value: 'harvest_robotics', label: { en: 'Harvesting Robotics', de: 'Ernterobotik', fr: 'Robotique de récolte', it: 'Robotica per la raccolta', 'zh-TW': '採收機器人' } },
    { value: 'environmental_monitoring', label: { en: 'Environmental Monitoring', de: 'Umweltüberwachung', fr: 'Surveillance environnementale', it: 'Monitoraggio ambientale', 'zh-TW': '環境監測' } },
    { value: 'forestry_robotics', label: { en: 'Forestry Robotics', de: 'Forstrobotik', fr: 'Robotique forestière', it: 'Robotica forestale', 'zh-TW': '林業機器人' } },
    { value: 'irrigation_systems', label: { en: 'Automated Irrigation Systems', de: 'Automatische Bewässerungssysteme', fr: 'Systèmes d\'irrigation automatisés', it: 'Sistemi di irrigazione automatizzati', 'zh-TW': '自動灌溉系統' } },
    // Transportation & Logistics subfields
    { value: 'autonomous_vehicles', label: { en: 'Autonomous Vehicles', de: 'Autonome Fahrzeuge', fr: 'Véhicules autonomes', it: 'Veicoli autonomi', 'zh-TW': '自動駕駛車輛' } },
    { value: 'warehouse_robotics', label: { en: 'Warehouse Robotics', de: 'Lagerrobotik', fr: 'Robotique d\'entrepôt', it: 'Robotica di magazzino', 'zh-TW': '倉儲機器人' } },
    { value: 'delivery_systems', label: { en: 'Automated Delivery Systems', de: 'Automatische Liefersysteme', fr: 'Systèmes de livraison automatisés', it: 'Sistemi di consegna automatizzati', 'zh-TW': '自動配送系統' } },
    { value: 'cargo_handling', label: { en: 'Cargo Handling Systems', de: 'Frachthandhabungssysteme', fr: 'Systèmes de manutention du fret', it: 'Sistemi di movimentazione merci', 'zh-TW': '貨物處理系統' } },
    { value: 'fleet_management', label: { en: 'Fleet Management', de: 'Flottenmanagement', fr: 'Gestion de flotte', it: 'Gestione della flotta', 'zh-TW': '車隊管理' } },
  ];
}
