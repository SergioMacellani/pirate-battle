# Pirate Battle Architecture

## Limites de runtime

`src/main.tsx` cria o `QueryClient`, inicia o worker MSW e monta `App` sob
`StrictMode`. `App` controla as telas `menu`, `options`, `ranking`, `history`,
`game`, `pause`, `death` e `result`. React possui menus, formularios, HUD,
dialogs e navegacao; PixiJS possui canvas, mapa, navios, projeteis e efeitos.

```text
React App
  | config, touch input, pause, telemetry
  v
GameCanvas -> GameRenderer -> GameSimulation
                  |              |
                  |              +-- GameSnapshot / MatchResult
                  v
             Pixi Application

React Query -> Axios -> /api -> MSW handlers -> localStorage fixtures
```

`GameCanvas` cria um `GameRenderer` por montagem e chama `destroy` ao sair.
Esse ciclo suporta as montagens adicionais do Strict Mode. A simulacao nao
importa React, PixiJS, Axios ou TanStack Query.

## Ciclo da simulacao

`GameRenderer` cria a aplicacao Pixi, carrega mapa e jogador, configura
`resolution` com `devicePixelRatio` e agenda `requestAnimationFrame`. Cada
frame converte teclado e toque em `GameInput`, limita o delta com
`clampFrameDelta`, chama `GameSimulation.update(deltaSeconds)` e atualiza os
objetos Pixi. React recebe snapshot e telemetria no maximo a cada 250 ms, sem
renderizacao React por frame.

O delta da simulacao e limitado a 100 ms. Tempo, cooldowns, movimento, dano e
spawn usam segundos, nao contagem de frames. A simulacao so atualiza na fase
`running`; `idle`, `paused` e `finished` ficam congeladas. O construtor usa
`structuredClone(config)`, criando um snapshot da configuracao por partida.

Ao mudar de tela, `App` passa `paused` ao renderer. O fim por tempo ou morte
produz um `MatchResult`; sair da partida e abandono e nao gera registro.

## Mapa e colisoes

`src/game/map/mapLayouts.json` descreve a geometria visual dos tiles e ilhas.
`MapRenderer` desenha agua, shoreline, ilhas e fornece retangulos de colisao.
`GameSimulation` recebe esses retangulos e tambem constroi uma grade de
navegacao para a IA dos inimigos.

O jogador usa colisao circulo-retangulo e resolve os eixos horizontal e
vertical separadamente, podendo deslizar pela borda sem atravessar ilhas.
Projeteis sao removidos ao expirar, sair da arena, atingir estrutura ou atingir
alvo. Como cada projetil entra uma unica vez na lista de sobreviventes, cada
impacto aplica dano uma vez.

Chasers perseguem o jogador e causam dano no contato, iniciando o afundamento.
Shooters usam distancia minima/maxima, alcance de ataque e cooldown. Inimigos
afundando nao participam de IA, dano ou colisao. Uma derrota causada por ataque
do jogador vale um ponto; a colisao do Chaser nao pontua.

## Recursos PixiJS e audio

`MapRenderer`, `PlayerRenderer` e `EnemyRenderer` concentram os objetos visuais.
Texturas sao carregadas por `Assets.load`; falhas resultam em textura ausente e
nao impedem nova tentativa em outra partida. Sprites de projeteis, impactos e
inimigos sao mantidos em mapas por id e removidos quando deixam o snapshot.

No `destroy`, `GameRenderer` remove listeners de teclado, cancela o
`requestAnimationFrame`, remove a ponte de teste, destrui sprites/containers e
libera a aplicacao Pixi. `App` remove o listener de `storage` e descarta o
`SoundManager`. O renderer tambem evita anexar resultados de promises de assets
depois de ser destruido.

O canvas usa as dimensoes do container, `autoDensity` e `devicePixelRatio`,
mantendo coordenadas logicas coerentes em desktop e mobile.

## Estado local e configuracao

| Chave | Conteudo |
| --- | --- |
| `pirate-battle:game-config` | opcoes persistidas |
| `pirate-battle:player-id` | UUID estavel do jogador |
| `pirate-battle:mock-matches` | registros confirmados no mock |
| `pirate-battle:pending-matches` | envios que falharam ou expiraram |
| `pirate-battle:network-scenario` | cenario de rede ativo |
| `pirate-battle:network-seed` | seed de latencia, padrao `17` |

JSON invalido nas configuracoes volta aos defaults. Eventos `storage` atualizam
pendencias e invalidam as queries de ranking e historico. A persistencia local
e intencional: o projeto nao depende de banco ou servico privado.

## Ranking, historico e contratos

`src/game/data/matchApi.ts` e a fronteira Axios. O cliente usa `baseURL: /api`
e timeout de 1500 ms. Os contratos ficam em
`src/game/model/matchTypes.ts`:

```ts
interface MatchRecord {
  matchId: string;
  playerId: string;
  completedAt: string;
  score: number;
  playedSeconds: number;
  endReason: "time" | "player-defeated";
  config: GameConfig;
}
```

Os endpoints sao `GET /api/ranking?config=...`, `GET /api/matches?playerId=...`
e `POST /api/matches`. O POST envia `Idempotency-Key: matchId`. Ranking filtra
pela configuracao e ordena por score decrescente, duracao decrescente, data
crescente e `playerId` crescente.

`useRanking` usa a configuracao na query key; `useMatchHistory` usa o jogador.
Ambas usam `staleTime` de 10 s, refetch ao montar/focar e duas tentativas.
Uma mutacao bem-sucedida invalida as duas familias de queries.

### Pendencias e recuperacao

Falha no POST salva o registro em `pirate-battle:pending-matches` com a
mensagem do erro. A fila sobrevive a refresh e nao impede iniciar outra
partida. Retry reenvia o mesmo `matchId`; o mock e o servidor Node procuram esse
id antes de salvar e retornam `duplicate: true` quando o registro ja existe,
evitando duplicacao depois de timeout ou resposta perdida.

Falhas de leitura aparecem nas abas e nao bloqueiam gameplay, Options ou novas
partidas. Registros abandonados nao entram no ranking nem no historico.

## MSW e cenarios de rede

`src/mocks/networkMock.ts` centraliza cenarios, labels, fixtures, paginacao,
latencia, seed e persistencia. `handlers.ts` compartilha os contratos entre
desenvolvimento e Playwright. Os cenarios cobrem sucesso, listas vazias,
multiplas paginas, latencia fixa/variavel/fora de ordem, timeout, conexao,
HTTP 503 para ranking ou historico e falhas de envio.

O reset remove registros confirmados e pendentes, restaura `success` e define
o seed `17`.

## Testabilidade

`window.__PIRATE_BATTLE_TEST__` expoe snapshot, input, dano, pausa, reset,
controle de spawn e relogio controlado. `advance` divide o intervalo em passos
de 50 ms e executa a simulacao real sem depender do relogio do navegador.
Playwright usa `?seed=17`, um worker, Chromium desktop e Pixel 7 mobile, com
traces em falhas e baselines de menu, arena e resultado.

## Balanceamento e limitacoes

- A sessao padrao e 120 s, dentro do limite de 60-180 s.
- O primeiro spawn ocorre apos 5 s e usa distancia segura de 400 px para evitar
  dano inevitavel no inicio.
- O jogador tem 140 de vida; cooldowns e danos foram escolhidos para permitir
  combater varios inimigos sem exigir precisao perfeita.
- Shooter controla distancia e alcance; Chaser e mais direto e perigoso por
  contato. Os valores ficam centralizados em `gameConfig.ts`.
- Ranking e historico sao locais e simulados; a API Node opcional nao e um
  backend multiusuario.
- A telemetria coleta FPS e amostras, mas o renderer nao calcula nem expoe um
  P95 pronto; o relatorio de profiling documenta o protocolo manual e essa
  limitacao.
- Os spritesheets fornecidos seriam a opcao preferivel para reduzir requests e
  otimizar recursos, mas os sprites separados foram mantidos porque eram mais
  rapidos de integrar dentro do prazo da entrega.
- O mapa usa layouts de tiles definidos, nao geracao procedural. Isso evita
  depender de combinacoes que os tiles fornecidos nao suportam bem.
- Ha bugs conhecidos na geracao e distribuicao das ilhas que permanecem sem
  correcao por falta de tempo; a limitacao e reconhecida e nao e tratada como
  resolvida pela arquitetura atual.

## Comandos de verificacao

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Resultados e artefatos estao em
[docs/testing-report.md](docs/testing-report.md) e
[docs/profiling-report.md](docs/profiling-report.md).
