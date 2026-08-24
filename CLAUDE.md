# Delve — poznámky k vývoju a distribúcii

Repo: https://github.com/FilipBambura/Delve (default branch `main`)

## Čo plugin robí

Delve je read-only AI research agent žijúci vo vaulte. Dostane jednorazovú úlohu, potom
autonómne a iteratívne skúma vault (štruktúru, tagy, obsah, linky, backlinky, prílohy)
volaním nástrojov cez Gemini Interactions API (function calling + google_search /
code_execution / url_context), a na konci vyprodukuje štruktúrovaný report. Report sa
exportuje ako zip priamo do vaultu — samostatnou, explicitnou UI akciou mimo nástrojov
agenta, takže agent samotný nemá v kóde žiadnu cestu k zápisu alebo mazaniu čohokoľvek
vo vaulte.

## Distribúcia cez BRAT

Plugin sa neinštaluje cez oficiálny Obsidian Community store, ale cez plugin
**BRAT** (Beta Reviewer's Auto-update Tester). BRAT nesťahuje obsah repozitára
priamo — sťahuje **priložené súbory (assets) z najnovšieho GitHub Release**:

- `main.js`
- `manifest.json`
- `styles.css`

Preto musí mať **každý** release tieto tri súbory priložené, inak BRAT
inštaláciu alebo update zlyhá.

## Ako spraviť release

1. Zvýš verziu v `manifest.json` a `package.json` (napr. cez `npm version patch`,
   ktorý zavolá `version-bump.mjs` a aktualizuje aj `versions.json`).
2. Commitni zmenu verzie.
3. Vytvor git tag zodpovedajúci verzii a pushni ho:

   ```
   git tag -a X.Y.Z -m "X.Y.Z"
   git push origin X.Y.Z
   ```

4. Pushnutie tagu spustí GitHub Actions workflow `.github/workflows/release.yml`,
   ktorý automaticky:
   - nainštaluje závislosti a spustí `npm run build` (produkčný esbuild build),
   - vytvorí GitHub Release pomenovaný podľa tagu, označený ako **prerelease**,
     s auto-generovanými release notes,
   - priloží `main.js`, `manifest.json`, `styles.css` ako release assets.

5. Workflow beží pod vstavaným `secrets.GITHUB_TOKEN` (GitHub Actions ho poskytuje
   automaticky) — **na bežný release nie je potrebný žiadny osobný access token
   (PAT)**. Stačí mať push prístup do repozitára.

## Bezpečnostná hranica agenta

Agent má technicky (nie len promptom) obmedzenú množinu nástrojov na presne 15
read-only operácií (`src/gemini/tools.ts`), vynútenú whitelist dispatcherom v
`src/vault/read-only-vault-service.ts` — neznámy názov nástroja vráti
`{ ok: false, error: "Tool not permitted" }`, nikdy sa nevykoná. Export reportu do
zipu je zámerne mimo tejto sady nástrojov, je to samostatná UI akcia.
