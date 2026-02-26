/**
 * SRD26 Pre-Made Form Templates — seed data.
 *
 * 7 reusable form templates for Swiss Robotics Days 2026 registration:
 *  1. Industry/Government Participant
 *  2. Startup/Spin-off Participant
 *  3. Academia/NGO Participant
 *  4. Reduced Ticket Participant
 *  5. Student Participant
 *  6. Exhibitor Package Purchase
 *  7. Exhibitor Staff Pass
 *
 * Each template includes:
 *  - Sections with ordering
 *  - Fields referencing FieldDefinition slugs
 *  - Conditions for SRA membership onboarding + profile creation paths
 *
 * CONDITION CONVENTION:
 *  - SRA membership sections use a virtual field `_is_sra_membership_ticket`
 *    which the form renderer should inject as `true` when the ticket type
 *    includes SRA membership. This keeps templates reusable across Standard
 *    and +SRA ticket variants without duplicating templates.
 *  - Within SRA sections, individual fields may have further conditions
 *    (e.g. resume fields only shown when `publish_resume` is true).
 *
 * @module form-templates/srd26-template-seeds
 */

import { FormSchemaDefinition, FormField, FormSection } from '../forms/forms.service';

// ─── Section / Field builder helpers ────────────────────────────

function section(id: string, label: Record<string, string>, order: number): FormSection {
  return { id, label, order };
}

/** Build a FormField referencing a FieldDefinition slug. */
function f(
  id: string,
  type: string,
  label: Record<string, string>,
  sectionId: string,
  order: number,
  opts?: {
    required?: boolean;
    conditions?: Array<{ field: string; operator: string; value: unknown }>;
    options?: Array<{ value: string; label: Record<string, string> }>;
    helpText?: Record<string, string>;
    placeholder?: Record<string, string>;
    validation?: Record<string, unknown>;
  },
): FormField {
  return {
    id,
    type: type as any,
    label,
    section: sectionId,
    order,
    required: opts?.required,
    conditions: opts?.conditions,
    options: opts?.options,
    helpText: opts?.helpText,
    placeholder: opts?.placeholder,
    validation: opts?.validation,
  };
}

// ─── Reusable section builders ──────────────────────────────────

/** Section: Personal Information (Block 1 — all tickets) */
function personalSection(startOrder: number): FormField[] {
  return [
    f('first_name', 'text', { en: 'First Name', de: 'Vorname', fr: 'Prénom', it: 'Nome', 'zh-TW': '名字' }, 'personal', startOrder, { required: true }),
    f('last_name', 'text', { en: 'Last Name', de: 'Nachname', fr: 'Nom', it: 'Cognome', 'zh-TW': '姓氏' }, 'personal', startOrder + 1, { required: true }),
    f('email', 'email', { en: 'Email Address', de: 'E-Mail-Adresse', fr: 'Adresse e-mail', it: 'Indirizzo e-mail', 'zh-TW': '電子郵件' }, 'personal', startOrder + 2, { required: true }),
    f('phone', 'phone', { en: 'Phone', de: 'Telefon', fr: 'Téléphone', it: 'Telefono', 'zh-TW': '電話' }, 'personal', startOrder + 3),
    f('city', 'text', { en: 'City', de: 'Stadt', fr: 'Ville', it: 'Città', 'zh-TW': '城市' }, 'personal', startOrder + 4),
    f('state_canton', 'select', { en: 'Canton', de: 'Kanton', fr: 'Canton', it: 'Cantone', 'zh-TW': '邦' }, 'personal', startOrder + 5),
    f('country', 'country', { en: 'Country', de: 'Land', fr: 'Pays', it: 'Paese', 'zh-TW': '國家' }, 'personal', startOrder + 6, { required: true }),
    f('personal_linkedin', 'url', { en: 'LinkedIn / Website', de: 'LinkedIn / Webseite', fr: 'LinkedIn / Site web', it: 'LinkedIn / Sito web', 'zh-TW': 'LinkedIn / 網站' }, 'personal', startOrder + 7),
  ];
}

/** Section: Legal Consents (Block 1 — all tickets) */
function legalConsentsSection(startOrder: number): FormField[] {
  return [
    f('terms_conditions', 'consent', { en: 'Terms & Conditions', de: 'AGB', fr: 'Conditions générales', it: 'Termini e condizioni', 'zh-TW': '條款與細則' }, 'legal_consents', startOrder, { required: true }),
    f('privacy_policy', 'consent', { en: 'Privacy Policy', de: 'Datenschutzrichtlinie', fr: 'Politique de confidentialité', it: 'Informativa sulla privacy', 'zh-TW': '隱私權政策' }, 'legal_consents', startOrder + 1, { required: true }),
    f('code_of_conduct', 'consent', { en: 'Code of Conduct', de: 'Verhaltenskodex', fr: 'Code de conduite', it: 'Codice di condotta', 'zh-TW': '行為準則' }, 'legal_consents', startOrder + 2, { required: true }),
    f('photography_consent', 'yes-no', { en: 'Photography / Media Consent', de: 'Foto- / Medienzustimmung', fr: 'Consentement photo / média', it: 'Consenso foto / media', 'zh-TW': '攝影 / 媒體同意書' }, 'legal_consents', startOrder + 3, { required: true }),
  ];
}

/**
 * Section: SRA Membership Opt-ins (only for +SRA tickets).
 * Uses virtual field `_is_sra_membership_ticket` as a condition gate.
 */
function sraMembershipOptinsSection(startOrder: number): FormField[] {
  const sraCondition = [{ field: '_is_sra_membership_ticket', operator: 'eq', value: true }];
  return [
    f('create_sra_profile', 'yes-no', { en: 'Create my SRA public profile', de: 'Mein öffentliches SRA-Profil erstellen', fr: 'Créer mon profil public SRA', it: 'Crea il mio profilo pubblico SRA', 'zh-TW': '建立我的 SRA 公開檔案' }, 'sra_membership', startOrder, {
      conditions: sraCondition,
    }),
    f('publish_resume', 'yes-no', { en: 'Publish my resume on SRA', de: 'Meinen Lebenslauf auf SRA veröffentlichen', fr: 'Publier mon CV sur SRA', it: 'Pubblica il mio CV su SRA', 'zh-TW': '在 SRA 發布我的履歷' }, 'sra_membership', startOrder + 1, {
      conditions: sraCondition,
    }),
    f('profile_visibility_resume', 'radio', { en: 'Profile visibility', de: 'Profilsichtbarkeit', fr: 'Visibilité du profil', it: 'Visibilità del profilo', 'zh-TW': '個人檔案可見度' }, 'sra_membership', startOrder + 2, {
      conditions: sraCondition,
      options: [
        { value: 'public', label: { en: 'Public', de: 'Öffentlich', fr: 'Public', it: 'Pubblico', 'zh-TW': '公開' } },
        { value: 'members', label: { en: 'Members only', de: 'Nur Mitglieder', fr: 'Membres uniquement', it: 'Solo membri', 'zh-TW': '僅限會員' } },
        { value: 'hidden', label: { en: 'Hidden', de: 'Ausgeblendet', fr: 'Masqué', it: 'Nascosto', 'zh-TW': '隱藏' } },
      ],
    }),
    f('allow_employer_contact', 'yes-no', { en: 'Allow employers to contact me', de: 'Arbeitgebern erlauben, mich zu kontaktieren', fr: 'Autoriser les employeurs à me contacter', it: 'Consenti ai datori di lavoro di contattarmi', 'zh-TW': '允許雇主聯繫我' }, 'sra_membership', startOrder + 3, {
      conditions: sraCondition,
    }),
  ];
}

/**
 * Section: Resume Creation (only when publish_resume = true).
 * Double-gated: SRA ticket + publish_resume opt-in.
 */
function resumeCreationSection(startOrder: number): FormField[] {
  const resumeConditions = [
    { field: '_is_sra_membership_ticket', operator: 'eq', value: true },
    { field: 'publish_resume', operator: 'eq', value: true },
  ];
  return [
    f('professional_title', 'text', { en: 'Professional Title / Headline', de: 'Berufstitel / Überschrift', fr: 'Titre professionnel', it: 'Titolo professionale', 'zh-TW': '職稱 / 標題' }, 'resume_creation', startOrder, { required: true, conditions: resumeConditions }),
    f('short_bio_resume', 'textarea', { en: 'Short Bio / Pitch', de: 'Kurzbiografie / Pitch', fr: 'Bio courte / Pitch', it: 'Breve bio / Pitch', 'zh-TW': '簡短自介' }, 'resume_creation', startOrder + 1, { conditions: resumeConditions, validation: { maxLength: 500 } }),
    f('position_type_sought', 'multi-select', { en: 'Type of position sought', de: 'Art der gesuchten Stelle', fr: 'Type de poste recherché', it: 'Tipo di posizione cercata', 'zh-TW': '尋求的職位類型' }, 'resume_creation', startOrder + 2, {
      conditions: resumeConditions,
      options: [
        { value: 'full-time', label: { en: 'Full-time', de: 'Vollzeit', fr: 'Temps plein', it: 'Tempo pieno', 'zh-TW': '全職' } },
        { value: 'part-time', label: { en: 'Part-time', de: 'Teilzeit', fr: 'Temps partiel', it: 'Part-time', 'zh-TW': '兼職' } },
        { value: 'internship', label: { en: 'Internship', de: 'Praktikum', fr: 'Stage', it: 'Tirocinio', 'zh-TW': '實習' } },
        { value: 'freelance', label: { en: 'Freelance / Consulting', de: 'Freiberuflich / Beratung', fr: 'Freelance / Conseil', it: 'Freelance / Consulenza', 'zh-TW': '自由工作 / 顧問' } },
      ],
    }),
    f('remote_preference', 'select', { en: 'Remote work preference', de: 'Remote-Arbeit Präferenz', fr: 'Préférence télétravail', it: 'Preferenza lavoro remoto', 'zh-TW': '遠端工作偏好' }, 'resume_creation', startOrder + 3, {
      conditions: resumeConditions,
      options: [
        { value: 'remote', label: { en: 'Remote only', de: 'Nur Remote', fr: 'Télétravail uniquement', it: 'Solo da remoto', 'zh-TW': '僅限遠端' } },
        { value: 'hybrid', label: { en: 'Hybrid', de: 'Hybrid', fr: 'Hybride', it: 'Ibrido', 'zh-TW': '混合模式' } },
        { value: 'onsite', label: { en: 'On-site', de: 'Vor Ort', fr: 'Sur place', it: 'In loco', 'zh-TW': '實體辦公' } },
      ],
    }),
    f('availability_date', 'date', { en: 'Available from', de: 'Verfügbar ab', fr: 'Disponible à partir de', it: 'Disponibile dal', 'zh-TW': '可開始日期' }, 'resume_creation', startOrder + 4, { conditions: resumeConditions }),
    f('work_permit', 'select', { en: 'Work permit status', de: 'Arbeitsbewilligungsstatus', fr: 'Statut du permis de travail', it: 'Stato permesso di lavoro', 'zh-TW': '工作許可狀態' }, 'resume_creation', startOrder + 5, {
      conditions: resumeConditions,
      options: [
        { value: 'none', label: { en: 'None', de: 'Keine', fr: 'Aucun', it: 'Nessuno', 'zh-TW': '無' } },
        { value: 'l_g_permit', label: { en: 'L or G Permit', de: 'L- oder G-Bewilligung', fr: 'Permis L ou G', it: 'Permesso L o G', 'zh-TW': 'L 或 G 許可' } },
        { value: 'b_permit', label: { en: 'B Permit', de: 'B-Bewilligung', fr: 'Permis B', it: 'Permesso B', 'zh-TW': 'B 許可' } },
        { value: 'c_permit', label: { en: 'C Permit', de: 'C-Bewilligung', fr: 'Permis C', it: 'Permesso C', 'zh-TW': 'C 許可' } },
        { value: 'swiss_citizen', label: { en: 'Swiss citizen', de: 'Schweizer Bürger/in', fr: 'Citoyen(ne) suisse', it: 'Cittadino/a svizzero/a', 'zh-TW': '瑞士公民' } },
      ],
    }),
    f('expertise_area', 'multi-select', { en: 'Field(s) of experience', de: 'Erfahrungsbereiche', fr: 'Domaines d\'expérience', it: 'Aree di esperienza', 'zh-TW': '經驗領域' }, 'resume_creation', startOrder + 6, { required: true, conditions: resumeConditions }),
    f('skills_tools', 'multi-select', { en: 'Skills & Tools', de: 'Fähigkeiten & Werkzeuge', fr: 'Compétences & Outils', it: 'Competenze & Strumenti', 'zh-TW': '技能與工具' }, 'resume_creation', startOrder + 7, { required: true, conditions: resumeConditions }),
    f('languages_proficiency', 'text', { en: 'Languages spoken (with proficiency)', de: 'Sprachkenntnisse (mit Niveau)', fr: 'Langues parlées (avec niveau)', it: 'Lingue parlate (con livello)', 'zh-TW': '語言能力（含程度）' }, 'resume_creation', startOrder + 8, {
      conditions: resumeConditions,
      placeholder: { en: 'e.g. English (C1), German (B2)', de: 'z.B. Deutsch (C1), Englisch (B2)', fr: 'ex. Français (C1), Anglais (B2)', it: 'es. Italiano (C1), Inglese (B2)', 'zh-TW': '例：英語 (C1)、德語 (B2)' },
    }),
    f('education_level', 'select', { en: 'Highest level of education', de: 'Höchster Bildungsabschluss', fr: 'Plus haut niveau d\'études', it: 'Più alto livello di istruzione', 'zh-TW': '最高學歷' }, 'resume_creation', startOrder + 9, {
      conditions: resumeConditions,
      options: [
        { value: 'bachelors', label: { en: 'Bachelor\'s', de: 'Bachelor', fr: 'Bachelor', it: 'Bachelor', 'zh-TW': '學士' } },
        { value: 'masters', label: { en: 'Master\'s', de: 'Master', fr: 'Master', it: 'Master', 'zh-TW': '碩士' } },
        { value: 'phd', label: { en: 'PhD', de: 'Doktorat', fr: 'Doctorat', it: 'Dottorato', 'zh-TW': '博士' } },
      ],
    }),
    f('diploma_specialization', 'text', { en: 'Specialization as per diploma', de: 'Spezialisierung gemäss Abschluss', fr: 'Spécialisation selon diplôme', it: 'Specializzazione da diploma', 'zh-TW': '學位專業' }, 'resume_creation', startOrder + 10, { conditions: resumeConditions }),
    f('diploma_year', 'text', { en: 'Year of diploma', de: 'Abschlussjahr', fr: 'Année du diplôme', it: 'Anno di diploma', 'zh-TW': '畢業年份' }, 'resume_creation', startOrder + 11, { conditions: resumeConditions, validation: { pattern: '[0-9]{4}' } }),
    f('diploma_in_progress', 'checkbox', { en: 'Diploma in progress', de: 'Studium laufend', fr: 'Diplôme en cours', it: 'Diploma in corso', 'zh-TW': '在學中' }, 'resume_creation', startOrder + 12, { conditions: resumeConditions }),
    f('resume_upload', 'file', { en: 'Upload full CV', de: 'Vollständigen Lebenslauf hochladen', fr: 'Télécharger le CV complet', it: 'Carica il CV completo', 'zh-TW': '上傳完整履歷' }, 'resume_creation', startOrder + 13, { conditions: resumeConditions }),
    f('portfolio_url', 'url', { en: 'Portfolio link', de: 'Portfolio-Link', fr: 'Lien du portfolio', it: 'Link al portfolio', 'zh-TW': '作品集連結' }, 'resume_creation', startOrder + 14, { conditions: resumeConditions }),
    f('scholar_github_url', 'url', { en: 'Google Scholar / GitHub', de: 'Google Scholar / GitHub', fr: 'Google Scholar / GitHub', it: 'Google Scholar / GitHub', 'zh-TW': 'Google Scholar / GitHub' }, 'resume_creation', startOrder + 15, { conditions: resumeConditions }),
  ];
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 1 — Industry/Government Participant
// ═══════════════════════════════════════════════════════════════

function template1_IndustryGovParticipant(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('personal', { en: 'Personal Information', de: 'Persönliche Angaben', fr: 'Informations personnelles', it: 'Informazioni personali', 'zh-TW': '個人資料' }, 0),
    section('professional', { en: 'Professional Information', de: 'Berufliche Angaben', fr: 'Informations professionnelles', it: 'Informazioni professionali', 'zh-TW': '專業資料' }, 1),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 2),
    section('sra_membership', { en: 'SRA Membership Profile', de: 'SRA-Mitgliedschaftsprofil', fr: 'Profil membre SRA', it: 'Profilo membro SRA', 'zh-TW': 'SRA 會員檔案' }, 3),
    section('resume_creation', { en: 'Resume / Public Profile', de: 'Lebenslauf / Öffentliches Profil', fr: 'CV / Profil public', it: 'CV / Profilo pubblico', 'zh-TW': '履歷 / 公開檔案' }, 4),
  ];

  const fields: FormField[] = [
    ...personalSection(0),
    // Professional section
    f('company_name', 'text', { en: 'Company / Institution', de: 'Firma / Institution', fr: 'Entreprise / Institution', it: 'Azienda / Istituzione', 'zh-TW': '公司 / 機構' }, 'professional', 0, { required: true }),
    f('company_website', 'url', { en: 'Company Website', de: 'Firmenwebsite', fr: 'Site web', it: 'Sito web aziendale', 'zh-TW': '公司網站' }, 'professional', 1),
    f('job_title', 'text', { en: 'Job Title', de: 'Berufsbezeichnung', fr: 'Titre du poste', it: 'Qualifica', 'zh-TW': '職稱' }, 'professional', 2),
    f('department', 'select', { en: 'Department', de: 'Abteilung', fr: 'Département', it: 'Reparto', 'zh-TW': '部門' }, 'professional', 3),
    f('industry_sector', 'multi-select', { en: 'Industry / Sector', de: 'Branche / Sektor', fr: 'Industrie / Secteur', it: 'Settore', 'zh-TW': '產業 / 領域' }, 'professional', 4),
    f('company_size', 'select', { en: 'Company Size', de: 'Firmengrösse', fr: 'Taille entreprise', it: 'Dimensione', 'zh-TW': '公司規模' }, 'professional', 5),
    ...legalConsentsSection(0),
    ...sraMembershipOptinsSection(0),
    ...resumeCreationSection(0),
  ];

  return {
    name: 'SRD26 — Industry/Government Participant',
    description: 'Registration form for industry and government attendees. Includes SRA membership onboarding sections (conditional on +SRA ticket variant).',
    category: 'general',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 2 — Startup/Spin-off Participant
// ═══════════════════════════════════════════════════════════════

function template2_StartupParticipant(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('personal', { en: 'Personal Information', de: 'Persönliche Angaben', fr: 'Informations personnelles', it: 'Informazioni personali', 'zh-TW': '個人資料' }, 0),
    section('professional', { en: 'Professional Information', de: 'Berufliche Angaben', fr: 'Informations professionnelles', it: 'Informazioni professionali', 'zh-TW': '專業資料' }, 1),
    section('startup_eligibility', { en: 'Startup Eligibility', de: 'Startup-Berechtigung', fr: 'Éligibilité startup', it: 'Idoneità startup', 'zh-TW': '新創資格' }, 2),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 3),
    section('sra_membership', { en: 'SRA Membership Profile', de: 'SRA-Mitgliedschaftsprofil', fr: 'Profil membre SRA', it: 'Profilo membro SRA', 'zh-TW': 'SRA 會員檔案' }, 4),
    section('resume_creation', { en: 'Resume / Public Profile', de: 'Lebenslauf / Öffentliches Profil', fr: 'CV / Profil public', it: 'CV / Profilo pubblico', 'zh-TW': '履歷 / 公開檔案' }, 5),
  ];

  const fields: FormField[] = [
    ...personalSection(0),
    // Professional section (same as Industry)
    f('company_name', 'text', { en: 'Company / Startup Name', de: 'Firma / Startup-Name', fr: 'Entreprise / Nom startup', it: 'Azienda / Nome startup', 'zh-TW': '公司 / 新創名稱' }, 'professional', 0, { required: true }),
    f('company_website', 'url', { en: 'Company Website', de: 'Firmenwebsite', fr: 'Site web', it: 'Sito web', 'zh-TW': '公司網站' }, 'professional', 1),
    f('job_title', 'text', { en: 'Job Title / Role', de: 'Berufsbezeichnung / Rolle', fr: 'Titre / Rôle', it: 'Qualifica / Ruolo', 'zh-TW': '職稱 / 角色' }, 'professional', 2),
    f('industry_sector', 'multi-select', { en: 'Industry / Sector', de: 'Branche / Sektor', fr: 'Industrie / Secteur', it: 'Settore', 'zh-TW': '產業 / 領域' }, 'professional', 3),
    f('company_size', 'select', { en: 'Team Size', de: 'Teamgrösse', fr: 'Taille de l\'équipe', it: 'Dimensione team', 'zh-TW': '團隊規模' }, 'professional', 4),
    // Startup eligibility section
    f('startup_incorporated_recently', 'checkbox', { en: 'Company incorporated within last 5 years', de: 'Firma in den letzten 5 Jahren gegründet', fr: 'Société créée il y a moins de 5 ans', it: 'Società costituita negli ultimi 5 anni', 'zh-TW': '公司於過去 5 年內成立' }, 'startup_eligibility', 0, { required: true }),
    f('startup_incorporation_year', 'text', { en: 'Incorporation Year', de: 'Gründungsjahr', fr: 'Année de création', it: 'Anno di costituzione', 'zh-TW': '成立年份' }, 'startup_eligibility', 1, { required: true, validation: { pattern: '[0-9]{4}' } }),
    f('startup_pitch_deck_url', 'url', { en: 'Website / Pitch Deck URL', de: 'Website / Pitch Deck URL', fr: 'Site web / Pitch deck', it: 'Sito / Pitch deck', 'zh-TW': '網站 / 簡報連結' }, 'startup_eligibility', 2),
    f('startup_team_size', 'select', { en: 'Team Size', de: 'Teamgrösse', fr: 'Taille de l\'équipe', it: 'Dimensione team', 'zh-TW': '團隊規模' }, 'startup_eligibility', 3, {
      options: [
        { value: '1_5', label: { en: '1–5', de: '1–5', fr: '1–5', it: '1–5', 'zh-TW': '1–5' } },
        { value: '6_15', label: { en: '6–15', de: '6–15', fr: '6–15', it: '6–15', 'zh-TW': '6–15' } },
        { value: '16_50', label: { en: '16–50', de: '16–50', fr: '16–50', it: '16–50', 'zh-TW': '16–50' } },
        { value: '50_plus', label: { en: '50+', de: '50+', fr: '50+', it: '50+', 'zh-TW': '50+' } },
      ],
    }),
    f('startup_looking_for', 'multi-select', { en: 'Looking for…', de: 'Auf der Suche nach…', fr: 'À la recherche de…', it: 'Cerchiamo…', 'zh-TW': '尋找…' }, 'startup_eligibility', 4, {
      options: [
        { value: 'partners', label: { en: 'Partners', de: 'Partner', fr: 'Partenaires', it: 'Partner', 'zh-TW': '合作夥伴' } },
        { value: 'pilots', label: { en: 'Pilot projects', de: 'Pilotprojekte', fr: 'Projets pilotes', it: 'Progetti pilota', 'zh-TW': '試行計畫' } },
        { value: 'hiring', label: { en: 'Hiring talent', de: 'Talente einstellen', fr: 'Recrutement', it: 'Assunzioni', 'zh-TW': '招募人才' } },
        { value: 'funding', label: { en: 'Funding', de: 'Finanzierung', fr: 'Financement', it: 'Finanziamenti', 'zh-TW': '資金' } },
        { value: 'customers', label: { en: 'Customers', de: 'Kunden', fr: 'Clients', it: 'Clienti', 'zh-TW': '客戶' } },
        { value: 'mentors', label: { en: 'Mentors', de: 'Mentoren', fr: 'Mentors', it: 'Mentor', 'zh-TW': '導師' } },
      ],
    }),
    ...legalConsentsSection(0),
    ...sraMembershipOptinsSection(0),
    ...resumeCreationSection(0),
  ];

  return {
    name: 'SRD26 — Startup/Spin-off Participant',
    description: 'Registration form for startup and spin-off attendees. Includes startup eligibility verification and SRA membership onboarding.',
    category: 'general',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 3 — Academia/NGO Participant
// ═══════════════════════════════════════════════════════════════

function template3_AcademiaParticipant(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('personal', { en: 'Personal Information', de: 'Persönliche Angaben', fr: 'Informations personnelles', it: 'Informazioni personali', 'zh-TW': '個人資料' }, 0),
    section('academic', { en: 'Academic / Institution Details', de: 'Akademische / Institutionsangaben', fr: 'Détails académiques / institutionnels', it: 'Dettagli accademici', 'zh-TW': '學術 / 機構資料' }, 1),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 2),
    section('sra_membership', { en: 'SRA Membership Profile', de: 'SRA-Mitgliedschaftsprofil', fr: 'Profil membre SRA', it: 'Profilo membro SRA', 'zh-TW': 'SRA 會員檔案' }, 3),
    section('resume_creation', { en: 'Resume / Public Profile', de: 'Lebenslauf / Öffentliches Profil', fr: 'CV / Profil public', it: 'CV / Profilo pubblico', 'zh-TW': '履歷 / 公開檔案' }, 4),
  ];

  const fields: FormField[] = [
    ...personalSection(0),
    // Academic section
    f('institution_name', 'text', { en: 'Institution Name', de: 'Institutionsname', fr: 'Nom de l\'institution', it: 'Nome istituzione', 'zh-TW': '機構名稱' }, 'academic', 0, { required: true }),
    f('institution_department', 'text', { en: 'Department / Lab', de: 'Abteilung / Labor', fr: 'Département / Labo', it: 'Dipartimento / Lab', 'zh-TW': '系所 / 實驗室' }, 'academic', 1),
    f('academic_role', 'select', { en: 'Role', de: 'Rolle', fr: 'Rôle', it: 'Ruolo', 'zh-TW': '職位' }, 'academic', 2, {
      required: true,
      options: [
        { value: 'faculty', label: { en: 'Faculty', de: 'Fakultät', fr: 'Corps professoral', it: 'Docente', 'zh-TW': '教職員' } },
        { value: 'researcher', label: { en: 'Researcher', de: 'Forscher/in', fr: 'Chercheur/euse', it: 'Ricercatore', 'zh-TW': '研究員' } },
        { value: 'postdoc', label: { en: 'Postdoc', de: 'Postdoktorand/in', fr: 'Post-doctorant/e', it: 'Post-doc', 'zh-TW': '博士後' } },
        { value: 'phd', label: { en: 'PhD student', de: 'Doktorand/in', fr: 'Doctorant/e', it: 'Dottorando', 'zh-TW': '博士生' } },
        { value: 'admin', label: { en: 'Admin / Staff', de: 'Verwaltung', fr: 'Administration', it: 'Amministrazione', 'zh-TW': '行政人員' } },
        { value: 'other', label: { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' } },
      ],
    }),
    f('research_areas', 'multi-select', { en: 'Research / Technology Areas', de: 'Forschungsbereiche', fr: 'Domaines de recherche', it: 'Aree di ricerca', 'zh-TW': '研究領域' }, 'academic', 3),
    ...legalConsentsSection(0),
    ...sraMembershipOptinsSection(0),
    ...resumeCreationSection(0),
  ];

  return {
    name: 'SRD26 — Academia/NGO Participant',
    description: 'Registration form for academia, university, research institution, and NGO attendees. Includes SRA membership onboarding.',
    category: 'general',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 4 — Reduced Ticket Participant
// ═══════════════════════════════════════════════════════════════

function template4_ReducedParticipant(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('personal', { en: 'Personal Information', de: 'Persönliche Angaben', fr: 'Informations personnelles', it: 'Informazioni personali', 'zh-TW': '個人資料' }, 0),
    section('reduced_eligibility', { en: 'Reduced Ticket Eligibility', de: 'Ermässigungsberechtigung', fr: 'Éligibilité tarif réduit', it: 'Idoneità tariffa ridotta', 'zh-TW': '優惠票資格' }, 1),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 2),
    section('sra_membership', { en: 'SRA Membership Profile', de: 'SRA-Mitgliedschaftsprofil', fr: 'Profil membre SRA', it: 'Profilo membro SRA', 'zh-TW': 'SRA 會員檔案' }, 3),
    section('resume_creation', { en: 'Resume / Public Profile', de: 'Lebenslauf / Öffentliches Profil', fr: 'CV / Profil public', it: 'CV / Profilo pubblico', 'zh-TW': '履歷 / 公開檔案' }, 4),
  ];

  const fields: FormField[] = [
    ...personalSection(0),
    // Reduced eligibility — minimal friction
    f('reduced_status', 'select', { en: 'Reduced ticket status', de: 'Ermässigungsstatus', fr: 'Statut de réduction', it: 'Stato riduzione', 'zh-TW': '優惠票身分' }, 'reduced_eligibility', 0, {
      required: true,
      options: [
        { value: 'unemployed', label: { en: 'Unemployed', de: 'Arbeitslos', fr: 'Sans emploi', it: 'Disoccupato', 'zh-TW': '待業中' } },
        { value: 'retired', label: { en: 'Retired', de: 'Pensioniert', fr: 'Retraité', it: 'In pensione', 'zh-TW': '已退休' } },
        { value: 'other', label: { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' } },
      ],
    }),
    f('reduced_note', 'textarea', { en: 'Additional note (optional)', de: 'Zusätzliche Bemerkung (optional)', fr: 'Remarque (optionnel)', it: 'Nota aggiuntiva (opzionale)', 'zh-TW': '補充說明（選填）' }, 'reduced_eligibility', 1),
    ...legalConsentsSection(0),
    ...sraMembershipOptinsSection(0),
    ...resumeCreationSection(0),
  ];

  return {
    name: 'SRD26 — Reduced Ticket Participant',
    description: 'Lightweight registration form for unemployed, retired, and other reduced-rate attendees. Includes SRA membership onboarding.',
    category: 'general',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 5 — Student Participant
// ═══════════════════════════════════════════════════════════════

function template5_StudentParticipant(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('personal', { en: 'Personal Information', de: 'Persönliche Angaben', fr: 'Informations personnelles', it: 'Informazioni personali', 'zh-TW': '個人資料' }, 0),
    section('student_info', { en: 'Student Information', de: 'Studierendenangaben', fr: 'Informations étudiant', it: 'Informazioni studente', 'zh-TW': '學生資料' }, 1),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 2),
    section('sra_membership', { en: 'SRA Membership Profile', de: 'SRA-Mitgliedschaftsprofil', fr: 'Profil membre SRA', it: 'Profilo membro SRA', 'zh-TW': 'SRA 會員檔案' }, 3),
    section('resume_creation', { en: 'Resume / Public Profile', de: 'Lebenslauf / Öffentliches Profil', fr: 'CV / Profil public', it: 'CV / Profilo pubblico', 'zh-TW': '履歷 / 公開檔案' }, 4),
  ];

  const fields: FormField[] = [
    ...personalSection(0),
    // Student info section
    f('student_institution', 'text', { en: 'University / School', de: 'Universität / Schule', fr: 'Université / École', it: 'Università / Scuola', 'zh-TW': '大學 / 學校' }, 'student_info', 0, { required: true }),
    f('student_level', 'select', { en: 'Study Level', de: 'Studienstufe', fr: 'Niveau d\'études', it: 'Livello di studio', 'zh-TW': '學歷程度' }, 'student_info', 1, {
      required: true,
      options: [
        { value: 'bsc', label: { en: 'Bachelor\'s (BSc)', de: 'Bachelor (BSc)', fr: 'Bachelor (BSc)', it: 'Bachelor (BSc)', 'zh-TW': '學士 (BSc)' } },
        { value: 'msc', label: { en: 'Master\'s (MSc)', de: 'Master (MSc)', fr: 'Master (MSc)', it: 'Master (MSc)', 'zh-TW': '碩士 (MSc)' } },
        { value: 'phd', label: { en: 'PhD', de: 'Doktorat', fr: 'Doctorat', it: 'Dottorato', 'zh-TW': '博士' } },
      ],
    }),
    f('student_field_of_study', 'text', { en: 'Field of Study', de: 'Studienrichtung', fr: 'Domaine d\'études', it: 'Campo di studio', 'zh-TW': '研究領域' }, 'student_info', 2, { required: true }),
    f('student_graduation_year', 'text', { en: 'Graduation Year', de: 'Abschlussjahr', fr: 'Année de diplôme', it: 'Anno di laurea', 'zh-TW': '畢業年份' }, 'student_info', 3, { validation: { pattern: '[0-9]{4}' } }),
    f('student_in_progress', 'checkbox', { en: 'Diploma in progress', de: 'Studium laufend', fr: 'Diplôme en cours', it: 'Diploma in corso', 'zh-TW': '在學中' }, 'student_info', 4),
    f('student_supervisor', 'text', { en: 'Supervisor / Lab', de: 'Betreuer/in / Labor', fr: 'Superviseur / Labo', it: 'Supervisore / Lab', 'zh-TW': '指導教授 / 實驗室' }, 'student_info', 5),
    f('student_seeking', 'multi-select', { en: 'Seeking opportunities', de: 'Suche nach', fr: 'Recherche', it: 'Cerco', 'zh-TW': '尋求機會' }, 'student_info', 6, {
      options: [
        { value: 'internship', label: { en: 'Internship', de: 'Praktikum', fr: 'Stage', it: 'Tirocinio', 'zh-TW': '實習' } },
        { value: 'thesis', label: { en: 'Thesis project', de: 'Abschlussarbeit', fr: 'Projet de thèse', it: 'Progetto di tesi', 'zh-TW': '畢業論文專案' } },
        { value: 'full_time', label: { en: 'Full-time position', de: 'Vollzeitstelle', fr: 'Poste à plein temps', it: 'Posizione a tempo pieno', 'zh-TW': '全職工作' } },
      ],
    }),
    ...legalConsentsSection(0),
    ...sraMembershipOptinsSection(0),
    ...resumeCreationSection(0),
  ];

  return {
    name: 'SRD26 — Student Participant',
    description: 'Registration form for BSc, MSc, and PhD students. Includes student verification fields and SRA membership onboarding.',
    category: 'general',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 6 — Exhibitor Package Purchase
// ═══════════════════════════════════════════════════════════════

function template6_ExhibitorPackage(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('company_billing', { en: 'Company & Billing', de: 'Firma & Rechnungsstellung', fr: 'Entreprise & Facturation', it: 'Azienda & Fatturazione', 'zh-TW': '公司與帳單' }, 0),
    section('exhibitor_ops', { en: 'Exhibitor Operations', de: 'Aussteller-Details', fr: 'Détails exposant', it: 'Dettagli espositore', 'zh-TW': '展商營運' }, 1),
    section('org_profile', { en: 'Organization Profile (SRA Directory)', de: 'Organisationsprofil (SRA-Verzeichnis)', fr: 'Profil organisation (Annuaire SRA)', it: 'Profilo organizzazione (Elenco SRA)', 'zh-TW': '組織檔案（SRA 目錄）' }, 2),
    section('map_listing', { en: 'Swiss Robotics Map Listing', de: 'Swiss Robotics Map Eintrag', fr: 'Entrée Swiss Robotics Map', it: 'Inserzione Swiss Robotics Map', 'zh-TW': '瑞士機器人地圖據點' }, 3),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 4),
  ];

  const orgProfileCondition = [{ field: 'create_org_profile', operator: 'eq', value: true }];
  const mapListingCondition = [{ field: 'create_map_listing', operator: 'eq', value: true }];

  const fields: FormField[] = [
    // Company & Billing
    f('org_legal_name', 'text', { en: 'Company Legal Name', de: 'Offizieller Firmenname', fr: 'Raison sociale', it: 'Denominazione legale', 'zh-TW': '公司法定名稱' }, 'company_billing', 0, { required: true }),
    f('exhibitor_vat_uid', 'text', { en: 'VAT / UID Number', de: 'MwSt / UID-Nummer', fr: 'Numéro TVA / IDE', it: 'Num. IVA / IDI', 'zh-TW': '統一編號 / UID' }, 'company_billing', 1),
    f('exhibitor_billing_address', 'text', { en: 'Billing Address', de: 'Rechnungsadresse', fr: 'Adresse de facturation', it: 'Indirizzo fatturazione', 'zh-TW': '帳單地址' }, 'company_billing', 2, { required: true }),
    f('exhibitor_billing_email', 'email', { en: 'Billing Email', de: 'Rechnungs-E-Mail', fr: 'E-mail facturation', it: 'E-mail fatturazione', 'zh-TW': '帳單信箱' }, 'company_billing', 3, { required: true }),
    f('exhibitor_po_number', 'text', { en: 'PO Number (optional)', de: 'Bestellnummer (optional)', fr: 'Numéro de commande (opt.)', it: 'Num. ordine (opz.)', 'zh-TW': '訂單編號（選填）' }, 'company_billing', 4),
    f('exhibitor_member_id', 'text', { en: 'SRA Member ID (for discount)', de: 'SRA-Mitgliedsnummer (für Rabatt)', fr: 'Num. membre SRA (réduction)', it: 'ID membro SRA (sconto)', 'zh-TW': 'SRA 會員編號（折扣用）' }, 'company_billing', 5),

    // Exhibitor Ops
    f('exhibitor_onsite_contact_name', 'text', { en: 'Primary On-site Contact', de: 'Kontaktperson vor Ort', fr: 'Contact sur place', it: 'Referente in loco', 'zh-TW': '現場主要聯絡人' }, 'exhibitor_ops', 0, { required: true }),
    f('exhibitor_onsite_contact_phone', 'phone', { en: 'Contact Phone', de: 'Kontakttelefon', fr: 'Téléphone contact', it: 'Telefono referente', 'zh-TW': '聯絡電話' }, 'exhibitor_ops', 1, { required: true }),
    f('org_website', 'url', { en: 'Company Website', de: 'Firmenwebsite', fr: 'Site web', it: 'Sito web', 'zh-TW': '公司網站' }, 'exhibitor_ops', 2),
    f('exhibitor_company_description', 'textarea', { en: 'Company Description (for directory)', de: 'Firmenbeschreibung (für Verzeichnis)', fr: 'Description (pour annuaire)', it: 'Descrizione (per elenco)', 'zh-TW': '公司描述' }, 'exhibitor_ops', 3),
    f('exhibitor_logo', 'image-upload', { en: 'Company Logo', de: 'Firmenlogo', fr: 'Logo', it: 'Logo', 'zh-TW': '公司標誌' }, 'exhibitor_ops', 4),
    f('exhibitor_robotics_fields', 'multi-select', { en: 'Robotics Fields', de: 'Robotik-Bereiche', fr: 'Domaines robotique', it: 'Campi robotica', 'zh-TW': '機器人領域' }, 'exhibitor_ops', 5),
    f('exhibitor_robotics_subfields', 'multi-select', { en: 'Robotics Sub-fields', de: 'Robotik-Unterbereiche', fr: 'Sous-domaines', it: 'Sotto-campi', 'zh-TW': '子領域' }, 'exhibitor_ops', 6),
    f('exhibitor_assign_passes_now', 'yes-no', { en: 'Assign included passes now?', de: 'Inkludierte Pässe jetzt zuweisen?', fr: 'Attribuer les passes maintenant ?', it: 'Assegnare i pass inclusi ora?', 'zh-TW': '現在分配通行證？' }, 'exhibitor_ops', 7),

    // Org Profile (conditional on create_org_profile)
    f('create_org_profile', 'yes-no', { en: 'Create organization profile in SRA directory', de: 'Organisationsprofil im SRA-Verzeichnis erstellen', fr: 'Créer profil dans annuaire SRA', it: 'Crea profilo nell\'elenco SRA', 'zh-TW': '在 SRA 目錄建立組織檔案' }, 'org_profile', 0),
    f('org_display_name', 'text', { en: 'Display Name', de: 'Anzeigename', fr: 'Nom d\'affichage', it: 'Nome visualizzato', 'zh-TW': '顯示名稱' }, 'org_profile', 1, { conditions: orgProfileCondition }),
    f('org_type', 'select', { en: 'Organization Type', de: 'Organisationstyp', fr: 'Type d\'organisation', it: 'Tipo organizzazione', 'zh-TW': '組織類型' }, 'org_profile', 2, {
      conditions: orgProfileCondition,
      options: [
        { value: 'industry-large', label: { en: 'Industry Large', de: 'Grossunternehmen', fr: 'Grande industrie', it: 'Grande industria', 'zh-TW': '大型企業' } },
        { value: 'industry-sme', label: { en: 'Industry SME', de: 'KMU', fr: 'PME', it: 'PMI', 'zh-TW': '中小企業' } },
        { value: 'research', label: { en: 'Research / University', de: 'Forschung / Universität', fr: 'Recherche / Université', it: 'Ricerca / Università', 'zh-TW': '研究 / 大學' } },
        { value: 'startup', label: { en: 'Startup / Spin-off', de: 'Startup / Spin-off', fr: 'Startup / Spin-off', it: 'Startup / Spin-off', 'zh-TW': '新創 / 衍生企業' } },
      ],
    }),
    f('org_contact_email', 'email', { en: 'Public Contact Email', de: 'Öffentliche Kontakt-E-Mail', fr: 'E-mail contact public', it: 'E-mail contatto pubblico', 'zh-TW': '公開信箱' }, 'org_profile', 3, { conditions: orgProfileCondition }),
    f('org_phone', 'phone', { en: 'Public Phone', de: 'Öffentliche Telefonnummer', fr: 'Téléphone public', it: 'Telefono pubblico', 'zh-TW': '公開電話' }, 'org_profile', 4, { conditions: orgProfileCondition }),
    f('org_description', 'textarea', { en: 'Short Description', de: 'Kurzbeschreibung', fr: 'Description courte', it: 'Descrizione breve', 'zh-TW': '簡短描述' }, 'org_profile', 5, { conditions: orgProfileCondition }),
    f('org_logo', 'image-upload', { en: 'Organization Logo', de: 'Organisationslogo', fr: 'Logo', it: 'Logo', 'zh-TW': '組織標誌' }, 'org_profile', 6, { conditions: orgProfileCondition }),
    f('org_we_offer', 'textarea', { en: 'We offer…', de: 'Wir bieten…', fr: 'Nous offrons…', it: 'Offriamo…', 'zh-TW': '我們提供…' }, 'org_profile', 7, { conditions: orgProfileCondition }),
    f('org_we_seek', 'textarea', { en: 'We are looking for…', de: 'Wir suchen…', fr: 'Nous recherchons…', it: 'Cerchiamo…', 'zh-TW': '我們正在尋找…' }, 'org_profile', 8, { conditions: orgProfileCondition }),
    f('org_tags', 'multi-select', { en: 'Tags / Keywords', de: 'Tags', fr: 'Tags', it: 'Tag', 'zh-TW': '標籤' }, 'org_profile', 9, { conditions: orgProfileCondition }),
    f('org_authorized_rep', 'checkbox', { en: 'I am authorized to represent this organization', de: 'Ich bin berechtigt, diese Organisation zu vertreten', fr: 'Je suis autorisé(e) à représenter cette organisation', it: 'Sono autorizzato a rappresentare questa organizzazione', 'zh-TW': '我有權代表此組織' }, 'org_profile', 10, { required: true, conditions: orgProfileCondition }),

    // Map Listing (conditional on create_map_listing)
    f('create_map_listing', 'yes-no', { en: 'Create Swiss Robotics Map listing', de: 'Swiss Robotics Map Eintrag erstellen', fr: 'Créer entrée Swiss Robotics Map', it: 'Crea inserzione Swiss Robotics Map', 'zh-TW': '建立瑞士機器人地圖據點' }, 'map_listing', 0),
    f('org_profile_visibility', 'radio', { en: 'Make listing public immediately?', de: 'Eintrag sofort veröffentlichen?', fr: 'Publier immédiatement ?', it: 'Pubblicare subito?', 'zh-TW': '立即公開？' }, 'map_listing', 1, {
      conditions: mapListingCondition,
      options: [
        { value: 'publish', label: { en: 'Yes', de: 'Ja', fr: 'Oui', it: 'Sì', 'zh-TW': '是' } },
        { value: 'draft', label: { en: 'No — pending review', de: 'Nein — zur Prüfung', fr: 'Non — en attente', it: 'No — in attesa', 'zh-TW': '否 — 待審核' } },
      ],
    }),
    f('org_address', 'text', { en: 'Address', de: 'Adresse', fr: 'Adresse', it: 'Indirizzo', 'zh-TW': '地址' }, 'map_listing', 2, { conditions: mapListingCondition }),
    f('org_city', 'text', { en: 'City', de: 'Stadt', fr: 'Ville', it: 'Città', 'zh-TW': '城市' }, 'map_listing', 3, { conditions: mapListingCondition }),
    f('org_canton', 'select', { en: 'Canton', de: 'Kanton', fr: 'Canton', it: 'Cantone', 'zh-TW': '邦' }, 'map_listing', 4, { conditions: mapListingCondition }),
    f('org_country', 'country', { en: 'Country', de: 'Land', fr: 'Pays', it: 'Paese', 'zh-TW': '國家' }, 'map_listing', 5, { conditions: mapListingCondition }),
    f('org_robotics_fields', 'multi-select', { en: 'Robotics Fields', de: 'Robotik-Bereiche', fr: 'Domaines robotique', it: 'Campi robotica', 'zh-TW': '機器人領域' }, 'map_listing', 6, { conditions: mapListingCondition }),
    f('org_robotics_subfields', 'multi-select', { en: 'Sub-fields', de: 'Unterbereiche', fr: 'Sous-domaines', it: 'Sotto-campi', 'zh-TW': '子領域' }, 'map_listing', 7, { conditions: mapListingCondition }),

    // Legal Consents
    ...legalConsentsSection(0),
  ];

  return {
    name: 'SRD26 — Exhibitor Package Purchase',
    description: 'Company-level registration for exhibitor booth packages. Collects billing, ops, SRA directory profile, and Swiss Robotics Map listing.',
    category: 'legal',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE 7 — Exhibitor Staff Pass
// ═══════════════════════════════════════════════════════════════

function template7_ExhibitorStaffPass(): { name: string; description: string; category: string; fields: FormSchemaDefinition } {
  const sections: FormSection[] = [
    section('personal', { en: 'Personal Information', de: 'Persönliche Angaben', fr: 'Informations personnelles', it: 'Informazioni personali', 'zh-TW': '個人資料' }, 0),
    section('exhibitor_assignment', { en: 'Exhibitor Assignment', de: 'Ausstellerzuordnung', fr: 'Affectation exposant', it: 'Assegnazione espositore', 'zh-TW': '展商指派' }, 1),
    section('legal_consents', { en: 'Legal Consents', de: 'Rechtliche Einwilligungen', fr: 'Consentements légaux', it: 'Consensi legali', 'zh-TW': '法律同意' }, 2),
  ];

  const fields: FormField[] = [
    ...personalSection(0),
    // Exhibitor assignment (lightweight)
    f('exhibitor_staff_company', 'text', { en: 'Exhibiting Company', de: 'Ausstellende Firma', fr: 'Entreprise exposante', it: 'Azienda espositrice', 'zh-TW': '展出公司' }, 'exhibitor_assignment', 0, {
      required: true,
      helpText: { en: 'Pre-filled by the exhibitor admin.', de: 'Vom Aussteller-Admin vorausgefüllt.', fr: 'Pré-rempli par l\'admin exposant.', it: 'Pre-compilato dall\'admin espositore.', 'zh-TW': '由展商管理員預填。' },
    }),
    f('exhibitor_booth_role', 'select', { en: 'Booth Role', de: 'Rolle am Stand', fr: 'Rôle au stand', it: 'Ruolo allo stand', 'zh-TW': '展位角色' }, 'exhibitor_assignment', 1, {
      options: [
        { value: 'booth_manager', label: { en: 'Booth Manager', de: 'Standleiter/in', fr: 'Responsable du stand', it: 'Responsabile stand', 'zh-TW': '展位經理' } },
        { value: 'sales', label: { en: 'Sales', de: 'Vertrieb', fr: 'Ventes', it: 'Vendite', 'zh-TW': '業務' } },
        { value: 'technical_demo', label: { en: 'Technical Demo', de: 'Technische Demo', fr: 'Démo technique', it: 'Demo tecnica', 'zh-TW': '技術展示' } },
        { value: 'logistics', label: { en: 'Logistics', de: 'Logistik', fr: 'Logistique', it: 'Logistica', 'zh-TW': '物流' } },
        { value: 'other', label: { en: 'Other', de: 'Andere', fr: 'Autre', it: 'Altro', 'zh-TW': '其他' } },
      ],
    }),
    f('exhibitor_setup_access', 'checkbox', { en: 'Setup/teardown access needed', de: 'Auf-/Abbau-Zugang benötigt', fr: 'Accès montage/démontage nécessaire', it: 'Accesso allestimento necessario', 'zh-TW': '需要搭建/拆卸通行權限' }, 'exhibitor_assignment', 2),
    ...legalConsentsSection(0),
  ];

  return {
    name: 'SRD26 — Exhibitor Staff Pass',
    description: 'Lightweight per-person form for exhibitor staff passes. Issued from booth package allocation.',
    category: 'general',
    fields: { fields, sections },
  };
}

// ═══════════════════════════════════════════════════════════════
//  PUBLIC API — used by FormTemplatesService.seedTemplatesForOrg()
// ═══════════════════════════════════════════════════════════════

export interface SeedTemplate {
  name: string;
  description: string;
  category: string;
  fields: FormSchemaDefinition;
}

/**
 * Return all 7 SRD26 pre-made form templates.
 */
export function getSRD26TemplateSeedData(): SeedTemplate[] {
  return [
    template1_IndustryGovParticipant(),
    template2_StartupParticipant(),
    template3_AcademiaParticipant(),
    template4_ReducedParticipant(),
    template5_StudentParticipant(),
    template6_ExhibitorPackage(),
    template7_ExhibitorStaffPass(),
  ];
}
