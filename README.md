# Pirate Battle

Shooter naval 2D para navegador, construido com React, TypeScript e PixiJS. O combate roda localmente; ranking e historico usam uma API REST simulada por MSW, consumida por Axios e TanStack Query. O checkout nao depende de servicos privados.

Site em producao: https://pirate-battle-eight.vercel.app/

## Requisitos e setup

- Node.js 20 ou mais recente
- npm 10 ou mais recente
- Chromium para os testes Playwright

```bash
git clone <repository-url>
cd jungle-teste-tecnico
npm ci
npx playwright install chromium
```

Nao ha variaveis obrigatorias. `API_PORT` e opcional e so e usado por `npm run dev:api` (padrao `3001`). O frontend usa MSW para interceptar `/api`, portanto nao depende de servicos privados.

## Comandos

```bash
npm run dev          # desenvolvimento com Vite
npm run dev:api      # API Node opcional
npm run build        # typecheck + build em dist/
npm run preview      # preview do build
npm run lint         # ESLint
npm run typecheck    # verificacao TypeScript strict
npm test             # Playwright desktop e mobile + HTML report
```

Comandos direcionados:

```bash
npx playwright test tests/game.e2e.spec.ts --project=chromium-desktop --workers=1
npx playwright test --project=chromium-mobile --workers=1
npx playwright show-report playwright-report
```

## Controles

| Acao | Teclado | Toque |
| --- | --- | --- |
| Avancar | `W` ou seta para cima | Move forward |
| Recuar | `S` ou seta para baixo | Move backward |
| Rotacionar | `A`/seta esquerda e `D`/seta direita | Rotate |
| Disparo frontal | `Space` | Fire |
| Lateral esquerda | `Q` ou `A` | Broadside left |
| Lateral direita | `E` ou `D` | Broadside right |
| Pausar | Pause | Pause |

Movimento e disparo podem ser combinados. Perder foco ou ocultar a aba pausa a simulacao; a retomada exige acao explicita.

## Gameplay e configuracao

Cada partida recebe uma copia da configuracao no momento de `Play`. As opcoes editaveis sao:

| Parametro | Padrao | Limites |
| --- | ---: | ---: |
| Duracao da sessao | 120 s | 60-180 s |
| Intervalo de spawn | 5 s | 1-30 s |

Os demais valores, incluindo vida 140, velocidade 190, cooldowns das armas, dano, alcance e comportamento de Chaser/Shooter, ficam em `src/game/config/gameConfig.ts`. Inimigos valem 1 ponto quando destruidos pelo jogador; colisao do Chaser nao pontua. A partida termina por tempo ou vida zero.

As opcoes sao persistidas em `localStorage` na chave `pirate-battle:game-config`; JSON invalido volta aos defaults.

## Cenarios de rede

No menu, `NETWORK SCENARIO` seleciona e `RESET MOCK DATA` apaga confirmados e pendentes, restaura `success` e seed `17`.

| Cenario | Efeito |
| --- | --- |
| `success` | respostas normais |
| `empty` / `paginated` | listas vazias / multiplas paginas |
| `slow` / `variable-latency` / `out-of-order` | latencia fixa, variavel ou fora de ordem |
| `timeout` / `connection-failure` | timeout ou falha de conexao |
| `ranking-error` / `history-error` | HTTP 503 no recurso indicado |
| `submit-timeout` / `submit-unavailable` | falha ou resposta tardia no envio |

Para reproduzir: escolha o cenario e abra Ranking ou Match History. Para envio, encerre uma partida com `submit-unavailable` ou `submit-timeout`; a pendencia sobrevive a refresh. Troque para `success` e clique em `PENDING - RETRY`. O `Idempotency-Key` baseado em `matchId` evita duplicacao. Use `RESET MOCK DATA` para restaurar o estado. O seed de uma partida pode ser fixado com `/?seed=17`.

## Dados e contratos

`MatchRecord` contem `matchId`, `playerId`, data ISO, score, duracao, `endReason` e `GameConfig`. `RankingEntry` adiciona `playerName`; `PendingMatchRecord` adiciona status e erro. Os endpoints sao `GET /api/ranking?config=...`, `GET /api/matches?playerId=...` e `POST /api/matches`.

Confirmados ficam em `pirate-battle:mock-matches`, pendentes em `pirate-battle:pending-matches` e o jogador em `pirate-battle:player-id`. A API Node opcional grava em `server/data/matches.json` e tambem respeita idempotencia.

## Relatorios e arquitetura

- [Relatorio de testes](docs/testing-report.md): comandos, cobertura E2E, artefatos e limitacoes.
- [Relatorio de profiling](docs/profiling-report.md): procedimento, telemetria de FPS e memoria.
- [Arquitetura](ARCHITECTURE.md): React/PixiJS, simulacao, colisoes, recursos, cache e pendencias.

Os artefatos HTML e traces ficam em `playwright-report/` e `test-results/` apos `npm test`.

## Retrospectiva do teste tecnico

Tive dois dias para realizar o teste tecnico, com inicio as 21h23 da quinta-feira, dia 17.

Se eu fizesse o teste novamente, nao escolheria um mapa procedural. Os tiles disponibilizados nao sao perfeitos para esse tipo de geracao, e adaptar a geracao procedural para obter um resultado consistente levaria mais tempo do que a abordagem adotada.

O uso de IA foi feito para auxiliar no desenvolvimento e nos testes, usando majoritariamente o GitHub Copilot e o GPT.

Eu gostaria de ter usado os spritesheets para otimizar o carregamento e o uso de recursos, mas, devido ao tempo curto, trabalhar com os sprites separados foi mais rapido para concluir a implementacao.

Tenho conhecimento dos bugs relacionados a geracao das ilhas, mas nao tive tempo suficiente para soluciona-los nesta entrega.

## Limites conhecidos

O ranking e o historico sao locais e simulados; a API Node opcional nao substitui um backend multiusuario. A telemetria de FPS mede o loop do renderer, nao substitui um profiler nativo do navegador. O build tambem pode emitir o aviso de chunk minificado maior que 500 kB.
