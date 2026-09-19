# Testing Report

## Environment

- Date: 2026-09-19
- Node/npm: local checkout environment
- Browser projects: Chromium desktop and Pixel 7 mobile
- Playwright workers: 1
- Server: Vite started automatically by `playwright.config.ts`
- Determinism: `/?seed=17`, network seed `17`, controlled simulation clock

## Commands and result

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed; Vite emitted only the existing large-chunk warning |
| `npm test` | 26 passed, 2 failed, 28 total |

The two failures are the visual test `captures stable menu and result visual
baselines`, one in each browser project. Both fail at the arena screenshot:
desktop differs by 30,834 pixels (4%) and mobile by 29,960 pixels (9%). The
functional assertions before the screenshot pass. Each failure produces an
actual image, diff, video and trace under `test-results/`.

## Covered behavior

The passing tests cover Options validation and persistence, asset retry,
movement and bounds, frontal/broadside cooldowns, enemy spawn, death and clean
restart, timeout and frozen result state, pause/resume, result persistence,
abandonment, navigation, touch input, empty/paginated/error API states,
pending submissions after refresh, retry and idempotent timeout recovery.

Run the suite and open its HTML report with:

```bash
npm test
npx playwright show-report playwright-report
```

Inspect a failed trace with:

```bash
npx playwright show-trace test-results/<failed-test>/trace.zip
```

## Interpretation

The functional suite is green for both desktop and mobile. The visual suite
needs a deliberate baseline decision: either restore the expected arena assets
for the current renderer or review and update the versioned snapshots after
confirming the visual change. This report does not hide that failure by
increasing `maxDiffPixels` or regenerating snapshots automatically.