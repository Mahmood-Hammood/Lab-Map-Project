## Lab Map – Laborsuche DACH

Interaktive Karte für DEXA-Body-Composition-Scans und Blutuntersuchungen als Selbstzahler im DACH-Raum. Dieses Projekt ist als Lösung für die Coding Challenge _"Laborsuche DACH"_ entstanden.

Der aktuelle Stand fokussiert sich auf Deutschland (mit besonderem Fokus auf Niedersachsen) als Beispielregion, ist aber so aufgebaut, dass weitere Regionen und Länder ergänzt werden können.

---

## 1. Projektüberblick

- **Ziel**: Übersichtliche Karte mit Such- und Filtermöglichkeiten für Praxen/Labore, die
  - DEXA _Body Composition_ (nicht nur Knochendichte) anbieten
  - Blutuntersuchungen für Selbstzahler ohne Überweisung anbieten
- **Frontend**: Statische Web-App auf Basis von HTML/CSS/JavaScript (Leaflet + Marker-Clustering)
- **Datenbeschaffung**: Node.js zur automatisierten Abfrage von Anbietern + manueller/halbautomatischer Verifikation
- **Datenablage**: JSON-Dateien im Verzeichnis `data-collection` (zum direkten Einlesen ins Frontend)

## Hinweis zu meinem Hintergrund & Tools

- Ich habe keine Erfahrung mit Node.js und habe bisher **keine Erfahrung mit Node.js**. In JavaScript, HTML und CSS habe ich nur **grundlegende Kenntnisse**.
- Für dieses Projekt habe ich bewusst **GitHub Copilot (in Visual Studio Code)** als Unterstützung eingesetzt. Viele Code-Vorschläge (vor allem bei komplexeren Funktionen und der Struktur) stammen von Copilot; ich habe sie verstanden, angepasst und in das Gesamtkonzept integriert.
- Mir ist wichtig, transparent zu sein: Ich bewerbe mich **nicht** als Senior-Web-Entwickler, sondern als jemand, der strukturiert arbeitet, ehrlich mit seinem Wissensstand umgeht und moderne Tools nutzt, um schneller zu lernen und bessere Ergebnisse zu erzielen.

## Ich bewerbe mich als KI-Entwickler/ KI-Engineer / KI Automation Engineer / RAG and LLMs Engineer ....

## 2. Lokales Setup

Du kannst das Projekt entweder direkt mit Node.js oder via Docker starten.

### 2.1 Voraussetzungen

- Node.js **>= 18** (siehe `engines` in `package.json`)
- npm
- Optional: Docker

### 2.2 Start direkt: Right click auf index.html file >> open with live server

### 2.4 Start mit Docker

## Start mit Docker

```bash
git clone https://github.com/Mahmood-Hammod/Lab-Map-Project
cd Lab-Map-Project
docker build -t lab-map:latest .
docker run -d -p 8080:80 lab-map:latest

Die App unter http://localhost:8080 erreichbar
---

## 3. Datenbeschaffung & Pipeline

Die Datenbeschaffung ist so aufgebaut, dass sie reproduzierbar über Node.js-Skripte ausgeführt werden kann. Alle relevanten Dateien liegen in:

- `config/queries.json` – Suchbegriffe
- `scripts/` – Skripte zur Abfrage, Vorfilterung und Verifikation
- `data-collection/` – Zwischenergebnisse und final verifizierte Datensätze

### 3.1 Skripte

In `package.json` sind folgende Hilfsskripte definiert:

- `npm run fetch:places` – rohes Einsammeln von möglichen Anbietern basierend auf den Such-Queries (Google Places API)
- `npm run prefilter` – Vorfilterung der Rohdaten (z. B. Duplikate, offensichtliche Nicht-Treffer)
- `npm run verify` – weitere Verengung/Verifikation der Treffer (z. B. nach Keywords in Leistungen/Website)
- `npm run build:data` – führt die drei obigen Schritte in Reihenfolge aus
- `npm run test:places` – Tests/Checks der Abfragen (z. B. Stichproben für Städte)

**Wichtig:** Im abgegebenen Repository sind alle diese Skripte **standardmäßig deaktiviert** (siehe `LABMAP_ENABLE_DATAPIPELINE` in den Skripten). Sie dienen nur zur Dokumentation der Herangehensweise und führen ohne explizite Aktivierung keine API-Calls oder Scraping-Jobs mehr aus.

Je nach API werden Zugangsdaten/Schlüssel über Umgebungsvariablen (z. B. `.env`) in den Skripten aus `scripts/` erwartete. Details dazu sind im Code dokumentiert.

### 3.2 Datenstände

Beispiele für erzeugte Datensätze:

- `data-collection/germany_providers.json` – Die Daten wurden von der Google Places API abgerufen.
- `data-collection/germany_prefiltered.json` – Rohdaten nach erster Vorfilterung.
- `data-collection/germany_verified.json` – Datensatz für die Karte (nur verifizierte Einträge).
- `data-collection/niedersachsen_*.json` – Fokusregion Niedersachsen, das war die erste Schrit, nur für probieren (Roh-/Prefilter-/Verified-Dateien)

Die Datei `germany_verified.json` wird vom Frontend geladen und in eine einheitliche interne Struktur gemappt.

**Datenqualität**

- Fokus auf **Qualität vor Menge**: lieber weniger Einträge, die möglicherweise DEXA Body Composition bzw. Selbstzahler-Blutuntersuchungen anbieten.
- Mehrstufiger Prozess: Rohdaten → Vorfilterung → (teilweise) manuelle/halbautomatische Verifikation.

---

## 4. Datenmodell

Intern wird jeder Anbieter im Frontend auf eine einheitliche Provider-Struktur gemappt (siehe `loadProviders()` in `script.js`):

- `id` – eindeutige ID (z. B. `place_id`)
- `name` – Praxis-/Laborname
- `address` – formatierte Adresse (Straße, PLZ, Ort)
- `latitude`, `longitude` – Geokoordinaten (Lat/Lng)
- `type` – Kategorie: `dexa` oder `blood` (Fallback: `unknown`)
- `city` – Stadt/Ortsbezug, falls vorhanden
- `phone` – Telefonnummer (optional)
- `website` – Website-URL (optional)
- `services` – Liste von angebotenen Leistungen mit Preisinformationen:
  - `name` – z. B. "DEXA Body Composition" oder "Blood test (self-pay)"
  - `price` – Preissnippet aus der Datenquelle (falls verfügbar)
  - `currency` – aktuell `EUR`
  - `selfPay` – `true`, wenn explizit als Selbstzahler-Leistung klassifiziert

Dieses Schema ist bewusst API-freundlich gehalten, so dass sich die JSON-Dateien später leicht durch eine REST- oder GraphQL-API ersetzen lassen.

---

## 5. Kartenansicht & Features

Die eigentliche Kartenlogik befindet sich in `script.js` und nutzt Leaflet:

- Karte zentriert auf Deutschland (Zoom-Level für Überblick)
- Farblich unterschiedliche Marker je Kategorie (`dexa` / `blood`)
- Marker-Clustering bei hoher Dichte
- Klick auf Marker öffnet Detailansicht in einer Sidebar (Name, Adresse, Kontakt, Leistungen & Preise)
- Filter oben (Alle / nur DEXA / nur Blutlabor)
- Freitextsuche (Name/Adresse)
- Suche per Postleitzahl + Radius
  - Geocoding via Nominatim (OpenStreetMap)
  - Entfernung mit Haversine-Formel berechnet
- Responsive Layout mit Sidebar, die auf kleineren Screens ein- und ausklappbar ist

---

## 6. Wichtige Entscheidungen

- **Statische JSON-Dateien statt Datenbank**
  - Für die Challenge reicht eine statische Bereitstellung;.
- **Trennung von Sammlung/Verarbeitung und Visualisierung**
  - Node.js-Skripte im Backend-Ordner (`scripts/`, `data-collection/`) und schlanke Frontend-Visualisierung.
- **Klares, erweiterbares Datenmodell**
  - Einheitliche Provider-Struktur, in der neue Felder (z. B. Öffnungszeiten, zusätzliche Untersuchungen) leicht ergänzt werden können.

---

## 7. Was ich mit mehr Zeit noch machen würde

- **Weitere Regionen erschließen**: Österreich und Schweiz mit eigenem Scraping/Recherche-Setup.
- **Admin-Interface**: Web-UI zum manuellen Review, Korrigieren und Freigeben von Einträgen.
- **Persistente API**: Ablage der Provider in einer Datenbank + Read-API, anstatt statischer JSON-Dateien.
- **Bessere Preisstruktur**: Strukturierte Preise (z. B. `basePrice`, `followUpPrice`, "inkl./exkl. Auswertung"), statt nur Textsnippets.
- **Mehr UX-Features**: Routing-Links ("mit Google Maps öffnen"), Merklisten, Export von Standorten.

## Sonstiges

**Datenqualität**

- Leider konnte ich die Körperzusammensetzung auch mit der manuellen Überprüfung nicht eindeutig bestätigen. Vielleicht können wir zukünftig andere Methoden dafür nutzen. Beispielsweise könnten Kliniken die Möglichkeit erhalten, direkt in der App ein Formular/Card auszufüllen, in dem sie ihre Leistungen, Preise usw. detailliert beschreiben.

### Alternative KI-basierte Variante (Idee)

- **Chatbot auf Klinik-Dokumenten (PDF) + RAG**  
  Als Ergänzung zur Karte könnte es einen Chatbot geben, der direkt auf den Original-Dokumenten der Kliniken arbeitet: z. B. PDFs oder andere Unterlagen mit Leistungen, Preisen, Öffnungszeiten und Adressen. Diese Dokumente würden in Text umgewandelt, in Vektoren (Embeddings) gespeichert und über Retrieval (RAG) durchsucht. Nutzer geben ihre Adresse/PLZ an und stellen Fragen wie „Wo bekomme ich den günstigsten Selbstzahler-Bluttest in meiner Nähe?“ oder „Welche Klinik bietet DEXA inklusive Auswertung an?“. Der Chatbot liest die Inhalte der PDFs, kombiniert sie mit den Adressinformationen aus den Dokumenten und kann so Preise, Leistungen, Entfernungen und ggf. Wartezeiten vergleichbar machen.

- Man könnte sich fragen: „Warum nutzt der Benutzer nicht einfach ChatGPT und lässt es mit Tool-Calling im Internet recherchieren?“

**Antwort: Genau hier liegen zwei wichtige Probleme, die wir in der Praxis gesehen haben:**

1. Viele Kliniken veröffentlichen ihre Preise gar nicht oder nur sehr unvollständig auf der Website.
2. Noch kritischer: Kliniken schreiben oft nicht eindeutig, ob sie wirklich **DEXA Body Composition** anbieten oder nur eine reine Knochendichtemessung.

## Das bedeutet: Ein reines LLM wie ChatGPT würde am Ende auch nur auf denselben unsauberen Webdaten arbeiten und müsste faktisch wieder das machen, was wir mit **Google Places API + Scraping + Verifikation** bereits explizit und kontrolliert umgesetzt haben.
