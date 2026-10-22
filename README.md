# Logbook

Dziennik treningowy na Androida. Zapisujesz ćwiczenia, serie, ciężar i powtórzenia,
a aplikacja liczy czas treningu, serie i objętość, rysuje wykres postępu dla każdego
ćwiczenia, pokazuje heatmapę treningów (im więcej serii, tym jaśniejszy kwadrat),
rekordy (PR), partie mięśniowe, dni treningowe i wagę ciała. Opcjonalnie dociąga
tętno i kalorie z opaski (Fitbit / Google Health przez Health Connect).

Wszystkie dane zostają na telefonie. Bez konta, bez serwera, bez reklam.

---

## Instalacja na telefonie (jednorazowo, ok. 10 minut)

APK buduje się automatycznie na GitHubie (GitHub Actions), więc nie potrzebujesz
Android Studio. Potrzebujesz tylko konta GitHub i gita na komputerze.

### 1. Utwórz puste repozytorium

[github.com/new](https://github.com/new) → nazwa np. `logbook` → **Public** → bez README → **Create repository**.

### 2. Dodaj klucz podpisu jako dwa sekrety

W repozytorium: **Settings → Secrets and variables → Actions → New repository secret**.
Wartości są w pliku `GITHUB-SECRETS.txt` (dostałeś go razem z projektem):

| Name | Secret |
| --- | --- |
| `ANDROID_KEYSTORE_PASSWORD` | hasło z pliku |
| `ANDROID_KEYSTORE_BASE64` | długa linia z pliku |

Ten klucz podpisuje każdą wersję aplikacji. Dzięki temu aktualizacje instalują się
na poprzednią wersję i nie tracisz danych. Nie wrzucaj go do repozytorium
(`.gitignore` już to blokuje) i trzymaj kopię `logbook-release.keystore` w bezpiecznym miejscu.

### 3. Wypchnij projekt

W rozpakowanym folderze `logbook`:

```bash
git init -b main
git add .
git commit -m "Logbook"
git remote add origin https://github.com/TWOJ_LOGIN/logbook.git
git push -u origin main
```

Jeśli masz [GitHub CLI](https://cli.github.com), kroki 1–3 to:

```bash
git init -b main && git add . && git commit -m "Logbook"
gh repo create logbook --public --source . --remote origin
gh secret set ANDROID_KEYSTORE_PASSWORD        # wklej hasło
gh secret set ANDROID_KEYSTORE_BASE64          # wklej długą linię
git push -u origin main
```

### 4. Poczekaj na build (ok. 5 minut)

Zakładka **Actions → Android APK**. Gdy zrobi się zielona, w **Releases** pojawi się
`Logbook 1.0.x` z plikiem `Logbook.apk`.

### 5. Zainstaluj na telefonie

1. Na telefonie otwórz `https://github.com/TWOJ_LOGIN/logbook/releases/latest`.
2. Stuknij **Logbook.apk** i pobierz.
3. Otwórz pobrany plik. Android zapyta o zgodę na instalowanie aplikacji z tego źródła
   (Chrome albo Pliki) → zezwól → **Zainstaluj**.
4. Jeśli Play Protect pokaże ostrzeżenie o nieznanym deweloperze, wybierz
   **Zainstaluj mimo to**. To Twoja własna aplikacja, podpisana Twoim kluczem.

---

## Aktualizacje

Każdy `git push` na `main` buduje nową wersję i publikuje ją jako najnowsze wydanie.
Pobierasz nowy `Logbook.apk` z tego samego linku i instalujesz na starą wersję.
Dane zostają.

## Tętno i kalorie z opaski (Fitbit Air / Google Health)

Logbook czyta z **Health Connect** dane, które zapisuje tam aplikacja Google Health:
tętno i kalorie dopisuje do każdego treningu (w oknie od startu do końca), a sen, HRV,
tętno spoczynkowe, oddech, kroki i treningi z innych aplikacji służą do gotowości.

Jednorazowo:

1. W aplikacji **Google Health**: **Connections → Partner apps → Sync your favorite health
   apps → Set up**. Włącz synchronizację z Health Connect (co najmniej tętno i kalorie)
   i zezwól na dane historyczne i działanie w tle.
2. W Logbooku: **Settings → Heart rate → Connect** → zezwól na wszystkie typy danych
   (i dostęp do starszych danych, jeśli telefon o to zapyta).

Potem dane dociągają się same przy każdym otwarciu aplikacji. Opaska synchronizuje się
z Google Health z opóźnieniem, więc tętno świeżego treningu może pojawić się po chwili;
w szczegółach treningu jest przycisk **Check again**.

Co z tego wychodzi:

- w szczegółach treningu: wykres tętna z zaznaczonymi ćwiczeniami i seriami, średnie i
  maksymalne tętno, kalorie, czas w strefach i „Load” (minuty w strefie × numer strefy);
- heatmapa: jasność kwadratu = Load (albo kalorie, albo serie, do wyboru w Settings);
  dni bez danych z opaski nadal liczą się po seriach;
- w Stats: kalorie i Load na tydzień oraz średnie tętno na trening.

Strefy liczą się od tętna maksymalnego z ustawień (domyślnie 190; orientacyjnie
208 − 0,7 × wiek). Bez zgody na starsze dane Health Connect udostępnia tylko dane
od 30 dni przed pierwszym połączeniem.

## Gotowość treningowa (Readiness)

Na ekranie głównym: liczba 1–100, pionowy pasek i zalecenie na dziś
(**Go heavy** 80+, **Normal session** 60–79, **Keep it light** 40–59, **Recover** < 40),
do tego podpowiedź, który z Twoich treningów najlepiej pasuje do świeżych mięśni.

Z czego się liczy (każdy sygnał porównany z Twoją normą: mediana i typowy rozrzut z 60 dni):

| Sygnał | Waga bazowa | Skąd |
| --- | --- | --- |
| HRV (ostatnia noc + trend 7 dni, skala log) | 32% | Health Connect |
| Sen (długość vs potrzeba, dług snu, sen głęboki + REM, regularność) | 28% | Health Connect |
| Obciążenie treningowe (forma: średnie 7 i 42 dni, wczorajszy skok) | 22% | treningi z Logbooka + inne aplikacje (rower, bieg) + kroki |
| Tętno spoczynkowe | 18% | Health Connect |
| Częstość oddechu | tylko alarm | Health Connect |
| Świeżość mięśni (zmęczenie z serii, półokres ~1 doba, nogi dłużej) | do zaleceń | Logbook |

Bezpieczniki: tętno spoczynkowe +5 i HRV wyraźnie w dół → max 35; wyższy oddech
(+1/min) razem z tętnem → max 30; poniżej 5 h snu → max 50; samo obciążenie bez danych
z opaski → max 79. Po ~20 treningach z danymi algorytm sprawdza, który sygnał najlepiej
przewidywał Twoje wyniki na sztandze (e1RM vs ostatnie sesje) i podbija jego wagę
(maks. +40%, min. −20%). To nie jest porada medyczna.

## Kopia zapasowa

**Ustawienia (ikona suwaków na ekranie głównym) → Export backup** tworzy plik `.json`
i otwiera menu udostępniania, np. żeby zapisać go na Dysku Google.
**Restore from backup** wczytuje taki plik na nowym telefonie.
Android dodatkowo robi automatyczną kopię danych aplikacji, jeśli masz włączoną kopię Google.

## Wersja webowa (opcjonalnie)

Ta sama aplikacja może działać jako aplikacja webowa (PWA), np. do podglądu na komputerze.
Włącz raz: **Settings → Pages → Source: GitHub Actions**, potem uruchom ponownie workflow
**Web version (GitHub Pages)**. Adres: `https://TWOJ_LOGIN.github.io/logbook/`.
Dane w wersji webowej są osobne od danych w aplikacji na telefonie.

---

## Dla programisty

TypeScript + React, budowane Vite, spakowane do natywnej aplikacji Android przez Capacitor.

```bash
npm install
npm run dev            # podgląd w przeglądarce
npm test               # testy logiki (statystyki, rekordy, formaty)
npm run build          # build produkcyjny do dist/
npm run android:sync   # build + skopiowanie do projektu android/
npx cap open android   # otwarcie w Android Studio (opcjonalnie)
```

| Ścieżka | Co tam jest |
| --- | --- |
| `src/lib/store.ts` | dane, zapis (pamięć WebView + plik w pamięci aplikacji), kopie |
| `src/lib/stats.ts` | serie, objętość, szacowany 1RM (Epley), rekordy, heatmapa, tygodnie |
| `src/lib/heart.ts` | tętno: przetwarzanie próbek, strefy, Load, ćwiczenia na osi czasu |
| `src/lib/health.ts` | Health Connect (plugin `@capgo/capacitor-health`): uprawnienia i synchronizacja |
| `src/lib/wellness.ts` | sen, HRV, tętno spoczynkowe, oddech i kroki przypisane do poranków |
| `src/lib/readiness.ts` | algorytm gotowości, świeżość mięśni, dopasowanie wag do Twoich wyników |
| `scripts/patch-health.mjs` | po `npm install` dodaje do pluginu sumowanie kalorii całkowitych |
| `src/lib/exercises.ts` | biblioteka ćwiczeń i partie mięśniowe |
| `src/components/charts.tsx` | wykresy SVG: linia, słupki, heatmapa, tętno, sparkline |
| `src/screens/` | ekrany: Home, History, Stats, Exercises, trening, waga, ustawienia |
| `android/` | projekt Androida (ikony, motyw, podpis) |
| `.github/workflows/` | build APK i opcjonalna wersja webowa |
| `scripts/icons.mjs` | generator ikon (`npm i --no-save sharp && node scripts/icons.mjs`) |

Font: Instrument Sans (SIL Open Font License), dołączony lokalnie.
