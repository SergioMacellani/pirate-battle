export interface MobileInputState {
  forward: boolean;
  backward: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
  shoot: boolean;
  broadsideLeft: boolean;
  broadsideRight: boolean;
}

export const EMPTY_MOBILE_INPUT_STATE: MobileInputState = {
  forward: false,
  backward: false,
  rotateLeft: false,
  rotateRight: false,
  shoot: false,
  broadsideLeft: false,
  broadsideRight: false,
};

export function mergeTouchInput(
  keyboardInput: Partial<MobileInputState> = {},
  touchInput: Partial<MobileInputState> = {},
): MobileInputState {
  const merged: MobileInputState = { ...EMPTY_MOBILE_INPUT_STATE };

  for (const key of Object.keys(EMPTY_MOBILE_INPUT_STATE) as Array<keyof MobileInputState>) {
    merged[key] = Boolean(keyboardInput[key] || touchInput[key]);
  }

  return merged;
}
