# Higiena artefaktów runtime

`.pioarduino-core/appstate.json` jest lokalnym stanem instalacji PlatformIO i
może zmieniać się po uruchomieniu aplikacji. Nie należy mieszać tych zmian z
funkcjonalnym commitem bez wyraźnej potrzeby odtworzenia stanu środowiska.

`.pioarduino-core/.cache/http/` jest cache'em odpowiedzi HTTP. Jest ignorowany
przez Git i nie jest częścią builda ani formatu mapy zmiennych. Istniejące,
historycznie śledzone pliki pod `.pioarduino-core/.cache/downloads/` pozostają
nietknięte; ich ewentualne wycofanie wymaga osobnej decyzji, ponieważ mogłoby
zmienić lokalne działanie PIOArduino.

Przed commitem funkcjonalnym wykonawca powinien sprawdzić:

```powershell
git status --short
git diff --check
git check-ignore -v .pioarduino-core/.cache/http/example
```

Jeżeli `appstate.json` jest zmodyfikowany wyłącznie przez uruchomienie
środowiska, pozostawia się go poza commitem funkcjonalnym.
