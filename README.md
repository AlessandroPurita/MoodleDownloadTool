# Moodle Course Download Tool

Estensione locale per Microsoft Edge. Scansiona i link ai file standard presenti nella pagina di un corso Moodle, permette di selezionarli e li raccoglie in un archivio ZIP usando la sessione Moodle già aperta nel browser.

## Installazione in Edge

1. Apri `edge://extensions`.
2. Attiva **Modalità sviluppatore**.
3. Seleziona **Carica non pacchettizzata**.
4. Scegli la cartella che contiene `manifest.json`.
5. Se necessario, aggiorna la pagina del corso Moodle.

Edge consente di caricare localmente un'estensione non pacchettizzata dalla pagina delle estensioni con la modalità sviluppatore attiva. Per istruzioni aggiornate, consulta la [guida Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/getting-started/extension-sideloading).

## Uso

1. Accedi a Moodle e apri il corso.
2. Apri l'estensione dalla barra di Edge.
3. Premi **Scansiona il corso** e controlla la lista.
4. Usa **Tipo di file** per filtrare per estensione, ad esempio `.PDF` o `.PPTX`.
5. Seleziona i file da scaricare. **Seleziona tutti nel filtro** seleziona solo i file mostrati dal filtro attivo; puoi cambiare estensione e aggiungere altri file alla selezione.
6. Premi **Crea ZIP**. Il tool recupera i file selezionati e avvia il download di un unico archivio. Lascia aperta la finestra dell'estensione mentre lavora.
7. Se Edge non avvia il download automaticamente, usa il link **Scarica archivio ZIP** che compare nella pagina Moodle.

L'archivio viene creato nel browser, nella scheda del corso, senza librerie esterne o server. I file sono memorizzati nello ZIP senza ricompressione; i nomi duplicati ricevono un numero progressivo.

## Limiti

- La scansione riguarda la pagina del corso attualmente aperta. Espandi le sezioni del corso prima di scansionare se i materiali non sono ancora caricati nella pagina.
- Il filtro usa l'estensione nel nome o nell'URL del file. Per le risorse Moodle che mostrano solo un link `view.php`, prova a ricavare il tipo dal reindirizzamento senza scaricare il contenuto; se Moodle non lo espone, il file appare sotto **Tipo non rilevato**.
- Gestisce i file Moodle (`pluginfile.php`), le risorse-file e i file elencati nelle cartelle Moodle.
- Il formato ZIP classico usato dal tool supporta archivi fino a 4 GB e 65.535 file. Per archivi molto grandi il browser può richiedere memoria aggiuntiva.
- Non scarica video o link esterni, attività, né contenuti che il tuo account non può aprire.
- Non modifica il corso, non memorizza credenziali e non invia i link a server esterni.
- Il download finale è un singolo archivio `.zip`; i nomi duplicati all'interno dell'archivio ricevono un numero progressivo.

## Permessi

- `activeTab` e `scripting`: scansionare la scheda attiva solo quando apri l'estensione e avvii la scansione.
