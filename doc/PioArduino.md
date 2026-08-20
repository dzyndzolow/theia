# PioArduino w aplikacji Theia

Ten dokument opisuje integrację rozszerzenia **pioarduino IDE** z przeglądarkową aplikacją Theia, poprawny sposób jej uruchamiania oraz rozwiązanie problemu, w którym dodatek jest zainstalowany, ale nie rozpoczyna inicjalizacji.

## Potwierdzona konfiguracja

Podczas diagnozy 17 sierpnia 2026 r. potwierdzono działanie następującego zestawu:

| Element | Wersja lub lokalizacja |
| --- | --- |
| Theia Browser Example | `1.74.1` |
| pioarduino IDE | `1.4.4` |
| PioArduino Core | `6.1.19` |
| Node.js | `24.18.1` |
| Yarn Classic | `1.22.22` (wywoływany wewnętrznie przez skrypt startowy) |
| System | Windows |
| Katalog PioArduino Core | `<repo>/.pioarduino-core` |
| Skrypt startowy | `examples/browser/start-pioarduino.ps1` |

Rozszerzenie jest wdrażane przez Theia w katalogu użytkownika `%USERPROFILE%\.theia\deployedPlugins`. PioArduino Core jest przechowywany oddzielnie w katalogu `.pioarduino-core` repozytorium.

## Poprawne uruchomienie

Po zainstalowaniu zależności i zbudowaniu aplikacji uruchom wariant przeznaczony dla PioArduino:

```powershell
cd D:\theia\examples\browser
npm run start:pioarduino
```

Aplikacja będzie dostępna pod adresem <http://localhost:3000>.

Komendę użytkową uruchamiamy przez `npm`, ale obecna implementacja `start-pioarduino.ps1` deleguje właściwy start do `yarn.cmd`. Do czasu zmiany tego skryptu Yarn Classic musi być dostępny w `PATH`; jego brak jest błędem launchera, a nie aktywacji rozszerzenia.

Nie używaj do tej konfiguracji zwykłego `npm run start:browser`. Dedykowany skrypt ustawia zmienną:

```text
PLATFORMIO_CORE_DIR=<repo>/.pioarduino-core
```

Jest to istotne na Windows, szczególnie gdy ścieżka profilu użytkownika zawiera znaki spoza ASCII. Bez tej zmiennej mechanizm PioArduino może wybrać nieprawidłowy katalog zastępczy zamiast zainstalowanego rdzenia.

Po uruchomieniu Theia otwórz jako workspace bezpośredni katalog projektu zawierający `platformio.ini`. Przykład:

```text
File -> Open Folder -> C:\VS_space\Battery-Emulator
```

## Dlaczego dodatek nie był uruchamiany

Manifest pioarduino IDE zawiera zdarzenie aktywacji:

```json
"activationEvents": [
  "workspaceContains:platformio.ini"
]
```

Dla wzorca bez symboli wieloznacznych Theia sprawdza literalną ścieżkę względem każdego katalogu głównego workspace. Nie przeszukuje w tej sytuacji dowolnie zagnieżdżonych podkatalogów.

W zdiagnozowanej konfiguracji otwarty był workspace:

```text
C:\VS_space
```

Plik konfiguracyjny znajdował się poziom niżej:

```text
C:\VS_space\Battery-Emulator\platformio.ini
```

W katalogu `C:\VS_space` nie było pliku `platformio.ini`, dlatego warunek aktywacji nie został spełniony. Theia uruchamiała host rozszerzeń, ale nie aktywowała kodu pioarduino IDE. Skutkiem był widoczny dodatek bez gotowego PioArduino Core i bez zadań projektu.

## Procedura naprawy

1. Upewnij się, że PioArduino Core jest dostępny:

   ```powershell
   cd D:\theia
   Test-Path .\.pioarduino-core\penv\Scripts\platformio.exe
   & .\.pioarduino-core\penv\Scripts\platformio.exe --version
   ```

   Oczekiwany wynik pierwszej komendy to `True`, a drugiej — numer wersji PioArduino Core.

2. Uruchom Theia dedykowanym skryptem:

   ```powershell
   cd D:\theia\examples\browser
   npm run start:pioarduino
   ```

3. W Theia wybierz `File -> Open Folder` i wskaż katalog, w którym `platformio.ini` znajduje się bezpośrednio w katalogu głównym.

4. Potwierdź przeładowanie okna, jeśli Theia o to poprosi.

5. Otwórz widok pioarduino. Po aktywacji powinny być dostępne PioArduino Home, Project Tasks oraz polecenia Build, Upload i Serial Monitor.

Nie trzeba przenosić `platformio.ini` do nadrzędnego katalogu ani otwierać całego `C:\VS_space`. Właściwą naprawą jest otwarcie katalogu konkretnego projektu jako katalogu głównego workspace.

## Weryfikacja i diagnostyka

### Port 3000

Sprawdź, który proces nasłuchuje na porcie aplikacji:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000
```

Komunikat `EADDRINUSE` oznacza uruchomienie drugiej instancji Theia na tym samym porcie. Nie jest to błąd PioArduino. Zamknij zbędną instancję i pozostaw jeden proces aplikacji.

### Położenie pliku projektu

Sprawdź plik przed otwarciem workspace:

```powershell
Test-Path C:\VS_space\Battery-Emulator\platformio.ini
```

Wynik musi być równy `True`, a otwartym folderem powinien być `C:\VS_space\Battery-Emulator`, nie jego katalog nadrzędny.

### Blokada instalatora

PioArduino zapisuje krótkotrwały klucz `installer-lock` w `%USERPROFILE%\.theia\plugin-storage\global-state.json`. Blokada jest uznawana za aktywną przez 60 sekund. Stary wpis sam przestaje blokować inicjalizację i podczas opisywanej diagnozy nie był przyczyną problemu. Nie należy usuwać całego pliku stanu jako pierwszego kroku naprawy.

### Ostrzeżenia niezwiązane z PioArduino

W logach mogą wystąpić komunikaty o:

- braku natywnego modułu `keytar` i użyciu magazynu poświadczeń w pamięci;
- brakujących katalogach lokalizacji `l10n` innych rozszerzeń;
- ponownej rejestracji poleceń lub konfiguracji języków.

Te ostrzeżenia nie blokują aktywacji pioarduino IDE. Kluczowe jest wystartowanie aplikacji przez `start:pioarduino` i otwarcie właściwego katalogu projektu.

## Podsumowanie przyczyny

| Objaw | Przyczyna | Rozwiązanie |
| --- | --- | --- |
| Dodatek jest zainstalowany, ale się nie inicjalizuje | `platformio.ini` nie znajduje się w katalogu głównym otwartego workspace | Otwórz bezpośrednio katalog projektu zawierający `platformio.ini` |
| PioArduino nie znajduje Core na Windows | Theia uruchomiono bez `PLATFORMIO_CORE_DIR` lub profil zawiera znaki spoza ASCII | Użyj `npm run start:pioarduino` w `examples/browser` |
| Theia kończy start komunikatem `EADDRINUSE` | Port 3000 zajmuje już inna instancja Theia | Pozostaw tylko jedną instancję aplikacji |
| W logach są błędy `keytar` lub `l10n` | Ostrzeżenia innych komponentów | Nie traktuj ich jako przyczyny problemu PioArduino |
