// Interface language dictionary. Covers UI chrome (buttons, labels,
// placeholders) — NOT chat message content, which uses the separate
// per-message translation dropdown (targetLangSelect) in app.js.
const I18N = {
  en: {
    groupsTitle: 'Groups', directoryTitle: 'User Directory', searchGroups: 'Search groups...', searchUsers: 'Search users...',
    pinnedMessages: 'Pinned Messages', dropToUpload: 'Drop file to upload', cancel: 'Cancel', deleteSelected: 'Delete Selected',
    txFormAvailable: 'A Transaction Form is available for this group.', fillForm: 'Fill Form',
    roleBuyer: 'Role: Buyer (Party A)', roleSeller: 'Role: Seller (Party B)', writeMessage: 'Write or speak message...',
    adminPanel: 'Admin Command Panel', dashboard: 'Dashboard', controls: 'Controls', transactions: 'Transactions',
    liveDraft: 'LIVE SPECTATOR DRAFT', privateNotes: 'PRIVATE OFFICER NOTES', roomManagement: 'ACTIVE ROOM MANAGEMENT',
    newGroup: 'New Group', deleteGroup: 'Delete Active Group', inviteLink: 'Clean Invite Link', toggleHighlight: 'Toggle Group Highlight',
    permissions: 'PARTY RENAMING & PERMISSIONS', renameBuyer: 'Rename Buyer (A)', renameSeller: 'Rename Seller (B)',
    toggleUploads: 'Toggle File Upload Switch', directMessage: 'DIRECT MESSAGE USER', sendDM: 'Direct Message',
    txBoard: 'TRANSACTION BOARD (ACTIVE GROUP)', txToggle: 'Enable/Disable Form', viewSubmissions: 'View Submissions',
    exportCsv: 'Export CSV', reply: 'Reply', forward: 'Forward', react: 'React', pin: 'Pin', edit: 'Edit',
    editHistory: 'Edit History', select: 'Select', delete: 'Delete', forwardTo: 'Forward to group',
    dmChannel: 'Direct Message Channel', typeReply: 'Type direct reply...', txFormTitle: 'Transaction Information Form',
    fullLegalName: 'Full Legal Name', countryRegion: 'Country / Region', txRole: 'Transaction Role', assetType: 'Asset or Item Type',
    assetDescription: 'Asset Description', quantity: 'Quantity / Amount', unitPrice: 'Agreed Unit Price', totalValue: 'Total Transaction Value',
    paymentCurrency: 'Payment Currency', paymentMethod: 'Payment Method', paymentTerms: 'Payment Terms', additionalNotes: 'Additional Notes',
    submitForm: 'Submit Transaction', editHistoryTitle: 'Message Edit History', translate: 'Translate', clearChat: 'Clear Chat History', userManagement: 'User Management', kickUser: 'Disconnect User', selectAll: 'Select All'
  },
  de: {
    groupsTitle: 'Gruppen', directoryTitle: 'Benutzerverzeichnis', searchGroups: 'Gruppen suchen...', searchUsers: 'Benutzer suchen...',
    pinnedMessages: 'Angeheftete Nachrichten', dropToUpload: 'Datei hier ablegen', cancel: 'Abbrechen', deleteSelected: 'Auswahl löschen',
    txFormAvailable: 'Für diese Gruppe ist ein Transaktionsformular verfügbar.', fillForm: 'Formular ausfüllen',
    roleBuyer: 'Rolle: Käufer (Partei A)', roleSeller: 'Rolle: Verkäufer (Partei B)', writeMessage: 'Nachricht schreiben oder sprechen...',
    adminPanel: 'Admin-Bedienfeld', dashboard: 'Übersicht', controls: 'Steuerung', transactions: 'Transaktionen',
    liveDraft: 'LIVE-ENTWURF (BEOBACHTER)', privateNotes: 'PRIVATE NOTIZEN', roomManagement: 'RAUMVERWALTUNG',
    newGroup: 'Neue Gruppe', deleteGroup: 'Aktive Gruppe löschen', inviteLink: 'Einladungslink kopieren', toggleHighlight: 'Gruppe hervorheben',
    permissions: 'UMBENENNUNG & BERECHTIGUNGEN', renameBuyer: 'Käufer umbenennen (A)', renameSeller: 'Verkäufer umbenennen (B)',
    toggleUploads: 'Datei-Uploads umschalten', directMessage: 'DIREKTNACHRICHT AN BENUTZER', sendDM: 'Direktnachricht senden',
    txBoard: 'TRANSAKTIONSÜBERSICHT (AKTIVE GRUPPE)', txToggle: 'Formular aktivieren/deaktivieren', viewSubmissions: 'Einreichungen ansehen',
    exportCsv: 'CSV exportieren', reply: 'Antworten', forward: 'Weiterleiten', react: 'Reagieren', pin: 'Anheften', edit: 'Bearbeiten',
    editHistory: 'Bearbeitungsverlauf', select: 'Auswählen', delete: 'Löschen', forwardTo: 'An Gruppe weiterleiten',
    dmChannel: 'Direktnachrichtenkanal', typeReply: 'Antwort eingeben...', txFormTitle: 'Transaktionsformular',
    fullLegalName: 'Vollständiger rechtlicher Name', countryRegion: 'Land / Region', txRole: 'Transaktionsrolle', assetType: 'Vermögenswert / Artikeltyp',
    assetDescription: 'Beschreibung des Vermögenswerts', quantity: 'Menge / Betrag', unitPrice: 'Vereinbarter Stückpreis', totalValue: 'Gesamttransaktionswert',
    paymentCurrency: 'Zahlungswährung', paymentMethod: 'Zahlungsmethode', paymentTerms: 'Zahlungsbedingungen', additionalNotes: 'Zusätzliche Hinweise',
    submitForm: 'Transaktion einreichen', editHistoryTitle: 'Bearbeitungsverlauf der Nachricht', translate: 'Übersetzen', clearChat: 'Chatverlauf löschen', userManagement: 'Benutzerverwaltung', kickUser: 'Benutzer trennen', selectAll: 'Alle auswählen'
  },
  it: {
    groupsTitle: 'Gruppi', directoryTitle: 'Rubrica utenti', searchGroups: 'Cerca gruppi...', searchUsers: 'Cerca utenti...',
    pinnedMessages: 'Messaggi bloccati', dropToUpload: 'Trascina qui il file', cancel: 'Annulla', deleteSelected: 'Elimina selezionati',
    txFormAvailable: 'È disponibile un modulo di transazione per questo gruppo.', fillForm: 'Compila modulo',
    roleBuyer: 'Ruolo: Acquirente (Parte A)', roleSeller: 'Ruolo: Venditore (Parte B)', writeMessage: 'Scrivi o pronuncia un messaggio...',
    adminPanel: 'Pannello di controllo Admin', dashboard: 'Dashboard', controls: 'Controlli', transactions: 'Transazioni',
    liveDraft: 'BOZZA LIVE (OSSERVATORE)', privateNotes: 'NOTE PRIVATE', roomManagement: 'GESTIONE STANZA ATTIVA',
    newGroup: 'Nuovo gruppo', deleteGroup: 'Elimina gruppo attivo', inviteLink: 'Copia link invito', toggleHighlight: 'Evidenzia gruppo',
    permissions: 'RINOMINA E PERMESSI', renameBuyer: 'Rinomina Acquirente (A)', renameSeller: 'Rinomina Venditore (B)',
    toggleUploads: "Attiva/disattiva caricamento file", directMessage: 'MESSAGGIO DIRETTO ALL\'UTENTE', sendDM: 'Invia messaggio diretto',
    txBoard: 'BACHECA TRANSAZIONI (GRUPPO ATTIVO)', txToggle: 'Attiva/disattiva modulo', viewSubmissions: 'Visualizza invii',
    exportCsv: 'Esporta CSV', reply: 'Rispondi', forward: 'Inoltra', react: 'Reagisci', pin: 'Blocca', edit: 'Modifica',
    editHistory: 'Cronologia modifiche', select: 'Seleziona', delete: 'Elimina', forwardTo: 'Inoltra al gruppo',
    dmChannel: 'Canale messaggi diretti', typeReply: 'Scrivi una risposta diretta...', txFormTitle: 'Modulo informazioni transazione',
    fullLegalName: 'Nome legale completo', countryRegion: 'Paese / Regione', txRole: 'Ruolo nella transazione', assetType: 'Tipo di bene/articolo',
    assetDescription: 'Descrizione del bene', quantity: 'Quantità / Importo', unitPrice: 'Prezzo unitario concordato', totalValue: 'Valore totale della transazione',
    paymentCurrency: 'Valuta di pagamento', paymentMethod: 'Metodo di pagamento', paymentTerms: 'Termini di pagamento', additionalNotes: 'Note aggiuntive',
    submitForm: 'Invia transazione', editHistoryTitle: 'Cronologia modifiche del messaggio', translate: 'Traduci', clearChat: 'Cancella cronologia chat', userManagement: 'Gestione utenti', kickUser: 'Disconnetti utente', selectAll: 'Seleziona tutto'
  },
  tr: {
    groupsTitle: 'Gruplar', directoryTitle: 'Kullanıcı Rehberi', searchGroups: 'Gruplarda ara...', searchUsers: 'Kullanıcılarda ara...',
    pinnedMessages: 'Sabitlenmiş Mesajlar', dropToUpload: 'Yüklemek için dosyayı bırakın', cancel: 'İptal', deleteSelected: 'Seçilenleri Sil',
    txFormAvailable: 'Bu grup için bir İşlem Formu mevcut.', fillForm: 'Formu Doldur',
    roleBuyer: 'Rol: Alıcı (Taraf A)', roleSeller: 'Rol: Satıcı (Taraf B)', writeMessage: 'Mesaj yazın veya söyleyin...',
    adminPanel: 'Yönetici Kontrol Paneli', dashboard: 'Gösterge Paneli', controls: 'Kontroller', transactions: 'İşlemler',
    liveDraft: 'CANLI TASLAK İZLEME', privateNotes: 'ÖZEL YETKİLİ NOTLARI', roomManagement: 'AKTİF ODA YÖNETİMİ',
    newGroup: 'Yeni Grup', deleteGroup: 'Aktif Grubu Sil', inviteLink: 'Davet Bağlantısını Kopyala', toggleHighlight: 'Grubu Vurgula',
    permissions: 'TARAF YENİDEN ADLANDIRMA VE İZİNLER', renameBuyer: 'Alıcıyı Yeniden Adlandır (A)', renameSeller: 'Satıcıyı Yeniden Adlandır (B)',
    toggleUploads: 'Dosya Yükleme Anahtarını Aç/Kapat', directMessage: 'KULLANICIYA DOĞRUDAN MESAJ', sendDM: 'Doğrudan Mesaj Gönder',
    txBoard: 'İŞLEM PANOSU (AKTİF GRUP)', txToggle: 'Formu Etkinleştir/Devre Dışı Bırak', viewSubmissions: 'Gönderileri Görüntüle',
    exportCsv: "CSV'ye Aktar", reply: 'Yanıtla', forward: 'İlet', react: 'Tepki Ver', pin: 'Sabitle', edit: 'Düzenle',
    editHistory: 'Düzenleme Geçmişi', select: 'Seç', delete: 'Sil', forwardTo: 'Gruba ilet',
    dmChannel: 'Doğrudan Mesaj Kanalı', typeReply: 'Doğrudan yanıt yazın...', txFormTitle: 'İşlem Bilgi Formu',
    fullLegalName: 'Tam Yasal Ad', countryRegion: 'Ülke / Bölge', txRole: 'İşlem Rolü', assetType: 'Varlık veya Ürün Türü',
    assetDescription: 'Varlık Açıklaması', quantity: 'Miktar / Tutar', unitPrice: 'Anlaşılan Birim Fiyat', totalValue: 'Toplam İşlem Değeri',
    paymentCurrency: 'Ödeme Para Birimi', paymentMethod: 'Ödeme Yöntemi', paymentTerms: 'Ödeme Koşulları', additionalNotes: 'Ek Notlar',
    submitForm: 'İşlemi Gönder', editHistoryTitle: 'Mesaj Düzenleme Geçmişi', translate: 'Çevir', clearChat: 'Sohbet Geçmişini Temizle', userManagement: 'Kullanıcı Yönetimi', kickUser: 'Kullanıcıyı Bağlantısını Kes', selectAll: 'Tümünü Seç'
  }
};

function applyI18n(lang) {
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) el.setAttribute('placeholder', dict[key]);
  });
  localStorage.setItem('q_ui_lang', lang);
}
