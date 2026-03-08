/**
 * SRAtix Client — Embed Widget Translations
 *
 * Loaded by sratix-embed.js. Provides t() translation function
 * for all user-facing strings in the ticket purchase & registration flow.
 *
 * Supported locales: en (default), fr, de, it, zh-TW
 */
/* exported sratixI18n */
const sratixI18n = (function () {
  'use strict';

  const translations = {
    en: {
      // Ticket cards
      'tickets.noTickets':       'No tickets available at this time.',
      'tickets.loadError':       'Unable to load tickets. Please try again later.',
      'tickets.free':            'Free',
      'tickets.remaining':       '{n} remaining',
      'tickets.soldOut':         'Sold Out',
      'tickets.earlyBird':       'Early Bird',
      'tickets.select':          'Select',

      // Quantity modal
      'qty.title':               '{name}',
      'qty.quantity':            'Quantity',
      'qty.decrease':            'Decrease',
      'qty.increase':            'Increase',
      'qty.promoLabel':          'Promo code',
      'qty.promoOptional':       '(optional)',
      'qty.promoPlaceholder':    'Enter code',
      'qty.promoApply':          'Apply',
      'qty.promoValidating':     'Validating…',
      'qty.promoApplied':        '✓ Code applied — {amount} off',
      'qty.promoInvalid':        'Invalid promo code',
      'qty.promoError':          'Could not validate code. Try again.',
      'qty.cancel':              'Cancel',
      'qty.continue':            'Continue →',
      'qty.rangeError':          'Please select between 1 and {max} ticket(s).',
      'qty.total':               'total',
      'qty.afterDiscount':       '(after discount)',
      'qty.priceDisplay':        '{price} total',
      'qty.priceDiscounted':     '<s>{original}</s> → <strong>{final}</strong> (after discount)',

      // Registration modal
      'reg.title':               'Registration Details',
      'reg.firstName':           'First name',
      'reg.lastName':            'Last name',
      'reg.email':               'Email address',
      'reg.phone':               'Phone',
      'reg.organization':        'Organization',
      'reg.nameRequired':        'First and last name are required.',
      'reg.emailInvalid':        'Please enter a valid email address.',
      'reg.pleaseWait':          'Please wait…',
      'reg.genericError':        'An error occurred. Please try again.',
      'reg.completeRegistration':'Complete Registration',
      'reg.continueToPayment':   'Continue to Payment →',
      'reg.back':                '← Back',

      // Dynamic form fields
      'reg.form.selectPlaceholder': 'Select…',
      'reg.form.yes':              'Yes',
      'reg.form.no':               'No',
      'reg.form.fieldRequired':    '{field} is required.',

      // Shared / modal
      'modal.close':             'Close',

      // Success banner
      'success.title':           'Registration complete!',
      'success.order':           'Order #{number}',
      'success.checkEmail':      'Check your email for your ticket confirmation.',
      'success.dismiss':         'Dismiss',
      'success.testTitle':       'TEST MODE — Registration complete!',
      'success.testDone':        'Tickets issued & emails sent. The following SRA-side actions were simulated (not executed):',
      'success.testLoading':     'Loading simulated actions…',
      'success.testNoActions':   'No simulated actions to display.',
      'success.testActionsHeading': 'Simulated SRA actions (skipped in test mode):',
      'success.testLoadError':   'Could not load simulated actions.',

      // My Tickets
      'myTickets.login':         'Please log in to view your tickets.',
      'myTickets.loading':       'Loading your tickets…',
      'myTickets.empty':         'You have no tickets for this event yet.',
      'myTickets.loadError':     'Unable to load your tickets. Please try again later.',
      'myTickets.ticket':        'Ticket',

      // Schedule
      'schedule.comingSoon':     'Event schedule will be published soon.',

      // Member gate
      'memberGate.title':          'Are you a member?',
      'memberGate.subtitle':       'Members may be eligible for discounted tickets and exclusive perks.',
      'memberGate.sraLabel':       'Swiss Robotics Association',
      'memberGate.robotxLabel':    'ETH RobotX',
      'memberGate.regularLabel':   'Continue without membership →',
      'memberGate.back':           'Back',
      'memberGate.sraLoginTitle':  'SRA Member Login',
      'memberGate.sraLoginHint':   'Sign in with your swiss-robotics.org account.',
      'memberGate.password':       'Password',
      'memberGate.sraSubmit':      'Sign In',
      'memberGate.sraFieldsRequired': 'Email and password are required.',
      'memberGate.sraInvalid':     'Invalid credentials. Please use your swiss-robotics.org login.',
      'memberGate.sraError':       'Authentication failed. Please try again.',
      'memberGate.robotxTitle':    'RobotX Member Access',
      'memberGate.robotxHint':     'Enter the access code provided by ETH RobotX.',
      'memberGate.robotxCodeLabel':'Access code',
      'memberGate.robotxSubmit':   'Verify Code',
      'memberGate.robotxFieldRequired': 'Please enter your access code.',
      'memberGate.robotxInvalid':  'Invalid code. Please contact RobotX for your access code.',
      'memberGate.robotxError':    'Verification failed. Please try again.',
      'memberGate.welcomeSra':     'Welcome, {name}! Your {tier} membership discount has been applied.',
      'memberGate.welcomeRobotx':  'RobotX member discount applied.',
      'memberGate.welcomeGreeting': 'Welcome, {name}!',
      'memberGate.welcomeRobotxGreeting': 'RobotX member verified.',
      'memberGate.welcomeTier':    'Membership: {tier}',
      'memberGate.welcomeDisclaimer': 'If a larger discount (e.g. early bird) is active, it will be applied instead.',
      'memberGate.changeType':     'Switch membership ↻',
      'memberGate.backToMembership': '← Are you a member? Sign in for discounts',
    },

    fr: {
      'tickets.noTickets':       'Aucun billet disponible pour le moment.',
      'tickets.loadError':       'Impossible de charger les billets. Veuillez réessayer.',
      'tickets.free':            'Gratuit',
      'tickets.remaining':       '{n} restant(s)',
      'tickets.soldOut':         'Épuisé',
      'tickets.earlyBird':       'Tarif réduit',
      'tickets.select':          'Sélectionner',

      'qty.quantity':            'Quantité',
      'qty.decrease':            'Diminuer',
      'qty.increase':            'Augmenter',
      'qty.promoLabel':          'Code promo',
      'qty.promoOptional':       '(facultatif)',
      'qty.promoPlaceholder':    'Entrer le code',
      'qty.promoApply':          'Appliquer',
      'qty.promoValidating':     'Validation…',
      'qty.promoApplied':        '✓ Code appliqué — {amount} de réduction',
      'qty.promoInvalid':        'Code promo invalide',
      'qty.promoError':          'Impossible de valider le code. Réessayez.',
      'qty.cancel':              'Annuler',
      'qty.continue':            'Continuer →',
      'qty.rangeError':          'Veuillez sélectionner entre 1 et {max} billet(s).',
      'qty.total':               'total',
      'qty.afterDiscount':       '(après réduction)',
      'qty.priceDisplay':        '{price} au total',
      'qty.priceDiscounted':     '<s>{original}</s> → <strong>{final}</strong> (après réduction)',

      'reg.title':               'Détails d\'inscription',
      'reg.firstName':           'Prénom',
      'reg.lastName':            'Nom',
      'reg.email':               'Adresse e-mail',
      'reg.phone':               'Téléphone',
      'reg.organization':        'Organisation',
      'reg.nameRequired':        'Le prénom et le nom sont obligatoires.',
      'reg.emailInvalid':        'Veuillez entrer une adresse e-mail valide.',
      'reg.pleaseWait':          'Veuillez patienter…',
      'reg.genericError':        'Une erreur est survenue. Veuillez réessayer.',
      'reg.completeRegistration':'Finaliser l\'inscription',
      'reg.continueToPayment':   'Continuer vers le paiement →',
      'reg.back':                '← Retour',

      'reg.form.selectPlaceholder': 'Sélectionner…',
      'reg.form.yes':              'Oui',
      'reg.form.no':               'Non',
      'reg.form.fieldRequired':    '{field} est obligatoire.',

      'modal.close':             'Fermer',

      'success.title':           'Inscription réussie !',
      'success.order':           'Commande n°{number}',
      'success.checkEmail':      'Vérifiez votre e-mail pour la confirmation du billet.',
      'success.dismiss':         'Fermer',
      'success.testTitle':       'MODE TEST — Inscription réussie !',
      'success.testDone':        'Billets émis et e-mails envoyés. Les actions SRA suivantes ont été simulées (non exécutées) :',
      'success.testLoading':     'Chargement des actions simulées…',
      'success.testNoActions':   'Aucune action simulée à afficher.',
      'success.testActionsHeading': 'Actions SRA simulées (ignorées en mode test) :',
      'success.testLoadError':   'Impossible de charger les actions simulées.',

      'myTickets.login':         'Veuillez vous connecter pour voir vos billets.',
      'myTickets.loading':       'Chargement de vos billets…',
      'myTickets.empty':         'Vous n\'avez pas encore de billets pour cet événement.',
      'myTickets.loadError':     'Impossible de charger vos billets. Veuillez réessayer.',
      'myTickets.ticket':        'Billet',

      'schedule.comingSoon':     'Le programme sera publié prochainement.',

      'memberGate.title':          'Êtes-vous membre ?',
      'memberGate.subtitle':       'Les membres peuvent bénéficier de tarifs réduits et d’avantages exclusifs.',
      'memberGate.sraLabel':       'Swiss Robotics Association',
      'memberGate.robotxLabel':    'ETH RobotX',
      'memberGate.regularLabel':   'Continuer sans adhésion →',
      'memberGate.back':           'Retour',
      'memberGate.sraLoginTitle':  'Connexion membre SRA',
      'memberGate.sraLoginHint':   'Connectez-vous avec votre compte swiss-robotics.org.',
      'memberGate.password':       'Mot de passe',
      'memberGate.sraSubmit':      'Se connecter',
      'memberGate.sraFieldsRequired': 'L\'e-mail et le mot de passe sont requis.',
      'memberGate.sraInvalid':     'Identifiants invalides. Utilisez votre compte swiss-robotics.org.',
      'memberGate.sraError':       'Échec de l\'authentification. Veuillez réessayer.',
      'memberGate.robotxTitle':    'Accès membre RobotX',
      'memberGate.robotxHint':     'Entrez le code d\'accès fourni par ETH RobotX.',
      'memberGate.robotxCodeLabel':'Code d\'accès',
      'memberGate.robotxSubmit':   'Vérifier le code',
      'memberGate.robotxFieldRequired': 'Veuillez entrer votre code d\'accès.',
      'memberGate.robotxInvalid':  'Code invalide. Contactez RobotX pour obtenir votre code.',
      'memberGate.robotxError':    'Échec de la vérification. Veuillez réessayer.',
      'memberGate.welcomeSra':     'Bienvenue, {name} ! Votre réduction membre {tier} a été appliquée.',
      'memberGate.welcomeRobotx':  'Réduction membre RobotX appliquée.',
      'memberGate.welcomeGreeting': 'Bienvenue, {name} !',
      'memberGate.welcomeRobotxGreeting': 'Membre RobotX vérifié.',
      'memberGate.welcomeTier':    'Adhésion : {tier}',
      'memberGate.welcomeDisclaimer': 'Si une réduction plus importante (ex. tarif anticipé) est active, elle sera appliquée.',
      'memberGate.changeType':     'Changer d\u2019adh\u00e9sion \u21bb',
      'memberGate.backToMembership': '← Vous êtes membre ? Connectez-vous pour bénéficier de réductions',
    },

    de: {
      'tickets.noTickets':       'Zurzeit sind keine Tickets verfügbar.',
      'tickets.loadError':       'Tickets konnten nicht geladen werden. Bitte versuchen Sie es erneut.',
      'tickets.free':            'Kostenlos',
      'tickets.remaining':       '{n} verfügbar',
      'tickets.soldOut':         'Ausverkauft',
      'tickets.earlyBird':       'Frühbucher',
      'tickets.select':          'Auswählen',

      'qty.quantity':            'Anzahl',
      'qty.decrease':            'Verringern',
      'qty.increase':            'Erhöhen',
      'qty.promoLabel':          'Aktionscode',
      'qty.promoOptional':       '(optional)',
      'qty.promoPlaceholder':    'Code eingeben',
      'qty.promoApply':          'Anwenden',
      'qty.promoValidating':     'Wird überprüft…',
      'qty.promoApplied':        '✓ Code angewendet — {amount} Rabatt',
      'qty.promoInvalid':        'Ungültiger Aktionscode',
      'qty.promoError':          'Code konnte nicht überprüft werden. Erneut versuchen.',
      'qty.cancel':              'Abbrechen',
      'qty.continue':            'Weiter →',
      'qty.rangeError':          'Bitte wählen Sie zwischen 1 und {max} Ticket(s).',
      'qty.total':               'gesamt',
      'qty.afterDiscount':       '(nach Rabatt)',
      'qty.priceDisplay':        '{price} gesamt',
      'qty.priceDiscounted':     '<s>{original}</s> → <strong>{final}</strong> (nach Rabatt)',

      'reg.title':               'Anmeldedaten',
      'reg.firstName':           'Vorname',
      'reg.lastName':            'Nachname',
      'reg.email':               'E-Mail-Adresse',
      'reg.phone':               'Telefon',
      'reg.organization':        'Organisation',
      'reg.nameRequired':        'Vor- und Nachname sind erforderlich.',
      'reg.emailInvalid':        'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      'reg.pleaseWait':          'Bitte warten…',
      'reg.genericError':        'Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.',
      'reg.completeRegistration':'Anmeldung abschliessen',
      'reg.continueToPayment':   'Weiter zur Zahlung →',
      'reg.back':                '← Zurück',

      'reg.form.selectPlaceholder': 'Auswählen…',
      'reg.form.yes':              'Ja',
      'reg.form.no':               'Nein',
      'reg.form.fieldRequired':    '{field} ist erforderlich.',

      'modal.close':             'Schliessen',

      'success.title':           'Anmeldung erfolgreich!',
      'success.order':           'Bestellung Nr. {number}',
      'success.checkEmail':      'Prüfen Sie Ihr E-Mail-Postfach für die Ticketbestätigung.',
      'success.dismiss':         'Schliessen',
      'success.testTitle':       'TESTMODUS — Anmeldung erfolgreich!',
      'success.testDone':        'Tickets ausgestellt & E-Mails versendet. Die folgenden SRA-Aktionen wurden simuliert (nicht ausgeführt):',
      'success.testLoading':     'Simulierte Aktionen werden geladen…',
      'success.testNoActions':   'Keine simulierten Aktionen vorhanden.',
      'success.testActionsHeading': 'Simulierte SRA-Aktionen (im Testmodus übersprungen):',
      'success.testLoadError':   'Simulierte Aktionen konnten nicht geladen werden.',

      'myTickets.login':         'Bitte melden Sie sich an, um Ihre Tickets anzuzeigen.',
      'myTickets.loading':       'Ihre Tickets werden geladen…',
      'myTickets.empty':         'Sie haben noch keine Tickets für diese Veranstaltung.',
      'myTickets.loadError':     'Ihre Tickets konnten nicht geladen werden. Bitte versuchen Sie es erneut.',
      'myTickets.ticket':        'Ticket',

      'schedule.comingSoon':     'Das Veranstaltungsprogramm wird in Kürze veröffentlicht.',

      'memberGate.title':          'Sind Sie Mitglied?',
      'memberGate.subtitle':       'Mitglieder können von ermässigten Tickets und exklusiven Vorteilen profitieren.',
      'memberGate.sraLabel':       'Swiss Robotics Association',
      'memberGate.robotxLabel':    'ETH RobotX',
      'memberGate.regularLabel':   'Ohne Mitgliedschaft fortfahren →',
      'memberGate.back':           'Zurück',
      'memberGate.sraLoginTitle':  'SRA-Mitglieder-Login',
      'memberGate.sraLoginHint':   'Melden Sie sich mit Ihrem swiss-robotics.org-Konto an.',
      'memberGate.password':       'Passwort',
      'memberGate.sraSubmit':      'Anmelden',
      'memberGate.sraFieldsRequired': 'E-Mail und Passwort sind erforderlich.',
      'memberGate.sraInvalid':     'Ungültige Anmeldedaten. Verwenden Sie Ihr swiss-robotics.org-Konto.',
      'memberGate.sraError':       'Authentifizierung fehlgeschlagen. Bitte versuchen Sie es erneut.',
      'memberGate.robotxTitle':    'RobotX-Mitglieder-Zugang',
      'memberGate.robotxHint':     'Geben Sie den Zugangscode von ETH RobotX ein.',
      'memberGate.robotxCodeLabel':'Zugangscode',
      'memberGate.robotxSubmit':   'Code überprüfen',
      'memberGate.robotxFieldRequired': 'Bitte geben Sie Ihren Zugangscode ein.',
      'memberGate.robotxInvalid':  'Ungültiger Code. Kontaktieren Sie RobotX für Ihren Zugangscode.',
      'memberGate.robotxError':    'Überprüfung fehlgeschlagen. Bitte versuchen Sie es erneut.',
      'memberGate.welcomeSra':     'Willkommen, {name}! Ihr {tier}-Mitgliederrabatt wurde angewendet.',
      'memberGate.welcomeRobotx':  'RobotX-Mitgliederrabatt angewendet.',
      'memberGate.welcomeGreeting': 'Willkommen, {name}!',
      'memberGate.welcomeRobotxGreeting': 'RobotX-Mitglied bestätigt.',
      'memberGate.welcomeTier':    'Mitgliedschaft: {tier}',
      'memberGate.welcomeDisclaimer': 'Falls ein grösserer Rabatt (z.B. Frühbucher) aktiv ist, wird dieser stattdessen angewendet.',
      'memberGate.changeType':     'Mitgliedschaft wechseln \u21bb',
      'memberGate.backToMembership': '← Mitglied? Anmelden für Rabatte',
    },

    it: {
      'tickets.noTickets':       'Al momento non sono disponibili biglietti.',
      'tickets.loadError':       'Impossibile caricare i biglietti. Riprova più tardi.',
      'tickets.free':            'Gratuito',
      'tickets.remaining':       '{n} disponibili',
      'tickets.soldOut':         'Esaurito',
      'tickets.earlyBird':       'Tariffa anticipata',
      'tickets.select':          'Seleziona',

      'qty.quantity':            'Quantità',
      'qty.decrease':            'Diminuisci',
      'qty.increase':            'Aumenta',
      'qty.promoLabel':          'Codice promozionale',
      'qty.promoOptional':       '(facoltativo)',
      'qty.promoPlaceholder':    'Inserisci il codice',
      'qty.promoApply':          'Applica',
      'qty.promoValidating':     'Validazione…',
      'qty.promoApplied':        '✓ Codice applicato — {amount} di sconto',
      'qty.promoInvalid':        'Codice promozionale non valido',
      'qty.promoError':          'Impossibile validare il codice. Riprova.',
      'qty.cancel':              'Annulla',
      'qty.continue':            'Continua →',
      'qty.rangeError':          'Seleziona tra 1 e {max} biglietto/i.',
      'qty.total':               'totale',
      'qty.afterDiscount':       '(dopo lo sconto)',
      'qty.priceDisplay':        '{price} in totale',
      'qty.priceDiscounted':     '<s>{original}</s> → <strong>{final}</strong> (dopo lo sconto)',

      'reg.title':               'Dettagli di registrazione',
      'reg.firstName':           'Nome',
      'reg.lastName':            'Cognome',
      'reg.email':               'Indirizzo e-mail',
      'reg.phone':               'Telefono',
      'reg.organization':        'Organizzazione',
      'reg.nameRequired':        'Nome e cognome sono obbligatori.',
      'reg.emailInvalid':        'Inserisci un indirizzo e-mail valido.',
      'reg.pleaseWait':          'Attendere…',
      'reg.genericError':        'Si è verificato un errore. Riprova.',
      'reg.completeRegistration':'Completare la registrazione',
      'reg.continueToPayment':   'Continua al pagamento →',
      'reg.back':                '← Indietro',

      'reg.form.selectPlaceholder': 'Seleziona…',
      'reg.form.yes':              'Sì',
      'reg.form.no':               'No',
      'reg.form.fieldRequired':    '{field} è obbligatorio.',

      'modal.close':             'Chiudi',

      'success.title':           'Registrazione completata!',
      'success.order':           'Ordine n. {number}',
      'success.checkEmail':      'Controlla la tua e-mail per la conferma del biglietto.',
      'success.dismiss':         'Chiudi',
      'success.testTitle':       'MODALITÀ TEST — Registrazione completata!',
      'success.testDone':        'Biglietti emessi ed e-mail inviate. Le seguenti azioni SRA sono state simulate (non eseguite):',
      'success.testLoading':     'Caricamento azioni simulate…',
      'success.testNoActions':   'Nessuna azione simulata da visualizzare.',
      'success.testActionsHeading': 'Azioni SRA simulate (ignorate in modalità test):',
      'success.testLoadError':   'Impossibile caricare le azioni simulate.',

      'myTickets.login':         'Accedi per visualizzare i tuoi biglietti.',
      'myTickets.loading':       'Caricamento dei tuoi biglietti…',
      'myTickets.empty':         'Non hai ancora biglietti per questo evento.',
      'myTickets.loadError':     'Impossibile caricare i tuoi biglietti. Riprova più tardi.',
      'myTickets.ticket':        'Biglietto',

      'schedule.comingSoon':     'Il programma dell\'evento sarà pubblicato a breve.',

      'memberGate.title':          'Sei un membro?',
      'memberGate.subtitle':       'I membri possono beneficiare di biglietti scontati e vantaggi esclusivi.',
      'memberGate.sraLabel':       'Swiss Robotics Association',
      'memberGate.robotxLabel':    'ETH RobotX',
      'memberGate.regularLabel':   'Continua senza iscrizione →',
      'memberGate.back':           'Indietro',
      'memberGate.sraLoginTitle':  'Accesso membro SRA',
      'memberGate.sraLoginHint':   'Accedi con il tuo account swiss-robotics.org.',
      'memberGate.password':       'Password',
      'memberGate.sraSubmit':      'Accedi',
      'memberGate.sraFieldsRequired': 'Email e password sono obbligatori.',
      'memberGate.sraInvalid':     'Credenziali non valide. Usa il tuo account swiss-robotics.org.',
      'memberGate.sraError':       'Autenticazione fallita. Riprova.',
      'memberGate.robotxTitle':    'Accesso membro RobotX',
      'memberGate.robotxHint':     'Inserisci il codice di accesso fornito da ETH RobotX.',
      'memberGate.robotxCodeLabel':'Codice di accesso',
      'memberGate.robotxSubmit':   'Verifica codice',
      'memberGate.robotxFieldRequired': 'Inserisci il tuo codice di accesso.',
      'memberGate.robotxInvalid':  'Codice non valido. Contatta RobotX per il tuo codice.',
      'memberGate.robotxError':    'Verifica fallita. Riprova.',
      'memberGate.welcomeSra':     'Benvenuto, {name}! Lo sconto membro {tier} è stato applicato.',
      'memberGate.welcomeRobotx':  'Sconto membro RobotX applicato.',
      'memberGate.welcomeGreeting': 'Benvenuto, {name}!',
      'memberGate.welcomeRobotxGreeting': 'Membro RobotX verificato.',
      'memberGate.welcomeTier':    'Iscrizione: {tier}',
      'memberGate.welcomeDisclaimer': 'Se è attivo uno sconto maggiore (es. tariffa anticipata), verrà applicato quello.',
      'memberGate.changeType':     'Cambia iscrizione \u21bb',
    },

    'zh-TW': {
      'tickets.noTickets':       '目前暫無可購買的票券。',
      'tickets.loadError':       '無法載入票券，請稍後再試。',
      'tickets.free':            '免費',
      'tickets.remaining':       '剩餘 {n} 張',
      'tickets.soldOut':         '已售罄',
      'tickets.earlyBird':       '早鳥優惠',
      'tickets.select':          '選擇',

      'qty.quantity':            '數量',
      'qty.decrease':            '減少',
      'qty.increase':            '增加',
      'qty.promoLabel':          '優惠代碼',
      'qty.promoOptional':       '（選填）',
      'qty.promoPlaceholder':    '輸入代碼',
      'qty.promoApply':          '套用',
      'qty.promoValidating':     '驗證中…',
      'qty.promoApplied':        '✓ 代碼已套用 — 折扣 {amount}',
      'qty.promoInvalid':        '無效的優惠代碼',
      'qty.promoError':          '無法驗證代碼，請重試。',
      'qty.cancel':              '取消',
      'qty.continue':            '繼續 →',
      'qty.rangeError':          '請選擇 1 至 {max} 張票券。',
      'qty.total':               '合計',
      'qty.afterDiscount':       '（折扣後）',
      'qty.priceDisplay':        '{price} 合計',
      'qty.priceDiscounted':     '<s>{original}</s> → <strong>{final}</strong>（折扣後）',

      'reg.title':               '報名資料',
      'reg.firstName':           '名字',
      'reg.lastName':            '姓氏',
      'reg.email':               '電子信箱',
      'reg.phone':               '電話',
      'reg.organization':        '單位/公司',
      'reg.nameRequired':        '名字和姓氏為必填。',
      'reg.emailInvalid':        '請輸入有效的電子信箱。',
      'reg.pleaseWait':          '請稍候…',
      'reg.genericError':        '發生錯誤，請重試。',
      'reg.completeRegistration':'完成報名',
      'reg.continueToPayment':   '前往付款 →',
      'reg.back':                '← 返回',

      'reg.form.selectPlaceholder': '請選擇…',
      'reg.form.yes':              '是',
      'reg.form.no':               '否',
      'reg.form.fieldRequired':    '{field} 為必填。',

      'modal.close':             '關閉',

      'success.title':           '報名完成！',
      'success.order':           '訂單 #{number}',
      'success.checkEmail':      '請查收電子信箱以確認票券。',
      'success.dismiss':         '關閉',
      'success.testTitle':       '測試模式 — 報名完成！',
      'success.testDone':        '票券已發出、電子郵件已寄送。以下 SRA 操作僅為模擬（未實際執行）：',
      'success.testLoading':     '正在載入模擬操作…',
      'success.testNoActions':   '無模擬操作可顯示。',
      'success.testActionsHeading': '模擬的 SRA 操作（測試模式下已跳過）：',
      'success.testLoadError':   '無法載入模擬操作。',

      'myTickets.login':         '請登入以查看您的票券。',
      'myTickets.loading':       '正在載入您的票券…',
      'myTickets.empty':         '您尚未擁有此活動的票券。',
      'myTickets.loadError':     '無法載入您的票券，請稍後再試。',
      'myTickets.ticket':        '票券',

      'schedule.comingSoon':     '活動議程即將公布。',

      'memberGate.title':          '您是會員嗎？',
      'memberGate.subtitle':       '會員可享有折扣票價及專屬福利。',
      'memberGate.sraLabel':       'Swiss Robotics Association',
      'memberGate.robotxLabel':    'ETH RobotX',
      'memberGate.regularLabel':   '以非會員身份繼續 →',
      'memberGate.back':           '返回',
      'memberGate.sraLoginTitle':  'SRA 會員登入',
      'memberGate.sraLoginHint':   '使用您的 swiss-robotics.org 帳號登入。',
      'memberGate.password':       '密碼',
      'memberGate.sraSubmit':      '登入',
      'memberGate.sraFieldsRequired': '電子郵件和密碼為必填項。',
      'memberGate.sraInvalid':     '憑證無效。請使用您的 swiss-robotics.org 帳號。',
      'memberGate.sraError':       '驗證失敗，請重試。',
      'memberGate.robotxTitle':    'RobotX 會員驗證',
      'memberGate.robotxHint':     '請輸入 ETH RobotX 提供的存取碼。',
      'memberGate.robotxCodeLabel':'存取碼',
      'memberGate.robotxSubmit':   '驗證碼',
      'memberGate.robotxFieldRequired': '請輸入您的存取碼。',
      'memberGate.robotxInvalid':  '無效的存取碼。請聯繫 RobotX 取得您的存取碼。',
      'memberGate.robotxError':    '驗證失敗，請重試。',
      'memberGate.welcomeSra':     '歡迎，{name}！您的 {tier} 會員折扣已套用。',
      'memberGate.welcomeRobotx':  'RobotX 會員折扣已套用。',
      'memberGate.welcomeGreeting': '歡迎，{name}！',
      'memberGate.welcomeRobotxGreeting': 'RobotX 會員已驗證。',
      'memberGate.welcomeTier':    '會員類型：{tier}',
      'memberGate.welcomeDisclaimer': '若有更大的折扣（如早鳥優惠）正在進行，則會套用較大的折扣。',
      'memberGate.changeType':     '切換會員 ↻',
      'memberGate.backToMembership': '← 是會員嗎？登入享折扣',
    },
  };

  /**
   * Resolve locale — uses sratixConfig.locale or auto-detects from <html lang>.
   * @returns {string} One of: en, fr, de, it, zh-TW
   */
  function resolveLocale() {
    const cfg = (window.sratixConfig || {}).locale;
    if (cfg && translations[cfg]) return cfg;

    // Auto-detect from <html lang="...">
    const htmlLang = document.documentElement.lang || '';
    if (htmlLang.startsWith('zh') && (htmlLang.includes('TW') || htmlLang.includes('Hant'))) {
      return 'zh-TW';
    }
    const prefix = htmlLang.substring(0, 2).toLowerCase();
    if (translations[prefix]) return prefix;

    return 'en';
  }

  // Lazy‐resolved so the locale is read on first t() call,
  // after wp_localize_script has injected sratixConfig.
  let _locale = null;

  function getLocale() {
    if (_locale === null) {
      _locale = resolveLocale();
    }
    return _locale;
  }

  /**
   * Translate a key, with optional {var} interpolation.
   * Falls back to English if key missing in current locale.
   *
   * @param {string} key  Translation key (e.g. 'reg.firstName')
   * @param {Object} [vars]  Interpolation map (e.g. { n: 5, max: 10 })
   * @returns {string}
   */
  function t(key, vars) {
    const locale = getLocale();
    const dict = translations[locale] || translations.en;
    let str = dict[key] ?? translations.en[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
      });
    }
    return str;
  }

  return { t, getLocale, translations };
})();
