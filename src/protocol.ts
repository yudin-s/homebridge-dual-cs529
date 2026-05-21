export type DeviceSpeed = 33 | 45 | 78;

export type StartStopMode = 0 | 1 | 2;

export interface DeviceState {
  power: boolean;
  startStopMode: StartStopMode;
  speed: DeviceSpeed;
  repeatMode: boolean;
  loopMode: boolean;
}

export interface PartialDeviceState {
  power?: boolean;
  startStopMode?: StartStopMode;
  speed?: DeviceSpeed;
  repeatMode?: boolean;
  loopMode?: boolean;
}

export const DEFAULT_DEVICE_STATE: DeviceState = {
  power: false,
  startStopMode: 0,
  speed: 33,
  repeatMode: false,
  loopMode: false,
};

export const COMMAND_PREFIX = '@0PTT';

const boolToInt = (value: boolean): string => (value ? '01' : '00');
const intToBool = (value: string): boolean => value === '01' || value === '1' || value === '02';

export const Protocol = {
  power: {
    buildStartStopCommand(mode: StartStopMode): string {
      const normalized = mode.toString().padStart(2, '0');
      return `${COMMAND_PREFIX}TST${normalized}`;
    },
    parse(message: string): StartStopMode | undefined {
      const match = message.match(new RegExp(`^${COMMAND_PREFIX}TST(\\d{2})$`));
      if (!match) return undefined;
      const value = Number.parseInt(match[1], 10);
      if (value === 0 || value === 1 || value === 2) {
        return value as StartStopMode;
      }
      return undefined;
    },
  },
  repeat: {
    buildCommand(enabled: boolean): string {
      return `${COMMAND_PREFIX}TRP${boolToInt(enabled)}`;
    },
    parse(message: string): boolean | undefined {
      const match = message.match(new RegExp(`^${COMMAND_PREFIX}TRP(\\d{2})$`));
      if (!match) return undefined;
      return intToBool(match[1]);
    },
  },
  loop: {
    buildCommand(enabled: boolean): string {
      return `${COMMAND_PREFIX}TLS${boolToInt(enabled)}`;
    },
    parse(message: string): boolean | undefined {
      const match = message.match(new RegExp(`^${COMMAND_PREFIX}TLS(\\d{2})$`));
      if (!match) return undefined;
      return intToBool(match[1]);
    },
  },
  speed: {
    buildCommand(speed: DeviceSpeed): string {
      return `${COMMAND_PREFIX}TRS${speed}`;
    },
    parse(message: string): DeviceSpeed | undefined {
      const match = message.match(new RegExp(`^${COMMAND_PREFIX}TRS(\\d{2})$`));
      if (!match) return undefined;
      const value = Number.parseInt(match[1], 10);
      if (value === 33 || value === 45 || value === 78) {
        return value as DeviceSpeed;
      }
      return undefined;
    },
  },
  query: {
    version: '@0?PTSTVN',
    brightness: '@0?PTSTBR',
    startStop: '@0?PTTTST',
    repeat: '@0?PTTTRP',
    loop: '@0?PTTTLS',
    speed: '@0?PTTTRS',
    all: '@0?PTTTRS;@0?PTTTST;@0?PTTTLS;@0?PTTTRP',
  },
};

export interface ProtocolStatusFrame {
  timestamp: string;
  message: string;
}

export function parseProtocolMessage(message: string): PartialDeviceState {
  const normalized = message.trim();
  const result: PartialDeviceState = {};

  const startStop = Protocol.power.parse(normalized);
  if (startStop !== undefined) {
    result.startStopMode = startStop;
    result.power = startStop === 1;
  }

  const repeat = Protocol.repeat.parse(normalized);
  if (repeat !== undefined) {
    result.repeatMode = repeat;
  }

  const loop = Protocol.loop.parse(normalized);
  if (loop !== undefined) {
    result.loopMode = loop;
  }

  const speed = Protocol.speed.parse(normalized);
  if (speed !== undefined) {
    result.speed = speed;
  }

  if (isDeviceStateComplete(result)) {
    result.power = result.power ?? true;
    result.speed = result.speed ?? 33;
  }

  return result;
}

export function isDeviceStateComplete(state: PartialDeviceState): state is DeviceState {
  return (
    state.power !== undefined &&
    state.startStopMode !== undefined &&
    state.speed !== undefined &&
    state.repeatMode !== undefined &&
    state.loopMode !== undefined
  );
}

export function normalizeStatusPayload(value: string): string[] {
  return value
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function parseStatusPayload(value: string): PartialDeviceState {
  const chunks = normalizeStatusPayload(value);
  const state: PartialDeviceState = {};

  for (const chunk of chunks) {
    const part = parseProtocolMessage(chunk);
    Object.assign(state, part);
  }

  return state;
}
