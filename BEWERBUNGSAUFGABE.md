# Coding Challenge: Laborsuche DACH

## Kontext

Wir betreiben ein Coaching-Unternehmen im Gesundheitsbereich. Unsere Kunden brauchen regelmäßig zwei Arten von Untersuchungen:

1. **DEXA Body Composition Scan** — Messung von Körperfettanteil, Muskelmasse und Knochendichte per Ganzkörper-Röntgen. Wichtig: Nicht jede Praxis die DEXA anbietet macht auch Body Composition — viele bieten nur Knochendichtemessung an.
2. **Blutuntersuchung als Selbstzahler** — Labore bei denen man ohne ärztliche Überweisung Blut abnehmen und analysieren lassen kann.

Es gibt keine zentrale Übersicht wo man solche Anbieter in Deutschland, Österreich und der Schweiz findet. Wir wollen eine interaktive Karte bauen, die unseren Kunden genau das zeigt.

## Aufgabe

Baue eine Webanwendung die auf einer Karte Labore und Praxen im DACH-Raum anzeigt, bei denen man:

- einen **DEXA Body Composition Scan** machen kann (nicht nur Knochendichte!)
- eine **Blutuntersuchung als Selbstzahler** (ohne Überweisung) bekommt

### Teil 1: Daten beschaffen

Recherchiere und sammle Anbieter für mindestens **eine Region**. Pro Anbieter sollten mindestens folgende Informationen erfasst werden:

- Name der Praxis / des Labors
- Kategorie (DEXA / Blutlabor)
- Angebotene Leistungen (Body Composition, Knochendichte, Bluttest Selbstzahler)
- Adresse (Straße, PLZ, Ort)
- Koordinaten (Lat/Lng)
- Kontakt (Telefon, Website)
- Selbstzahler möglich? (ja/nein)
- Preise (falls öffentlich verfügbar)

**Wie du an die Daten kommst, ist dir überlassen.** Ob manuell recherchiert, per Web Scraping, über APIs oder eine Kombination — zeig uns deinen Ansatz und dokumentiere ihn.

**Wichtig:** Datenqualität > Datenmenge. Lieber 100 verifizierte Einträge als 500 ungeprüfte.

### Teil 2: Interaktive Karte

Baue eine Kartenansicht die die gesammelten Daten visualisiert:

- Karte zentriert auf die gewählte Region
- Marker pro Standort, farblich unterschieden nach Kategorie
- Popup oder Sidebar mit Details beim Klick auf einen Marker
- Filtermöglichkeit (Alle / nur DEXA / nur Blutlabor)
- Responsive (Desktop + Mobil nutzbar)

### Teil 3: Datenstruktur

Entwirf ein sauberes Datenformat (JSON, Datenbank-Schema, o.ä.) das:

- Alle erfassten Informationen abbildet
- Erweiterbar ist (neue Felder, neue Kategorien)
- Sich für eine API eignet

## Rahmenbedingungen

- **Tech-Stack:** Frei wählbar. Nutze was du für die beste Lösung hältst.
- **Zeitrahmen:** Nimm dir die Zeit die du brauchst, aber plane realistisch. Wir erwarten kein fertiges Produkt — wir wollen sehen wie du an das Problem herangehst.
- **Abgabe:** Git-Repository (GitHub/GitLab) mit README das erklärt:
  - Wie man das Projekt lokal startet
  - Welche Entscheidungen du getroffen hast und warum
  - Was du bei mehr Zeit noch machen würdest

## Was wir bewerten

| Kriterium            | Was wir uns anschauen                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| **Datenqualität**    | Sind die Einträge korrekt? Wurde zwischen DEXA Body Comp und reiner Knochendichte unterschieden? |
| **Herangehensweise** | Wie wurde recherchiert/gescrapt? Ist der Ansatz nachvollziehbar und reproduzierbar?              |
| **Code-Qualität**    | Lesbar, strukturiert, keine Überengineering                                                      |
| **Datenmodell**      | Durchdachtes Schema, sinnvolle Felder, erweiterbar                                               |
| **Kartenansicht**    | Funktioniert, ist benutzbar, sieht ordentlich aus                                                |
| **Dokumentation**    | README erklärt Setup und Entscheidungen                                                          |

## Bonus (optional, kein Muss)

- Automatisierter Scraping-Ansatz der auf weitere Regionen skalierbar wäre
- Clustering bei vielen Markern auf der Karte ************\*\*************
- Geocoding von Adressen zu Koordinaten
- Docker-Setup zum einfachen Starten
- Datenvalidierung / Duplikat-Erkennung

## Fragen?

Falls etwas unklar ist, frag nach. Das gehört dazu.
