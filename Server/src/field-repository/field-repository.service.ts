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
      const { created, skipped } = await this.seedDefaults();
      if (created > 0) {
        this.logger.log(`Field repository seeded: ${created} created, ${skipped} skipped`);
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
   * Seed the repository with default fields. Idempotent — skips existing slugs.
   * Called by the seed script or manually from the admin.
   */
  async seedDefaults(): Promise<{ created: number; skipped: number }> {
    const defaults = getDefaultFieldDefinitions();
    let created = 0;
    let skipped = 0;

    for (const field of defaults) {
      const existing = await this.prisma.fieldDefinition.findUnique({
        where: { slug: field.slug },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await this.prisma.fieldDefinition.create({ data: field as any });
      created++;
    }

    this.logger.log(`Field repository seeded: ${created} created, ${skipped} skipped`);
    return { created, skipped };
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
    }),
    fd('country', { en: 'Country', de: 'Land', fr: 'Pays', it: 'Paese', 'zh-TW': '國家' }, 'country', 'must_have', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
    }),

    // ── Billing Fields ───────────────────────────────────────
    fd('billing_details_differ', { en: 'Billing details differ from above', de: 'Rechnungsangaben weichen ab', fr: 'Les coordonnées de facturation diffèrent', it: 'I dati di fatturazione sono diversi', 'zh-TW': '帳單資料與上方不同' }, 'checkbox', 'billing', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
      helpText: { en: 'Check if your billing address is different from your personal details.', de: 'Aktivieren, falls Ihre Rechnungsadresse abweicht.', fr: 'Cochez si votre adresse de facturation est différente.', it: 'Seleziona se l\'indirizzo di fatturazione è diverso.', 'zh-TW': '若帳單地址與個人資料不同，請勾選。' },
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
    fd('photography_consent', { en: 'Photography / Media Consent', de: 'Foto- / Medienzustimmung', fr: 'Consentement photo / média', it: 'Consenso foto / media', 'zh-TW': '攝影 / 媒體同意書' }, 'yes-no', 'legal_compliance', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
      validation: { required: true },
    }),

    // ── Profile Fields ───────────────────────────────────────
    fd('short_bio', { en: 'Short Bio', de: 'Kurzbiografie', fr: 'Biographie courte', it: 'Breve biografia', 'zh-TW': '簡短自介' }, 'textarea', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
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
    }),
    fd('personal_linkedin', { en: 'Personal LinkedIn', de: 'Persönliches LinkedIn', fr: 'LinkedIn personnel', it: 'LinkedIn personale', 'zh-TW': '個人 LinkedIn' }, 'url', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 3,
    }),
    fd('profile_photo', { en: 'Profile Photo', de: 'Profilfoto', fr: 'Photo de profil', it: 'Foto profilo', 'zh-TW': '個人照片' }, 'image-upload', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
    }),
    fd('profile_visibility', { en: 'Profile Visibility', de: 'Profilsichtbarkeit', fr: 'Visibilité du profil', it: 'Visibilità profilo', 'zh-TW': '個人檔案可見度' }, 'radio', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 5,
      options: [
        { value: 'public', label: { en: 'Visible to all attendees', de: 'Für alle Teilnehmenden sichtbar', fr: 'Visible par tous les participants', it: 'Visibile a tutti i partecipanti', 'zh-TW': '所有與會者皆可見' } },
        { value: 'connections', label: { en: 'Visible to connections only', de: 'Nur für Kontakte sichtbar', fr: 'Visible seulement par mes contacts', it: 'Visibile solo ai contatti', 'zh-TW': '僅聯絡人可見' } },
        { value: 'hidden', label: { en: 'Hidden', de: 'Ausgeblendet', fr: 'Masqué', it: 'Nascosto', 'zh-TW': '隱藏' } },
      ],
    }),
    fd('skills_expertise', { en: 'Skills / Expertise', de: 'Fähigkeiten / Fachgebiete', fr: 'Compétences / Expertise', it: 'Competenze / Specializzazioni', 'zh-TW': '技能與專業領域' }, 'multi-select', 'profile', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 6,
      helpText: { en: 'Select your areas of expertise in robotics.', de: 'Wählen Sie Ihre Fachgebiete in der Robotik.', fr: 'Sélectionnez vos domaines d\'expertise en robotique.', it: 'Seleziona le tue aree di competenza nella robotica.', 'zh-TW': '請選擇您在機器人領域的專業範疇。' },
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
    }),
    fd('preferred_meeting_format', { en: 'Preferred meeting format', de: 'Bevorzugtes Meetingformat', fr: 'Format de réunion préféré', it: 'Formato di incontro preferito', 'zh-TW': '偏好的會議形式' }, 'select', 'profile', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 8,
      options: multiOptI18n([
        { en: '1:1 onsite', de: '1:1 vor Ort', fr: '1:1 sur place', it: '1:1 in loco', 'zh-TW': '一對一現場' },
        { en: 'Group session', de: 'Gruppensitzung', fr: 'Session de groupe', it: 'Sessione di gruppo', 'zh-TW': '團體會議' },
        { en: 'Online / Virtual', de: 'Online / Virtuell', fr: 'En ligne / Virtuel', it: 'Online / Virtuale', 'zh-TW': '線上 / 虛擬' },
        { en: 'Either', de: 'Beides', fr: 'L\'un ou l\'autre', it: 'Qualsiasi', 'zh-TW': '皆可' },
      ]),
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
    }),
    fd('company_size', { en: 'Company Size', de: 'Firmengrösse', fr: 'Taille entreprise', it: 'Dimensione azienda', 'zh-TW': '公司規模' }, 'select', 'company', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 4,
      options: multiOpt(['1–10', '11–50', '51–200', '201–1000', '1000+']),
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
    }),
    fd('create_company_profile', { en: 'Create a Company Profile on SRA?', de: 'Firmenprofil auf SRA erstellen?', fr: 'Créer un profil entreprise SRA ?', it: 'Creare un profilo aziendale su SRA?', 'zh-TW': '是否在 SRA 建立公司簡介？' }, 'yes-no', 'company', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 8,
      categoryFilter: ['legal'],
      helpText: { en: 'If yes, a corporate member profile page will be created on swiss-robotics.org.', de: 'Falls ja, wird eine Firmenmitgliedsseite auf swiss-robotics.org erstellt.', fr: 'Si oui, une page de profil d\'entreprise sera créée sur swiss-robotics.org.', it: 'Se sì, verrà creata una pagina profilo aziendale su swiss-robotics.org.', 'zh-TW': '若選「是」，將在 swiss-robotics.org 上建立企業會員簡介頁面。' },
    }),

    // ── Privacy / Sharing Toggles ───────────────────────────
    fd('allow_messaging', { en: 'Allow attendees to message me in-platform', de: 'Nachrichten erlauben', fr: 'Autoriser les messages', it: 'Consentire messaggi da altri partecipanti', 'zh-TW': '允許與會者透過平台傳送訊息給我' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 0,
    }),
    fd('show_email', { en: 'Allow attendees to see my email', de: 'E-Mail anzeigen', fr: 'Afficher mon e-mail', it: 'Mostrare la mia e-mail ai partecipanti', 'zh-TW': '允許與會者查看我的電子郵件' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 1,
      defaultValue: false,
      helpText: { en: 'Defaults to OFF for your privacy.', de: 'Standardmässig deaktiviert.', fr: 'Désactivé par défaut pour votre confidentialité.', it: 'Disattivato per impostazione predefinita.', 'zh-TW': '預設為關閉以保護您的隱私。' },
    }),
    fd('allow_exhibitor_contact', { en: 'Allow exhibitors/sponsors to contact me', de: 'Kontakt durch Aussteller erlauben', fr: 'Autoriser le contact par les exposants', it: 'Consentire il contatto da espositori/sponsor', 'zh-TW': '允許展商/贊助商聯繫我' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
    }),
    fd('share_with_sponsors', { en: 'Allow my info to be shared with sponsors', de: 'Infos mit Sponsoren teilen', fr: 'Partager mes infos avec les sponsors', it: 'Condividere le mie informazioni con gli sponsor', 'zh-TW': '允許將我的資料分享給贊助商' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 3,
    }),
    fd('allow_b2b_qr_scan', { en: 'Allow B2B QR scan exchanges', de: 'B2B QR-Scan erlauben', fr: 'Autoriser échanges QR B2B', it: 'Consentire lo scambio tramite scansione QR B2B', 'zh-TW': '允許 B2B QR Code 交換' }, 'yes-no', 'privacy', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
    }),

    // ── B2B / Networking Questions ──────────────────────────
    fd('purchasing_decisions', { en: 'Are you involved in purchasing decisions?', de: 'Sind Sie an Kaufentscheidungen beteiligt?', fr: 'Participez-vous aux décisions d\'achat ?', it: 'Siete coinvolti nelle decisioni di acquisto?', 'zh-TW': '您是否參與採購決策？' }, 'yes-no', 'b2b', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 0,
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
    }),
    fd('interested_in_demos', { en: 'Interested in demos/meetings during event', de: 'Interesse an Demos/Meetings', fr: 'Intéressé par des démos/réunions', it: 'Interessato a demo/incontri durante l\'evento', 'zh-TW': '是否有興趣在活動期間參加展示或會議' }, 'multi-select', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 2,
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
    }),
    fd('agree_exhibitor_contact', { en: 'I agree to be contacted by exhibitors/sponsors', de: 'Kontakt durch Aussteller', fr: 'Contact par exposants', it: 'Acconsento ad essere contattato da espositori/sponsor', 'zh-TW': '我同意展商/贊助商與我聯繫' }, 'yes-no', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
    }),
    fd('share_b2b_profile', { en: 'I agree to share my B2B profile with attendees', de: 'B2B-Profil teilen', fr: 'Partager profil B2B', it: 'Acconsento a condividere il mio profilo B2B con i partecipanti', 'zh-TW': '我同意與其他與會者分享我的 B2B 個人檔案' }, 'yes-no', 'b2b', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 5,
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
    }),
    fd('topics_happy_to_talk', { en: 'Topics I\'m happy to talk about', de: 'Themen über die ich spreche', fr: 'Sujets dont j\'aime parler', it: 'Argomenti di cui parlo volentieri', 'zh-TW': '我樂意聊的話題' }, 'multi-select', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 4,
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
    }),
    fd('badge_name_preference', { en: 'Badge name preference', de: 'Badgename', fr: 'Nom sur le badge', it: 'Nome preferito sul badge', 'zh-TW': '名牌顯示名稱' }, 'text', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 6,
      helpText: { en: 'If different from your first/last name.', de: 'Falls abweichend von Vor-/Nachname.', fr: 'Si différent de votre nom.', it: 'Se diverso dal vostro nome/cognome.', 'zh-TW': '若與您的姓名不同，請填寫。' },
    }),
    fd('accessibility_requirements', { en: 'Accessibility requirements', de: 'Barrierefreiheit', fr: 'Besoins d\'accessibilité', it: 'Esigenze di accessibilità', 'zh-TW': '無障礙需求' }, 'textarea', 'questions', {
      widthDesktop: 100, widthMobile: 100, sortOrder: 7,
    }),
    fd('hotel_needed', { en: 'Hotel needed?', de: 'Hotel benötigt?', fr: 'Hôtel nécessaire ?', it: 'Necessità di hotel?', 'zh-TW': '是否需要住宿？' }, 'yes-no', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 8,
    }),
    fd('emergency_contact_name', { en: 'Emergency contact name', de: 'Notfallkontakt Name', fr: 'Contact d\'urgence nom', it: 'Nome contatto di emergenza', 'zh-TW': '緊急聯絡人姓名' }, 'text', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 9,
    }),
    fd('emergency_contact_phone', { en: 'Emergency contact phone', de: 'Notfallkontakt Telefon', fr: 'Contact d\'urgence téléphone', it: 'Telefono contatto di emergenza', 'zh-TW': '緊急聯絡人電話' }, 'phone', 'questions', {
      widthDesktop: 50, widthMobile: 100, sortOrder: 10,
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
    placeholder?: Record<string, string>;
    defaultValue?: unknown;
    categoryFilter?: string[];
    conditionalOn?: Record<string, unknown>;
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
    placeholder: opts?.placeholder ?? null,
    defaultValue: opts?.defaultValue ?? null,
    categoryFilter: opts?.categoryFilter ?? null,
    conditionalOn: opts?.conditionalOn ?? null,
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
