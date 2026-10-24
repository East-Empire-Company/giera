# 🎮 Recenzja testerska: Ziemek (lat 7) — Raport i wdrożone poprawki

**Data**: 2026-10-24  
**Tester**: Ziemek (lat 7) & Gniewko (lat 4)  
**Kategoria**: Usability, Gameplay, Visuals, Accessibility dla dzieci nieczytających  

---

## 1. Zgłoszone problemy w pierwszej rundzie (Sweep 1)

| # | Zgłoszenie testera | Wpływ na rozgrywkę | Status |
|---|---|---|---|
| 1 | **„Pień drzewa wbity w oko na starcie”** — kamera respi się 5m za graczem dokładnie wewnątrz pnia dębu. | P1 nic nie widzi przy starcie, musi iść na oślep. | **NAPRAWIONE** — punkt startowy przeniesiony na otwartą polanę `(3, spawnY, 5)` z domyślnym obrotem kamery na łąkę. |
| 2 | **„Papuga to łysy gość w czerwonej bluzie”** — brak modelu ptaka, model ludzki zamiast papugi. | Dziecko czuje się oszukane brakiem obiecanej papugi. | **NAPRAWIONE** — zbudowano dedykowany model 3D papugi (żółty tułów, skrzydła cyan, ogon szmaragdowy, pomarańczowy dziób, oczka) na drewnianej żerdzi. |
| 3 | **„Po co miecz jak nie ma potworów?”** — brak celu dla walki/ataków mieczem. | Nuda, brak aktywności rodem z Roblox/Minecraft. | **NAPRAWIONE** — dodano sprężynującą kukłę treningową (`TrainingDummy`) na łące. Ciosy mieczem bujają kukłę i sypią iskrami. |
| 4 | **„Klocki po prostu znikają”** — brak wypadających przedmiotów jak w Minecraft/Roblox. | Brak satysfakcji z kopania. | **NAPRAWIONE** — wdrożono `ItemDropManager`. Rozbity blok podskakuje w powietrzu jako wirujący mini-sześcian i leci do gracza z dźwiękiem `dzyń!`. |
| 5 | **„Dymek [E] zasłania całe okno rzemiosła”** — żółty komunikat rozmowy nachodzi na modal. | Przesłania receptury w ekwipunku. | **NAPRAWIONE** — dymek podpowiedzi znika natychmiast przy otwarciu jakiegokolwiek okna. |
| 6 | **„Odwrócone sterowanie kamerą”** — ruch myszką w prawo obracał kamerę w lewo, a w dół podnosił w górę. | Dziecko gubi się w przestrzeni, choroba lokomocyjna. | **NAPRAWIONE** — ujednolicono obrót kamery w `rotateCamera` (naturalna orientacja: prawo=prawo, góra=niebo, dół=ziemia). |
| 7 | **„Gracze nie umieją czytać!”** — napisy tekstowe w pasku, celach i rzemiośle. | Dzieci 4 i 7 lat nie potrafią obsłużyć menu. | **NAPRAWIONE** — wdrożono 100% wizualny interfejs: 32px kafelki bloków w hotbarze, równania obrazkowe w rzemiośle (`[🪵×3] ➔ [🧱×4]`), gwiazdki postępu (`★`). |

---

## 2. Weryfikacja w przeglądarce (Sweep 2)

- **Screenshoty dowodowe**:
  - `01-boot.png`: Otwarta słoneczna polana, widok na tarczę treningową i jezioro, brak pnia w kadrze.
  - `02-split.png`: Dzielony ekran dla 2 graczy na kanapie (Ziemek i Gniewko).
  - `04-craft-panel.png`: Wizualne receptury z obrazkami surowców i świecącym zielonym przyciskiem `🔨 Rób`.
  - `05-xbox-pad-map.png`: Kolorowa mapa przycisków pada Xbox z ikonami czynności (A, X, Y, RT, LT).
- **Głosy postaci**:
  - Zaimplementowano odtwarzanie polskich kwestii dubbingowych dla Ziemka i Gniewka przy włączeniu split-screena i zaliczaniu zadań.
- **Płynność**:
  - 60 FPS w trybie 1 gracza, 60 FPS w trybie split-screen (zmierzone w ANGLE/Metal na macOS arm64).
