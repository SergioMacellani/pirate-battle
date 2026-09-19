import { test, expect } from '@playwright/test';
import { clampFrameDelta } from '../src/game/rendering/frameTiming';

test('frame delta is clamped to avoid huge jumps during stalls', () => {
  expect(clampFrameDelta(0.016)).toBeCloseTo(0.016, 6);
  expect(clampFrameDelta(0.2)).toBeCloseTo(1 / 30, 6);
  expect(clampFrameDelta(-0.2)).toBeCloseTo(0, 6);
});
