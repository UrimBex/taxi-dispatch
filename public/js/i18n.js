/* Interface language: Albanian (default), English, and Serbian for the rider/client side only.
   Browser-only — NOT loaded by the server-side simulation (see AGENTS.md): the engine keeps generating its
   alert/log/timeline/SMS text in English, and tx() below translates those strings at display time instead,
   so stored data and the server never depend on the viewer's language.
   Dictionary entries are [sq, en, sr]. Anything the ops room alone ever shows may leave sr out. */
(function (RO) {
  'use strict';
  const IDX = { sq: 0, en: 1, sr: 2 }, NAMES = { sq: 'Shqip', en: 'English', sr: 'Srpski' }, SHORT = { sq: 'SQ', en: 'EN', sr: 'SR' };
  const SPEECH = { sq: 'sq-AL', en: 'en-US', sr: 'sr-RS' };
  let pref = 'sq', ctx = { role: 'client', login: true };
  try { const v = localStorage.getItem('ro.lang'); if (v in IDX) pref = v; } catch (e) { }
  const subs = [];

  const D = {
    /* ---------- page chrome / sign-in ---------- */
    'app.title': ['Taxi Ardi · Automatizim i dispeçimit të taksive', 'Taxi Ardi · Taxi Dispatch Automation', 'Taxi Ardi · Automatizovani dispečing taksija'],
    'hdr.tagline': ['Automatizim i dispeçimit të taksive · Prishtinë · Obiliq · Fushë Kosovë', 'Taxi dispatch automation · Prishtina · Obiliq · Fushë Kosovë', 'Automatizovani dispečing taksija · Priština · Obilić · Kosovo Polje'],
    'hdr.reset': ['↺ Rivendos', '↺ Reset', '↺ Resetuj'],
    'hdr.resetConfirm': ['Të rivendoset gjendja e dispeçimit të kësaj kompanie (shoferët, rezervimet, thirrjet)? Llogaritë e pasagjerëve ruhen.', "Reset this company's dispatch state (drivers, bookings, calls)? Rider accounts are kept."],
    'hdr.signout': ['Dil', 'Sign out', 'Odjavi se'],
    'hdr.lang': ['Gjuha', 'Language', 'Jezik'],
    'hdr.reconnecting': ['po rilidhet…', 'reconnecting…', 'ponovno povezivanje…'],
    'role.client': ['Klient', 'Client', 'Klijent'],
    'role.driver': ['Shofer', 'Driver', 'Vozač'],
    'role.ops': ['Dhoma operative', 'Ops room', 'Operativni centar'],
    'role.superuser': ['Administrator', 'Superuser', 'Administrator'],
    'tab.customer': ['Aplikacioni i klientit', 'Customer app', 'Aplikacija za klijente'],
    'tab.ivr': ["Thirr dispeçerin", "Call dispatch", "Pozovi dispečera"],
    'tab.driver': ['Aplikacioni i shoferit', 'Driver app', 'Aplikacija za vozače'],
    'hint.customer': ['Pamja e pasagjerit: zgjidh destinacionin (nga lista ose me prekje në hartë), rezervo dhe shiko si po vjen shoferi. Kjo ndahet drejtpërdrejt me dhomën operative dhe aplikacionin e shoferit në çdo pajisje — provo ta hapësh dhomën operative në një skedë tjetër.',
      'Rider view: pick a destination (dropdown or tap the map), book, and watch your driver arrive. This is shared live with the ops room and driver app on any device — try opening ops in another tab.',
      'Prikaz putnika: izaberite odredište (iz liste ili dodirom na mapu), rezervišite i pratite kako vam vozač stiže. Ovo se uživo deli sa operativnim centrom i aplikacijom za vozače na bilo kom uređaju — probajte da otvorite operativni centar u drugom tabu.'],
    'hint.ivr': ["Shtyp 1 për statusin e rezervimit, 2 për të rezervuar sërish udhëtimin e fundit, 3 për të folur me një operator. Thirrja bëhet përmes internetit, nga aplikacioni.", "Press 1 for your booking status, 2 to rebook your last trip, 3 to speak to an operator. The call goes over the internet, from this app.", "Pritisnite 1 za status rezervacije, 2 da ponovo rezervišete poslednju vožnju, 3 da razgovarate sa operaterom. Poziv ide preko interneta, iz aplikacije."],
    'hint.driver': ['Pamja e shoferit: merr oferta pune 15 s kur dispeçimi zgjedh mjetin tënd. Provo SOS ose Anulo për të shkaktuar përjashtime te operatorët.',
      'Driver view: you get real 15 s job offers when dispatch picks your vehicle. Try SOS or Cancel to trigger ops exceptions.'],
    'lg.sub': ['Hyni për të hapur hapësirën tuaj të punës', 'Sign in to open your workspace', 'Prijavite se da otvorite svoj radni prostor'],
    'lg.phone': ['Numri i telefonit', 'Phone number', 'Broj telefona'],
    'lg.send': ['Dërgo kodin', 'Send code', 'Pošalji kod'],
    'lg.smsinfo': ["Do t'ju dërgojmë një kod 6-shifror me SMS për të konfirmuar se jeni ju.", "We'll text you a 6-digit code to confirm it's you.", 'Poslaćemo vam SMS sa šestocifrenim kodom da potvrdimo da ste to vi.'],
    'lg.sentto': ['Dërguam një kod 6-shifror te', 'We sent a 6-digit code to', 'Poslali smo šestocifreni kod na'],
    'lg.verify': ['Verifiko dhe hyr', 'Verify and sign in', 'Potvrdi i prijavi se'],
    'lg.other': ['Përdor një numër tjetër', 'Use a different number', 'Koristi drugi broj'],
    'lg.user': ['Përdoruesi', 'Username', 'Korisničko ime'],
    'lg.pass': ['Fjalëkalimi', 'Password', 'Lozinka'],
    'lg.passph': ['fjalëkalimi', 'password', 'lozinka'],
    'lg.signin': ['Hyr', 'Sign in', 'Prijavi se'],
    'lg.demo': ['💬 Mesazhet · Taxi Ardi (modaliteti demo)', '💬 Messages · Taxi Ardi (demo mode)', '💬 Poruke · Taxi Ardi (demo režim)'],
    'lg.demoCode': ['Kodi juaj i verifikimit është {code}.', 'Your verification code is {code}.', 'Vaš verifikacioni kod je {code}.'],
    'lg.replaced': ["U shkëputët — ky shfletues u përdor për t'u identifikuar si dikush tjetër në një skedë tjetër.", 'Signed out — this browser was used to sign in as someone else in another tab.', 'Odjavljeni ste — ovaj pregledač je korišćen za prijavu drugog korisnika u drugom tabu.'],
    'err.phone': ['Shkruani një numër telefoni të vlefshëm.', 'Enter a valid phone number.', 'Unesite važeći broj telefona.'],
    'err.attempts': ['Shumë përpjekje. Provoni sërish pas disa minutash.', 'Too many attempts. Try again in a few minutes.', 'Previše pokušaja. Pokušajte ponovo za nekoliko minuta.'],
    'err.expired': ['Kodi ka skaduar — kërkoni një të ri.', 'Code expired — request a new one.', 'Kod je istekao — zatražite novi.'],
    'err.wrongcode': ['Kod i gabuar, provoni sërish.', 'Wrong code, try again.', 'Pogrešan kod, pokušajte ponovo.'],
    'err.nocompany': ['Ende nuk është konfiguruar asnjë kompani në këtë instalim.', 'No company is set up on this install yet.', 'Na ovoj instalaciji još nije podešena nijedna kompanija.'],
    'err.wrongpw': ['Përdoruesi ose fjalëkalimi është i gabuar.', 'Wrong username or password.', 'Pogrešno korisničko ime ili lozinka.'],
    'err.notsignedin': ['Nuk jeni identifikuar.', 'Not signed in.', 'Niste prijavljeni.'],
    'err.failed': ['Kërkesa dështoi.', 'Request failed.', 'Zahtev nije uspeo.'],
    'err.rate': ['Shumë kërkesa — prisni pak dhe provoni sërish.', 'Too many requests — please wait a moment and try again.', 'Previše zahteva — sačekajte trenutak i pokušajte ponovo.'],
    'err.role': ['Nuk lejohet për këtë rol.', 'Not allowed for this role.', 'Nije dozvoljeno za ovu ulogu.'],
    'err.sendfail': ['Kodi nuk mund të dërgohet tani. Provoni sërish.', 'Could not send the code right now. Please try again.', 'Kod trenutno nije moguće poslati. Pokušajte ponovo.'],
    'err.action': ['Veprimi dështoi', 'Action failed', 'Radnja nije uspela'],
    'rtc.live': [' · 🔊 audio aktive', ' · 🔊 audio live', ' · 🔊 zvuk aktivan'],
    'rtc.connecting': [' · po lidhet audioja…', ' · connecting audio…', ' · povezivanje zvuka…'],
    'rtc.tap': ['Prek kudo për të aktivizuar audion', 'Tap anywhere to enable audio', 'Dodirnite bilo gde da omogućite zvuk'],
    'rtc.nomic': ['Ky shfletues/kontekst nuk ka akses te mikrofoni (kërkon HTTPS ose localhost).', 'This browser/context has no microphone access (needs HTTPS or localhost).', 'Ovaj pregledač/kontekst nema pristup mikrofonu (potreban je HTTPS ili localhost).'],

    /* ---------- shared vocab: vehicles, payment, tags, "when" ---------- */
    'veh.standard': ['Standard', 'Standard', 'Standard'],
    'veh.comfort': ['Komfort', 'Comfort', 'Komfor'],
    'veh.xl': ['XL (6 ulëse)', 'XL (6 seats)', 'XL (6 sedišta)'],
    'veh.access': ['Karrige me rrota', 'Wheelchair', 'Invalidska kolica'],
    'pay.card': ['💳 Kartë •• 4242', '💳 Card •• 4242', '💳 Kartica •• 4242'],
    'pay.wallet': ['👛 Portofol', '👛 Wallet', '👛 Novčanik'],
    'pay.corp': ['🏢 Llogari korporative', '🏢 Corporate account', '🏢 Korporativni račun'],
    'pay.cash': ['💵 Para në dorë', '💵 Cash', '💵 Gotovina'],
    'tag.wheelchair': ['♿ Karrige me rrota', '♿ Wheelchair', '♿ Invalidska kolica'],
    'tag.childseat': ['👶 Ulëse për fëmijë', '👶 Child seat', '👶 Dečje sedište'],
    'tag.pets': ['🐾 Kafshë', '🐾 Pets', '🐾 Ljubimci'],
    'tag.luggage': ['🧳 Bagazh shtesë', '🧳 Extra luggage', '🧳 Dodatni prtljag'],
    'when.0': ['Tani', 'Now', 'Odmah'],
    'when.10': ['Pas 10 min', 'In 10 min', 'Za 10 min'],
    'when.30': ['Pas 30 min', 'In 30 min', 'Za 30 min'],
    'when.60': ['Pas 1 ore', 'In 1 hour', 'Za 1 sat'],
    'when.120': ['Pas 2 orësh', 'In 2 hours', 'Za 2 sata'],
    'ps.processing': ['në përpunim…', 'processing…', 'u obradi…'],
    'ps.paid': ['paguar ✓', 'paid ✓', 'plaćeno ✓'],
    'ps.failed': ['pagesa dështoi, ekipi ynë do ta provojë sërish', 'payment failed, our team will retry', 'plaćanje nije uspelo, naš tim će pokušati ponovo'],
    'ps.invoiced': ['faturuar në llogarinë korporative', 'billed to corporate account', 'fakturisano na korporativni račun'],
    'ps.cash': ['paguaje shoferin me para në dorë', 'pay driver in cash', 'platite vozaču gotovinom'],
    'ps.none': ['', '', ''],

    /* ---------- rider app ---------- */
    'cu.hello': ['Përshëndetje,', 'Hello,', 'Zdravo,'],
    'cu.here': ['Këtu', 'Here', 'Ovde'],
    'cu.saved': ['Të ruajtura', 'Saved', 'Sačuvano'],
    'cu.places': ['Vende', 'Places', 'Mesta'],
    'cu.current': ['📍 Vendndodhja aktuale', '📍 Current location', '📍 Trenutna lokacija'],
    'cu.pinned': ['📌 I fiksuar: {label}', '📌 Pinned: {label}', '📌 Označeno: {label}'],
    'cu.ride': ['Udhëtim', 'Ride', 'Vožnja'],
    'cu.trips': ['Udhëtimet', 'Trips', 'Vožnje'],
    'cu.placesTab': ['Vendet', 'Places', 'Mesta'],
    'cu.tapPickup': ['📍 Prek hartën: marrja', '📍 Tap map: pickup', '📍 Dodirnite mapu: preuzimanje'],
    'cu.tapDrop': ['🏁 Prek hartën: destinacioni', '🏁 Tap map: drop-off', '🏁 Dodirnite mapu: odredište'],
    'cu.pickup': ['Marrja', 'Pickup', 'Preuzimanje'],
    'cu.dropoff': ['Destinacioni', 'Drop-off', 'Odredište'],
    'cu.payment': ['Pagesa', 'Payment', 'Plaćanje'],
    'cu.when': ['Kur', 'When', 'Kada'],
    'cu.choosedest': ['Zgjidh një destinacion', 'Choose a destination', 'Izaberite odredište'],
    'cu.choosepu': ['Zgjidh vendin e marrjes', 'Choose pickup', 'Izaberite mesto preuzimanja'],
    'cu.whereto': ['Për ku?', 'Where to?', 'Kuda idete?'],
    'cu.yourtrips': ['Udhëtimet tuaja', 'Your trips', 'Vaše vožnje'],
    'cu.rebook': ['Rezervo sërish', 'Rebook', 'Ponovo rezerviši'],
    'cu.notrips': ['Ende nuk ka udhëtime.', 'No trips yet.', 'Još nema vožnji.'],
    'cu.savedplaces': ['Vendet e ruajtura', 'Saved places', 'Sačuvana mesta'],
    'cu.remove': ['Hiq', 'Remove', 'Ukloni'],
    'cu.nothing': ['Ende nuk ka asgjë të ruajtur.', 'Nothing saved yet.', 'Još ništa nije sačuvano.'],
    'cu.saveaplace': ['Ruaj një vend', 'Save a place', 'Sačuvaj mesto'],
    'cu.favph': ['Emri (p.sh. Palestra)', 'Name (e.g. Gym)', 'Naziv (npr. Teretana)'],
    'cu.curpu': ['marrja aktuale', 'current pickup', 'trenutno preuzimanje'],
    'cu.curdr': ['destinacioni aktual', 'current drop-off', 'trenutno odredište'],
    'cu.saveplace': ['Ruaj vendin', 'Save place', 'Sačuvaj mesto'],
    'cu.sched': ['🗓 Planifikuar për {when}', '🗓 Scheduled for {when}', '🗓 Zakazano za {when}'],
    'cu.leadnote': ['Shoferin ta caktojmë {n} min para marrjes.', 'We assign your driver {n} min before pickup.', 'Vozača dodeljujemo {n} min pre preuzimanja.'],
    'cu.finding': ['Po e gjejmë shoferin tuaj…', 'Finding your driver…', 'Tražimo vašeg vozača…'],
    'cu.waiting': ['Po pritet {t}', 'Waiting {t}', 'Čekanje {t}'],
    'cu.alerted': [' · ekipi ynë operativ është njoftuar dhe po merret me këtë', ' · our ops team has been alerted and is on it', ' · naš operativni tim je obavešten i radi na tome'],
    'cu.contacting': ['Po kontaktojmë një shofer aty pranë…', 'Contacting a nearby driver…', 'Kontaktiramo vozača u blizini…'],
    'cu.reqsent': ['Kërkesa u dërgua, po pritet konfirmimi', 'Request sent, waiting for confirmation', 'Zahtev je poslat, čeka se potvrda'],
    'cu.ontheway': ['Shoferi është rrugës · {n} min', 'Driver on the way · {n} min', 'Vozač je na putu · {n} min'],
    'cu.assignedby': ['Caktuar nga dispeçeri ynë', 'Assigned by our dispatcher', 'Dodelio naš dispečer'],
    'cu.confirmed': ['Konfirmuar', 'Confirmed', 'Potvrđeno'],
    'cu.arrived': ['🚕 Shoferi juaj ka mbërritur', '🚕 Your driver has arrived', '🚕 Vaš vozač je stigao'],
    'cu.lookplate': ['Kërkoni targën {plate}', 'Look for plate {plate}', 'Tražite tablicu {plate}'],
    'cu.ontrip': ['Në udhëtim · edhe {n} min deri në destinacion', 'On trip · {n} min to destination', 'U vožnji · još {n} min do odredišta'],
    'cu.estfare': ['Tarifa e përafërt {fare}', 'Est. fare {fare}', 'Procenjena cena {fare}'],
    'cu.shared': ['🛡 Udhëtimi ndahet me dhomën operative', '🛡 Trip shared with ops room', '🛡 Vožnja se deli sa operativnim centrom'],
    'cu.complete': ['Udhëtimi përfundoi · {fare}', 'Trip complete · {fare}', 'Vožnja je završena · {fare}'],
    'cu.thanks': ['Faleminderit për vlerësimin {stars}', 'Thanks for rating {stars}', 'Hvala na oceni {stars}'],
    'cu.rate': ['Vlerësoni shoferin:', 'Rate your driver:', 'Ocenite vozača:'],
    'cu.done': ['Mbaro', 'Done', 'Gotovo'],
    'cu.cancelled': ['Udhëtimi u anulua', 'Ride cancelled', 'Vožnja je otkazana'],
    'cu.bookagain': ['Rezervo sërish', 'Book again', 'Rezerviši ponovo'],
    'cu.cancelride': ['Anulo udhëtimin', 'Cancel ride', 'Otkaži vožnju'],
    'cu.nocar': ['asnjë makinë afër', 'no car nearby', 'nema vozila u blizini'],
    'cu.minaway': ['{n} min larg', '{n} min away', 'na {n} min'],
    'cu.book': ['Rezervo {veh} · {fare}', 'Book {veh} · {fare}', 'Rezerviši {veh} · {fare}'],
    'cu.scheduled': [' · e planifikuar', ' · scheduled', ' · zakazano'],
    'cu.yourdriver': ['shoferi juaj', 'your driver', 'vaš vozač'],
    'cu.incoming': ['📞 Thirrje hyrëse nga {name}', '📞 Incoming call from {name}', '📞 Dolazni poziv: {name}'],
    'cu.calling': ['📞 Po thirret {name}…', '📞 Calling {name}…', '📞 Pozivanje: {name}…'],
    'cu.connected': ['📞 I lidhur me {name} · {t}', '📞 Connected to {name} · {t}', '📞 Povezani: {name} · {t}'],
    'cu.answer': ['Përgjigju', 'Answer', 'Javi se'],
    'cu.decline': ['Refuzo', 'Decline', 'Odbij'],
    'cu.cancel': ['Anulo', 'Cancel', 'Otkaži'],
    'cu.hangup': ['Mbyll thirrjen', 'Hang up', 'Prekini poziv'],
    'cu.sms': ['💬 Mesazhet · Taxi Ardi', '💬 Messages · Taxi Ardi', '💬 Poruke · Taxi Ardi'],

    /* ---------- phone / IVR simulator ---------- */
    'iv.welcomeBack': ['Mirë se u ktheve, {name}. ', 'Welcome back, {name}. ', 'Dobro došli nazad, {name}. '],
    'iv.welcome': ['Mirë se vini te Taxi Ardi. Nuk e njohim këtë numër. ', 'Welcome to Taxi Ardi. We do not recognise this number. ', 'Dobro došli u Taxi Ardi. Ne prepoznajemo ovaj broj. '],
    'iv.p1': ['Shtypni 1 për statusin e rezervimit tuaj aktual. ', 'Press 1 for the status of your current booking. ', 'Pritisnite 1 za status vaše trenutne rezervacije. '],
    'iv.p2': ['Shtypni 2 për të rezervuar sërish udhëtimin e fundit nga {from} në {to}. ', 'Press 2 to rebook your last trip from {from} to {to}. ', 'Pritisnite 2 da ponovo rezervišete poslednju vožnju od {from} do {to}. '],
    'iv.p3': ['Shtypni 3 ose 0 për të folur me një operator. Shtypni 9 për ta dëgjuar sërish këtë meny.', 'Press 3 or 0 to speak to an operator. Press 9 to hear this menu again.', 'Pritisnite 3 ili 0 da razgovarate sa operaterom. Pritisnite 9 da ponovo čujete ovaj meni.'],
    'iv.noactive': ['Nuk keni asnjë rezervim aktiv.', 'You have no active booking.', 'Nemate aktivnu rezervaciju.'],
    'iv.s.scheduled': ['Rezervimi {id} është planifikuar për {when}.', 'Booking {id} is scheduled for {when}.', 'Rezervacija {id} je zakazana za {when}.'],
    'iv.s.pending': ['Rezervimi {id} u konfirmua dhe po e gjejmë shoferin tuaj.', 'Booking {id} is confirmed and we are finding your driver.', 'Rezervacija {id} je potvrđena i tražimo vašeg vozača.'],
    'iv.s.offered': ['Rezervimi {id}: po kontaktojmë një shofer aty pranë.', 'Booking {id}: we are contacting a nearby driver.', 'Rezervacija {id}: kontaktiramo vozača u blizini.'],
    'iv.s.enroute': ['Rezervimi {id}: {name} me {model}, targa {plate}, është rrugës dhe do të mbërrijë për rreth {n} minuta.', 'Booking {id}: {name} in a {model}, plate {plate}, is on the way and arrives in about {n} minutes.', 'Rezervacija {id}: {name} u vozilu {model}, tablica {plate}, je na putu i stiže za oko {n} minuta.'],
    'iv.s.arrived': ['Shoferi juaj {name} ka mbërritur te vendi i marrjes.', 'Your driver {name} has arrived at the pickup point.', 'Vaš vozač {name} je stigao na mesto preuzimanja.'],
    'iv.s.ontrip': ['Aktualisht jeni në udhëtim.', 'You are currently on a trip.', 'Trenutno ste u vožnji.'],
    'iv.s.unavail': ['Statusi nuk është i disponueshëm.', 'Status unavailable.', 'Status nije dostupan.'],
    'iv.dialling': ["Po thirret dispeçeri nga {phone}…", "Calling dispatch from {phone}…", "Pozivanje dispečera sa broja {phone}…"],
    'iv.callended': ['Thirrja përfundoi.', 'Call ended.', 'Poziv je završen.'],
    'iv.pressed': ['Shtypët {k}', 'Pressed {k}', 'Pritisnuli ste {k}'],
    'iv.hungup': ['E mbyllët thirrjen.', 'You hung up.', 'Prekinuli ste poziv.'],
    'iv.rebooked': ['Gati. Rezervimi {id} u konfirmua dhe po e gjejmë shoferin tuaj. Do të merrni një mesazh me SMS. Shtypni 1 për të kontrolluar statusin, ose yllin për të mbyllur.', 'Done. Booking {id} is confirmed and we are finding your driver. You will receive a text message. Press 1 to check the status, or star to hang up.', 'Gotovo. Rezervacija {id} je potvrđena i tražimo vašeg vozača. Dobićete SMS poruku. Pritisnite 1 da proverite status, ili zvezdicu da prekinete poziv.'],
    'iv.rebookonly': ['Rezervimi i shpejtë është i disponueshëm vetëm për pasagjerët e regjistruar me një udhëtim të mëparshëm. Shtypni 3 për të folur me një operator.', 'Quick rebooking is only available to registered riders with a previous trip. Press 3 to speak to an operator.', 'Brza rezervacija je dostupna samo registrovanim putnicima sa prethodnom vožnjom. Pritisnite 3 da razgovarate sa operaterom.'],
    'iv.confirm': ["Të rezervohet një taksi nga {from} në {to}? Shtypni 1 për të konfirmuar, ose 2 për t'u kthyer.", 'Book a taxi from {from} to {to}? Press 1 to confirm, or 2 to go back.', 'Da rezervišem taksi od {from} do {to}? Pritisnite 1 za potvrdu, ili 2 za povratak.'],
    'iv.hold': ['Ju lutemi prisni ndërsa ju lidhim me operatorin e parë të lirë.', 'Please hold while we connect you to the next available operator.', 'Molimo sačekajte dok vas povezujemo sa sledećim slobodnim operaterom.'],
    'iv.badopt': ['Na vjen keq, ky opsion nuk është i disponueshëm. ', 'Sorry, that option is not available. ', 'Žao nam je, ta opcija nije dostupna. '],
    'iv.callTitle': ["Thirr dispeçerin", "Call dispatch", "Pozovite dispečera"],
    'iv.callDesc': ["Telefono ekipin tonë të dispeçimit direkt nga aplikacioni (thirrja bëhet përmes internetit). Menyja automatike të ndihmon me statusin dhe rezervimin e shpejtë, ose të lidh me një operator.", "Call our dispatch team straight from the app (the call goes over the internet). The automated menu can tell you your booking status or rebook your last trip, or connect you to an operator.", "Pozovite naš dispečerski tim direktno iz aplikacije (poziv ide preko interneta). Automatski meni vam može dati status rezervacije ili ponovo rezervisati poslednju vožnju, ili vas povezati sa operaterom."],
    'iv.callingfrom': ['Duke telefonuar nga', 'Calling from', 'Poziva sa broja'],
    'iv.tts': ['Lexo me zë porositë e IVR', 'Read IVR prompts aloud', 'Čitaj IVR poruke naglas'],
    'iv.callbtn': ['📞 Thirr', '📞 Call', '📞 Pozovi'],
    'iv.hang': ['Mbyll', 'Hang up', 'Prekini'],
    'iv.newcall': ['Thirrje e re', 'New call', 'Novi poziv'],
    'iv.sub.auto': ['Menyja automatike', 'Automated menu', 'Automatski meni'],
    'iv.sub.hold': ['⏳ Në pritje — duke pritur një operator', '⏳ On hold — waiting for an operator', '⏳ Na čekanju — čeka se operater'],
    'iv.sub.op': ['🎧 Po flisni me operatorin', '🎧 Speaking with operator', '🎧 Razgovor sa operaterom'],
    'iv.sub.ended': ['Thirrja përfundoi', 'Call ended', 'Poziv je završen'],
    'iv.opconn': ['🎧 U lidhët me operatorin {op}.', '🎧 Connected to operator {op}.', '🎧 Povezani ste sa operaterom {op}.'],
    'iv.opbooked': ['🎧 {op}: "Taksia juaj {id} u rezervua. Së shpejti do të merrni një SMS."', '🎧 {op}: "Your taxi {id} is booked. You\'ll get an SMS shortly."', '🎧 {op}: "Vaš taksi {id} je rezervisan. Uskoro ćete dobiti SMS."'],
    'iv.dropped': ['Thirrja u ndërpre.', 'Call dropped.', 'Poziv je prekinut.'],
    'iv.opended': ['Operatori e mbylli thirrjen. Faleminderit që telefonuat Taxi Ardi.', 'The operator ended the call. Thank you for calling Taxi Ardi.', 'Operater je završio poziv. Hvala što ste zvali Taxi Ardi.'],
    'iv.smsto': ['💬 SMS për {phone}', '💬 SMS to {phone}', '💬 SMS na {phone}'],

    /* ---------- ops room (Albanian + English only) ---------- */
    'map.traffic': ['Trafiku', 'Traffic'], 'map.labels': ['Etiketat', 'Labels'], 'map.fit': ['⤢ Shiko të gjitha', '⤢ Fit all'], 'map.fitTitle': ['Zmadho te e gjithë zona e shërbimit', 'Zoom to the whole service area'],
    'map.pickPu': ['Kliko hartën për të caktuar vendin e marrjes', 'Click the map to set the pickup location'], 'map.pickDo': ['Kliko hartën për të caktuar destinacionin', 'Click the map to set the drop-off location'],
    'leg.available': ['I lirë', 'Available'], 'leg.offered': ['Ofruar', 'Offered'], 'leg.topickup': ['Drejt marrjes', 'To pickup'], 'leg.atpickup': ['Në marrje', 'At pickup'], 'leg.ontrip': ['Në udhëtim', 'On trip'], 'leg.waiting': ['Pasagjer në pritje', 'Waiting rider'],
    'kpi.drivers': ['Shoferë online', 'Drivers online'], 'kpi.active': ['Udhëtime aktive', 'Active trips'], 'kpi.searching': ['Në kërkim', 'Searching'], 'kpi.alerts': ['Alarme të hapura', 'Open alerts'], 'kpi.calls': ['Thirrje në pritje', 'Calls waiting'],
    'kpi.avgwait': ['Pritja mesatare deri në mbërritje', 'Avg. wait to arrival'], 'kpi.done': ['Të përfunduara', 'Completed'], 'kpi.revenue': ['Të ardhura', 'Revenue'], 'kpi.traffic': ['Ngarkesa e trafikut', 'Traffic load'],
    'op.min': [' min', ' min'],
    'st.scheduled': ['Planifikuar', 'Scheduled'], 'st.pending': ['Në kërkim', 'Searching'], 'st.offered': ['Ofruar', 'Offered'], 'st.enroute': ['Rrugës', 'En route'], 'st.arrived': ['Mbërriti', 'Arrived'], 'st.ontrip': ['Në udhëtim', 'On trip'], 'st.completed': ['Përfunduar', 'Done'], 'st.cancelled': ['Anuluar', 'Cancelled'],
    'ds.available': ['I lirë', 'Available'], 'ds.offered': ['Ofruar', 'Offered'], 'ds.enroute': ['Drejt marrjes', 'To pickup'], 'ds.arrived': ['Në marrje', 'At pickup'], 'ds.ontrip': ['Në udhëtim', 'On trip'], 'ds.offline': ['Offline', 'Offline'],
    'f.active': ['Aktive', 'Active'], 'f.pending': ['Në kërkim', 'Searching'], 'f.scheduled': ['Të planifikuara', 'Scheduled'], 'f.done': ['Historiku', 'History'], 'f.all': ['Të gjitha', 'All'],
    'op.src.app': ['Aplikacion', 'App'], 'op.src.ivr': ['IVR', 'IVR'], 'op.src.ops': ['Operator', 'Operator'],
    'op.nobookings': ['Asnjë rezervim në këtë pamje.', 'No bookings in this view.'],
    'op.view': ['Shiko', 'View'], 'op.retrypay': ['Provo pagesën sërish', 'Retry payment'], 'op.ack': ['Konfirmo marrjen', 'Acknowledge'], 'op.resolved': ['zgjidhur', 'resolved'], 'op.acked': ['e konfirmuar', 'acknowledged'],
    'op.noalerts': ['Asnjë alarm. Rezervimet pa shofer, anulimet e shoferëve, dështimet e pagesave dhe sinjalet SOS shfaqen këtu.', 'No alerts. Unassigned bookings, driver cancellations, payment failures and SOS signals appear here.'],
    'op.driverapp': ['(aplikacioni i shoferit)', '(driver app)'], 'op.trips': ['{n} udhëtime', '{n} trips'], 'op.trips_1': ['1 udhëtim', '1 trip'],
    'op.rulesTitle': ['Motori i rregullave të automatizimit', 'Automation rule engine'],
    'op.rulesHelp': ['Pikët = ETA × w<sub>eta</sub> + trafiku × w<sub>traffic</sub> + (5 − vlerësimi) × w<sub>rating</sub>. Oferta i jepet shoferit me pikët më të ulëta.', 'Score = ETA × w<sub>eta</sub> + traffic × w<sub>traffic</sub> + (5 − rating) × w<sub>rating</sub>. Lowest score gets the offer.'],
    'op.wEta': ['Pesha: ETA e marrjes', 'Weight: pickup ETA'], 'op.wTraffic': ['Pesha: trafiku në rrugë', 'Weight: traffic on route'], 'op.wRating': ['Pesha: vlerësimi i shoferit', 'Weight: driver rating'], 'op.maxEta': ['ETA maksimale e marrjes', 'Max pickup ETA'],
    'op.timers': ['Kohëmatësit', 'Timers'], 'op.offerSec': ['Numërimi mbrapsht i ofertës së shoferit', 'Driver offer countdown'], 'op.unassignedSec': ['Alarm për rezervim pa shofer pas', 'Unassigned alert after'], 'op.leadMin': ['Liro udhëtimet e planifikuara', 'Release scheduled rides'], 'op.minBefore': [' min para', ' min before'],
    'op.modes': ['Mënyrat', 'Modes'], 'op.autoDispatch': ['Dispeçim automatik (i çaktivizuar = operatorët caktojnë manualisht)', 'Auto-dispatch (off = operators assign manually)'],
    'op.jam': ['🚧 Shkakto incident trafiku', '🚧 Trigger traffic incident'], 'op.rulesNote': ['Ndryshimet këtu zbatohen menjëherë për çdo përdorues operativ që e ndjek këtë kompani.', 'Changes here apply to every ops user watching this company, immediately.'],
    'op.callqueue': ['Radha e thirrjeve', 'Call queue'], 'op.opnew': ['Paneli i operatorit · rezervim i ri', 'Operator dashboard · new booking'], 'op.oncall': ['Paneli i operatorit · në thirrje me {phone}', 'Operator dashboard · on call with {phone}'],
    'op.clear': ['Pastro', 'Clear'], 'op.phone': ['Telefoni', 'Phone'], 'op.name': ['Emri', 'Name'], 'op.callername': ['Emri i telefonuesit', 'Caller name'], 'op.pickup': ['Marrja', 'Pickup'], 'op.dropoff': ['Destinacioni', 'Drop-off'], 'op.pickonmap': ['Zgjidh në hartë', 'Pick on map'],
    'op.vehicle': ['Automjeti', 'Vehicle'], 'op.payment': ['Pagesa', 'Payment'], 'op.when': ['Kur', 'When'], 'op.notes': ['Kërkesa të veçanta / shënime', 'Special requests / notes'], 'op.notesph': ['p.sh. i bie ziles, 2 valixhe', 'e.g. ring the bell, 2 suitcases'],
    'op.create': ['Krijo rezervim', 'Create booking'], 'op.endcall': ['Mbyll thirrjen', 'End call'], 'op.puloc': ['Vendi i marrjes', 'Pickup location'], 'op.drloc': ['Vendi i destinacionit', 'Drop-off location'], 'op.callerplaces': ['Vendet e ruajtura të telefonuesit', 'Caller saved places'], 'op.places': ['Vende', 'Places'],
    'op.choosefirst': ['Zgjidh fillimisht marrjen dhe destinacionin.', 'Choose pickup and drop-off first.'], 'op.created': ['U krijua {id}', 'Created {id}'],
    'op.connected': ['u lidh {t}', 'connected {t}'], 'op.booked': ['Rezervuar {id}', 'Booked {id}'], 'op.repeat': ['telefonues i përsëritur · {n} udhëtime', 'repeat caller · {n} trips'], 'op.repeat_1': ['telefonues i përsëritur · 1 udhëtim', 'repeat caller · 1 trip'], 'op.last': ['E fundit:', 'Last:'], 'op.use': ['Përdor', 'Use'],
    'op.unknowncaller': ['Telefonues i panjohur', 'Unknown caller'], 'op.waiting': ['Në pritje {t}', 'Waiting {t}'], 'op.oncallt': ['Në thirrje {t}', 'On call {t}'], 'op.answer': ['Përgjigju', 'Answer'], 'op.end': ['Mbyll', 'End'],
    'op.noqueue': ['Asnjë thirrje në pritje. Këtu shfaqen telefonuesit që shtypin 3 në IVR, ose numrat e panjohur.', 'No calls waiting. Callers who press 3 in the IVR, or unknown numbers, appear here.'],
    'op.rider': ['Pasagjeri', 'Rider'], 'op.vehicleL': ['Automjeti', 'Vehicle'], 'op.fare': ['Tarifa', 'Fare'], 'op.driver': ['Shoferi', 'Driver'], 'op.stats': ['Statistikat', 'Stats'], 'op.location': ['Vendndodhja', 'Location'], 'op.job': ['Detyra', 'Job'], 'op.none': ['asnjë', 'none'], 'op.livegps': ['📍 GPS live', '📍 live GPS'],
    'op.reassign': ['Rikatakto', 'Reassign'], 'op.assign': ['Cakto', 'Assign'], 'op.noeligible': ['Asnjë shofer i përshtatshëm i lirë', 'No eligible driver available'], 'op.dispatch': ['Dërgo tani', 'Dispatch now'], 'op.calldrv': ['📞 Thirr shoferin', '📞 Call driver'], 'op.cancelbk': ['Anulo rezervimin', 'Cancel booking'], 'op.voipcall': ['📞 Thirrje VoIP', '📞 VoIP call'], 'op.open': ['Hap {id}', 'Open {id}'], 'op.hasoffer': [' (ka ofertë)', ' (has offer)'],
    'op.ps.none': ['—', '—'], 'op.ps.processing': ['në përpunim', 'processing'], 'op.ps.paid': ['paguar', 'paid'], 'op.ps.failed': ['dështoi', 'failed'], 'op.ps.invoiced': ['faturuar', 'invoiced'], 'op.ps.cash': ['para në dorë', 'cash'],
    'op.searchingfor': ['⏱ Në kërkim për {t}', '⏱ Searching for {t}'], 'op.offerto': [' · oferta për {d} skadon pas {n}s', ' · offer to {d} expires in {n}s'], 'op.declinedby': [' · refuzuar nga {list}', ' · declined by {list}'],
    'op.eta': ['🚕 ETA e shoferit te marrja {n} min', '🚕 Driver ETA to pickup {n} min'], 'op.todrop': ['🚕 {n} min deri te destinacioni', '🚕 {n} min to drop-off'], 'op.pickupat': ['🗓 Marrja në {t}', '🗓 Pickup at {t}'],
    'op.tab.bookings': ['Rezervimet', 'Bookings'], 'op.tab.alerts': ['Alarmet', 'Alerts'], 'op.tab.calls': ['Thirrjet', 'Calls'], 'op.tab.drivers': ['Shoferët', 'Drivers'], 'op.tab.rules': ['Rregullat', 'Rules'], 'op.tab.log': ['Regjistri', 'Log'],
    'op.locate': ['Gjej', 'Locate'], 'op.incoming': ['📞 Hyrëse: ', '📞 Incoming: '], 'op.callingp': ['📞 Po thirret ', '📞 Calling '], 'op.connectedp': ['🎧 I lidhur: ', '🎧 Connected: '], 'op.headset': ['Kufje VoIP · {t}', 'VoIP headset · {t}'], 'op.drvcalling': ['Shoferi po telefonon dhomën operative', 'Driver is calling the ops room'], 'op.ringing': ['Po bie zilja…', 'Ringing…'], 'op.hangup': ['Mbyll', 'Hang up'], 'op.cancel': ['Anulo', 'Cancel'],

    /* ---------- landmark names (canonical English comes from roads.js; stored data keeps it) ---------- */
    'place.Skanderbeg Square': ['Sheshi Skënderbeu', 'Skanderbeg Square', 'Trg Skenderbega'],
    'place.Railway Station': ['Stacioni i Trenit', 'Railway Station', 'Železnička stanica'],
    'place.University Clinical Center': ['Qendra Klinike Universitare', 'University Clinical Center', 'Univerzitetski klinički centar'],
    'place.Albi Mall': ['Albi Mall', 'Albi Mall', 'Albi Mall'],
    'place.Mother Teresa Cathedral': ['Katedralja "Nënë Tereza"', 'Mother Teresa Cathedral', 'Katedrala Majke Tereze'],
    'place.Obiliq Centre': ['Qendra e Obiliqit', 'Obiliq Centre', 'Centar Obilića'],
    'place.Obiliq Market': ['Tregu i Obiliqit', 'Obiliq Market', 'Pijaca u Obiliću'],
    'place.Fushë Kosovë Centre': ['Qendra e Fushë Kosovës', 'Fushë Kosovë Centre', 'Centar Kosova Polja'],
    'place.Fushë Kosovë Train Station': ['Stacioni i Trenit, Fushë Kosovë', 'Fushë Kosovë Train Station', 'Železnička stanica Kosovo Polje'],
    'place.Big Mall Dardania': ['Big Mall Dardania', 'Big Mall Dardania', 'Big Mall Dardania'],
    'place.Fadil Vokrri Stadium': ['Stadiumi Fadil Vokrri', 'Fadil Vokrri Stadium', 'Stadion Fadil Vokri'],
    'place.Innovation Centre Kosovo': ['Qendra e Inovacionit të Kosovës', 'Innovation Centre Kosovo', 'Centar za inovacije Kosova'],
    'place.Adem Jashari Airport': ['Aeroporti Adem Jashari', 'Adem Jashari Airport', 'Aerodrom Adem Jašari'],
    'junction': ['Kryqëzimi {a}-{b}', 'Junction {a}-{b}', 'Raskrsnica {a}-{b}'],

    /* ---------- words that appear INSIDE engine-generated text (matched exactly, see loc()) ---------- */
    'exact.rider': ['pasagjeri', 'rider'], 'exact.operator': ['operatori', 'operator'], 'exact.ops': ['operatori', 'ops'],
    'exact.caller': ['Telefonues', 'Caller'], 'exact.guest': ['Mysafir', 'Guest'], 'exact.unknown': ['Telefonues i panjohur', 'Unknown caller'],
    'exact.why.op': ['telefonuesi kërkoi operator', 'caller requested operator'], 'exact.why.unknown': ['telefonues i panjohur', 'unknown caller'],
    'exact.r1': ['Problem me automjetin', 'Vehicle problem'], 'exact.r2': ['Pasagjeri nuk është në vendin e marrjes', 'Rider not at pickup'], 'exact.r3': ['Emergjencë personale', 'Personal emergency'],
    'exact.redispatch': ['Po ridërgohet automatikisht', 'Re-dispatching automatically'], 'exact.manual': ['Kërkon dispeçim manual', 'Needs manual dispatch'],
    'exact.src.app': ['aplikacionit celular', 'Mobile app'], 'exact.src.ivr': ['linjës telefonike IVR', 'IVR phone line'], 'exact.src.ops': ['operatorit', 'Operator'],

    /* ---------- engine-generated messages: templates keyed to the RULES table below ({1}.. = captured pieces) ---------- */
    'tx.bookedvia': ['Rezervuar përmes {1}', null], 'tx.bookedvia_by': ['Rezervuar përmes {1} nga {2}', null],
    'tx.offered': ['Oferta iu dërgua {1} ({2}), {3} min larg', null], 'tx.accepted': ['{1} pranoi', null], 'tx.timeout': ['{1} nuk u përgjigj (skadoi koha)', null], 'tx.declined': ['{1} refuzoi', null],
    'tx.arrivedpu': ['Shoferi arriti te vendi i marrjes', null], 'tx.tripstart': ['Udhëtimi filloi', null], 'tx.tripdone': ['Udhëtimi përfundoi, tarifa {1}', null], 'tx.payretry': ['Pagesa u provua sërish nga operatori', null],
    'tx.cancby': ['Anuluar nga {1}', null], 'tx.drvcanc': ['{1} anuloi: {2}', null], 'tx.manassign': ['U caktua manualisht te {1} nga {2}', null], 'tx.dispearly': ['Dërguar herët nga operatori', null], 'tx.sosdrv': ['🆘 SOS nga shoferi', null],
    'tx.released': ['Udhëtimi i planifikuar u lirua për dispeçim', null], 'tx.paycaptured': ['Pagesa u arkëtua {1}', null],
    'tx.newbk': ['{1} {2} {3} → {4} ({5})', null], 'tx.newbk_in': ['{1} {2} {3} → {4} ({5}, pas {6} min)', null],
    'tx.missed': ['{1} humbi ofertën {2}', null], 'tx.drvdeclined': ['{1} refuzoi {2}', null], 'tx.bkcanc': ['{1} u anulua nga {2}', null], 'tx.bkassign': ['{1} u caktua manualisht te {2} nga {3}', null], 'tx.bkreleased': ['{1} u lirua për dispeçim', null],
    'tx.waitop': ['☎️ {1} pret një operator ({2})', null], 'tx.abandon': ['☎️ {1} e braktisi radhën', null], 'tx.voipend': ['📞 Thirrja VoIP me {1} përfundoi', null],
    'tx.incident': ['🚧 Incident i madh: po formohet trafik i dendur — zona: {1}', null], 'tx.reset': ['Gjendja e dispeçimit u rivendos', null], 'tx.online': ['{1} u lidh online', null], 'tx.offline': ['{1} u shkëput (offline)', null],
    'tx.alertcanc': ['{1} ({2}) anuloi {3}: {4}. {5}.', null], 'tx.sos_during': ['🆘 EMERGJENCË: {1} ({2}) shtypi SOS — vendndodhja: {3} — rezervimi {4}', null], 'tx.sos': ['🆘 EMERGJENCË: {1} ({2}) shtypi SOS — vendndodhja: {3}', null],
    'tx.unassigned': ['{1} pa shofer për {2}s ({3} → {4}, {5})', null], 'tx.payfail': ['Pagesa dështoi për {1} ({2}, {3})', null],
    'tx.sms.bk.sched': ['Taxi Ardi: rezervimi {1} u konfirmua. Marrja në {2}. Çmimi i përafërt {3}.', null, 'Taxi Ardi: rezervacija {1} je potvrđena. Preuzimanje u {2}. Procenjena cena {3}.'],
    'tx.sms.bk.now': ['Taxi Ardi: rezervimi {1} u konfirmua. Po e gjejmë shoferin tuaj tani. Çmimi i përafërt {2}.', null, 'Taxi Ardi: rezervacija {1} je potvrđena. Tražimo vašeg vozača. Procenjena cena {2}.'],
    'tx.sms.eta': ['Taxi Ardi: {1} ({2}, {3}) është rrugës, ETA {4} min.', null, 'Taxi Ardi: {1} ({2}, {3}) je na putu, stiže za {4} min.'],
    'tx.sms.ontheway': ['Taxi Ardi: {1} ({2}, {3}) është rrugës.', null, 'Taxi Ardi: {1} ({2}, {3}) je na putu.'],
    'tx.sms.arrived': ['Taxi Ardi: shoferi juaj ka mbërritur ({1}).', null, 'Taxi Ardi: vaš vozač je stigao ({1}).'],
    'tx.sms.receipt': ['Fatura Taxi Ardi {1}: {2} ({3}). Faleminderit që udhëtuat me ne!', null, 'Taxi Ardi račun {1}: {2} ({3}). Hvala što ste se vozili s nama!'],
    'tx.sms.drvcancel': ['Taxi Ardi: shoferi juaj duhej të anulonte. Po ju gjejmë një tjetër.', null, 'Taxi Ardi: vaš vozač je morao da otkaže. Tražimo vam drugog.']
  };

  /* Server-side strings the browser shows verbatim (login errors, throttling…) -> dictionary key. */
  const ERRS = {
    'Enter a valid phone number.': 'err.phone', 'Too many attempts. Try again in a few minutes.': 'err.attempts', 'Code expired — request a new one.': 'err.expired',
    'Wrong code, try again.': 'err.wrongcode', 'No company is set up on this install yet.': 'err.nocompany', 'Wrong username or password.': 'err.wrongpw',
    'Not signed in.': 'err.notsignedin', 'Request failed.': 'err.failed', 'Too many requests — please wait a moment and try again.': 'err.rate',
    'Not allowed for this role.': 'err.role', 'Could not send the code right now. Please try again.': 'err.sendfail', 'Action failed': 'err.action'
  };

  /* Engine message -> template. Order matters: more specific patterns first. */
  const R = (re, key, extra) => ({ re, key, extra });
  const RULES = [
    R(/^Booked via (Mobile app|IVR phone line|Operator) by (.+)$/, 'tx.bookedvia_by'), R(/^Booked via (Mobile app|IVR phone line|Operator)$/, 'tx.bookedvia'),
    R(/^Offered to (.+) \((D\d+)\), ([\d.]+) min away$/, 'tx.offered'), R(/^(.+) accepted$/, 'tx.accepted'),
    R(/^(.+) did not respond \(timeout\)$/, 'tx.timeout'), R(/^(.+) declined$/, 'tx.declined'),
    R(/^Driver arrived at pickup$/, 'tx.arrivedpu'), R(/^Trip started$/, 'tx.tripstart'), R(/^Trip completed, fare (.+)$/, 'tx.tripdone'),
    R(/^Payment retried by ops$/, 'tx.payretry'), R(/^Cancelled by (.+)$/, 'tx.cancby'), R(/^(.+) cancelled: (.+)$/, 'tx.drvcanc'), R(/^Manually assigned to (.+) by (.+)$/, 'tx.manassign'),
    R(/^Dispatched early by ops$/, 'tx.dispearly'), R(/^🆘 SOS from driver$/, 'tx.sosdrv'), R(/^Scheduled ride released to dispatch$/, 'tx.released'), R(/^Payment captured (.+)$/, 'tx.paycaptured'),
    R(/^(RB-\d+) (🎧|☎️|📱) (.+?) → (.+?) \((.+?), in (\d+) min\)$/, 'tx.newbk_in'), R(/^(RB-\d+) (🎧|☎️|📱) (.+?) → (.+?) \((.+)\)$/, 'tx.newbk'),
    R(/^(D\d+) missed offer (RB-\d+)$/, 'tx.missed'), R(/^(D\d+) declined (RB-\d+)$/, 'tx.drvdeclined'), R(/^(RB-\d+) cancelled by (.+)$/, 'tx.bkcanc'),
    R(/^(RB-\d+) manually assigned to (D\d+) by (.+)$/, 'tx.bkassign'), R(/^(RB-\d+) released to dispatch$/, 'tx.bkreleased'),
    R(/^☎️ (.+) waiting for an operator \((.+)\)$/, 'tx.waitop'), R(/^☎️ (.+) abandoned the queue$/, 'tx.abandon'), R(/^📞 VoIP call with (D\d+) ended$/, 'tx.voipend'),
    R(/^🚧 Major incident: heavy congestion building near (.+)$/, 'tx.incident'), R(/^Dispatch state reset$/, 'tx.reset'),
    R(/^(D\d+) went online$/, 'tx.online'), R(/^(D\d+) went offline$/, 'tx.offline'),
    R(/^(.+) \((D\d+)\) cancelled (RB-\d+): (.+)\. (Re-dispatching automatically|Needs manual dispatch)\.$/, 'tx.alertcanc'),
    R(/^🆘 EMERGENCY: (.+) \((D\d+)\) pressed SOS near (.+) during (RB-\d+)$/, 'tx.sos_during'), R(/^🆘 EMERGENCY: (.+) \((D\d+)\) pressed SOS near (.+)$/, 'tx.sos'),
    R(/^(RB-\d+) unassigned for (\d+)s \((.+?) → (.+), (.+)\)$/, 'tx.unassigned'), R(/^Payment failed for (RB-\d+) \((.+), (€[\d.]+)\)$/, 'tx.payfail'),
    R(/^Taxi Ardi: booking (RB-\d+) confirmed\. Pickup at (\d\d:\d\d)\. Est\. (€[\d.]+)\.$/, 'tx.sms.bk.sched'), R(/^Taxi Ardi: booking (RB-\d+) confirmed\. Finding your driver now\. Est\. (€[\d.]+)\.$/, 'tx.sms.bk.now'),
    R(/^Taxi Ardi: (.+) \((.+), (.+)\) is on the way, ETA (\d+) min\.$/, 'tx.sms.eta'), R(/^Taxi Ardi: (.+) \((.+), (.+)\) is on the way\.$/, 'tx.sms.ontheway'),
    R(/^Taxi Ardi: your driver has arrived \((.+)\)\.$/, 'tx.sms.arrived'), R(/^Taxi Ardi receipt (RB-\d+): (€[\d.]+) \((.+)\)\. Thanks for riding!$/, 'tx.sms.receipt'),
    R(/^Taxi Ardi: your driver had to cancel\. We're finding you another one\.$/, 'tx.sms.drvcancel')
  ];

  /* ---------- language resolution ---------- */
  // Which languages the current screen offers: Serbian is client-side only; the driver app isn't translated yet.
  function avail() { return ctx.login ? (ctx.role === 'client' ? ['sq', 'en', 'sr'] : ['sq', 'en']) : ctx.role === 'client' ? ['sq', 'en', 'sr'] : ctx.role === 'ops' ? ['sq', 'en'] : ['en']; }
  function lang() { const a = avail(); return a.includes(pref) ? pref : (pref === 'sr' && a.includes('sq') ? 'sq' : a[0]); }
  function lookup(key, l) { const e = D[key]; return e ? e[IDX[l]] : undefined; }
  function t(key, p) {
    const l = lang();
    let s = lookup(key, l);
    if (s == null) s = l === 'sr' ? (lookup(key, 'en') ?? lookup(key, 'sq')) : l === 'sq' ? lookup(key, 'en') : lookup(key, 'sq');
    if (s == null) return key;
    if (p && p.n === 1) { const one = lookup(key + '_1', l); if (one != null) s = one; }
    return p ? s.replace(/\{(\w+)\}/g, (m, k) => p[k] == null ? m : p[k]) : s;
  }

  /* ---------- display-time translation of data that keeps canonical English ---------- */
  const PLACE_ROWS = Object.keys(D).filter(k => k.startsWith('place.')).map(k => k.slice(6)).sort((a, b) => b.length - a.length);
  function place(text) {
    const l = lang(); if (l === 'en' || text == null) return text;
    let s = String(text);
    for (const en of PLACE_ROWS) if (s.includes(en)) s = s.split(en).join(lookup('place.' + en, l));
    return s.replace(/Junction (\d+)-(\d+)/g, (m, a, b) => t('junction', { a, b }));
  }
  const EXACT = {};
  Object.keys(D).forEach(k => { if (k.startsWith('exact.')) EXACT[D[k][1]] = k; });
  function loc(v) {
    v = String(v);
    for (const [en, key] of [['XL (6 seats)', 'veh.xl'], ['Standard', 'veh.standard'], ['Comfort', 'veh.comfort'], ['Wheelchair', 'veh.access'], ['💳 Card •• 4242', 'pay.card'], ['👛 Wallet', 'pay.wallet'], ['🏢 Corporate account', 'pay.corp'], ['💵 Cash', 'pay.cash']]) if (v === en) return t(key);
    return EXACT[v] ? t(EXACT[v]) : place(v);
  }
  /* Engine texts (alerts, log, booking timeline, rider SMS) are generated in English on the server. */
  function tx(text) {
    const l = lang(); if (l === 'en' || typeof text !== 'string') return text;
    for (const r of RULES) {
      const m = r.re.exec(text); if (!m) continue;
      const tpl = lookup(r.key, l); if (tpl == null) return text;
      return tpl.replace(/\{(\d)\}/g, (x, i) => m[+i] == null ? x : loc(m[+i]));
    }
    return text;
  }
  const err = msg => ERRS[msg] ? t(ERRS[msg]) : msg;
  const veh = k => t('veh.' + k), vehShort = k => veh(k).replace(/ \(.*\)$/, ''), pay = k => t('pay.' + k), tag = k => t('tag.' + k);
  const nm = n => EXACT[n] && (n === 'Guest' || n === 'Caller' || n === 'Unknown caller') ? t(EXACT[n]) : n;

  /* ---------- DOM: static markup + switchers ---------- */
  function applyStatic() {
    document.documentElement.lang = lang();
    document.title = t('app.title');
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
    document.documentElement.style.setProperty('--reconnect', JSON.stringify(' ⚠ ' + t('hdr.reconnecting')));
  }
  function renderSwitchers() {
    const a = avail(), cur = lang();
    document.querySelectorAll('.lang-sw').forEach(sw => {
      sw.style.display = a.length > 1 ? '' : 'none';
      sw.innerHTML = a.map(l => `<button type="button" data-lang="${l}" class="${l === cur ? 'on' : ''}" title="${NAMES[l]}" aria-label="${NAMES[l]}">${SHORT[l]}</button>`).join('');
    });
  }
  function refresh() { applyStatic(); renderSwitchers(); subs.slice().forEach(f => { try { f(lang()); } catch (e) { console.error('i18n subscriber', e); } }); }
  function setLang(l) { if (!(l in IDX)) return; pref = l; try { localStorage.setItem('ro.lang', l); } catch (e) { } refresh(); }
  // role: 'client' | 'ops' | 'driver' | 'superuser'; login: true while still on the sign-in screen (any role's tab is browsable)
  function setContext(role, login) { ctx = { role, login: !!login }; refresh(); }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.lang-sw button[data-lang]'); if (b) setLang(b.dataset.lang); });

  RO.i18n = { t, tx, loc, place, err, veh, vehShort, pay, tag, nm, lang, setLang, setContext, onChange: f => subs.push(f), apply: refresh, speechLang: () => SPEECH[lang()], _dict: D, _rules: RULES };
})(window.RO = window.RO || {});
