import { test, expect } from '@playwright/test';
import { mergeTouchInput } from '../src/game/input/mobileControls';

test('mobile touch inputs combine with keyboard input and keep movement active while pressed', () => {
  const keyboardState = {
    forward: false,
    backward: false,
    rotateLeft: false,
    rotateRight: false,
    shoot: false,
    broadsideLeft: false,
    broadsideRight: false,
  };

  const pressedTouchState = {
    forward: true,
    rotateLeft: true,
    shoot: true,
  };

  const merged = mergeTouchInput(keyboardState, pressedTouchState);

  expect(merged.forward).toBe(true);
  expect(merged.rotateLeft).toBe(true);
  expect(merged.shoot).toBe(true);
  expect(merged.rotateRight).toBe(false);

  const turnRightOnly = mergeTouchInput(merged, { rotateRight: true });
  expect(turnRightOnly.forward).toBe(true);
  expect(turnRightOnly.rotateLeft).toBe(true);
  expect(turnRightOnly.rotateRight).toBe(true);
});
