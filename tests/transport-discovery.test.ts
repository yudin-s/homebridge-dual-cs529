import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@abandonware/noble', () => ({
  default: {
    state: 'poweredOn',
    on: () => undefined,
    removeListener: () => undefined,
    startScanning: () => undefined,
    stopScanning: () => undefined,
  },
}));

import { DEFAULT_BLE_UUIDS, NobleBLEClient } from '../src/transport';

type MockCharacteristic = {
  uuid: string;
  properties: string[];
  write: (data: Buffer, withoutResponse: boolean, cb: (error?: Error | null) => void) => void;
  subscribe: (cb: (error?: Error | null) => void) => void;
  on: (event: 'data', cb: (data: Buffer) => void) => void;
  removeAllListeners: () => void;
  emitData?: (message: string) => void;
};

type MockPeripheralOptions = {
  id: string;
  address: string;
  name?: string;
  connectError?: Error;
  commandCharacteristicUuid?: string;
  notifyCharacteristicUuid?: string;
  includeNotify?: boolean;
};

type MockService = {
  uuid: string;
  discoverCharacteristics: (
    uuids: string[] | null,
    cb: (error: Error | null, characteristics: MockCharacteristic[]) => void,
  ) => void;
};

type MockPeripheral = ReturnType<MockPeripheralFactory>;
type MockPeripheralFactory = (options: MockPeripheralOptions) => {
  id: string;
  address: string;
  name?: string;
  connect: (cb: (error?: Error | null) => void) => void;
  disconnect: (cb: (error?: Error | null) => void) => void;
  discoverServices: (uuids: string[] | null, cb: (error: Error | null, services: MockService[]) => void) => void;
  on: (event: 'disconnect', cb: () => void) => void;
  connectCalls: number;
  disconnectCalls: number;
};

type MockNoble = ReturnType<MockNobleFactory>;
type MockNobleFactory = () => {
  state: string;
  _state?: string;
  on: (event: 'stateChange' | 'discover', cb: (arg: any) => void) => void;
  removeListener: (event: 'stateChange' | 'discover', cb: (arg: any) => void) => void;
  startScanning: (serviceUuids: string[], allowDuplicates: boolean, cb: (error?: Error | null) => void) => void;
  stopScanning: () => void;
  emitDiscover: (peripheral: MockPeripheral) => void;
  removeAllListeners: () => void;
  scanServiceUuids?: string[];
};

const buildPeripheral: MockPeripheralFactory = (options) => {
  const events = new EventEmitter();
  const characteristicEvents = new EventEmitter();
  let removed = false;

  const notifyUuid = options.notifyCharacteristicUuid ?? DEFAULT_BLE_UUIDS.notifyCharacteristicUuid;
  const commandUuid = options.commandCharacteristicUuid ?? DEFAULT_BLE_UUIDS.commandCharacteristicUuid;

  const commandCharacteristic: MockCharacteristic = {
    uuid: commandUuid,
    properties: ['write'],
    write: (_, __, cb) => cb(),
    subscribe: () => undefined,
    on: () => undefined,
    removeAllListeners: () => undefined,
  };

  const notifyCharacteristic: MockCharacteristic = {
    uuid: notifyUuid,
    properties: ['notify'],
    write: () => undefined,
    subscribe: (cb) => cb(),
    on: (_event, cb) => {
      if (removed) return;
      characteristicEvents.on('data', cb as (data: Buffer) => void);
    },
    removeAllListeners: () => {
      removed = true;
      characteristicEvents.removeAllListeners();
    },
    emitData: (message: string) => {
      characteristicEvents.emit('data', Buffer.from(message));
    },
  };

  const connectCalls = 0;
  const disconnectCalls = 0;

  const mock: MockPeripheral = {
    id: options.id,
    address: options.address,
    name: options.name,
    connectCalls,
    disconnectCalls,
    connect: (cb) => {
      mock.connectCalls += 1;
      if (options.connectError) {
        cb(options.connectError);
        return;
      }
      cb();
    },
    disconnect: (cb) => {
      mock.disconnectCalls += 1;
      cb();
    },
    discoverServices: (_uuids, cb) => {
      const characteristics: MockCharacteristic[] = [commandCharacteristic];
      if (options.includeNotify !== false) {
        characteristics.push(notifyCharacteristic);
      }

      cb(null, [{
        uuid: DEFAULT_BLE_UUIDS.serviceUuid,
        discoverCharacteristics: (_uuids, cbDiscover) => {
          cbDiscover(null, characteristics);
        },
      }]);
    },
    on: (_event, cb) => {
      events.on('disconnect', cb);
    },
  };

  return mock;
};

const buildNoble: MockNobleFactory = () => {
  const discoverListeners: Array<(peripheral: MockPeripheral) => void> = [];
  const instance = {
    state: 'poweredOn',
    _state: 'poweredOn' as const,
    scanServiceUuids: undefined as string[] | undefined,
    on: (event: 'stateChange' | 'discover', cb: (arg: any) => void) => {
      if (event === 'discover') {
        discoverListeners.push(cb as (peripheral: MockPeripheral) => void);
      }
      return undefined;
    },
    removeListener: (event: 'stateChange' | 'discover', cb: (arg: any) => void) => {
      if (event !== 'discover') {
        return;
      }
      const idx = discoverListeners.findIndex((listener) => listener === cb);
      if (idx >= 0) {
        discoverListeners.splice(idx, 1);
      }
      return undefined;
    },
    startScanning: (serviceUuids: string[], _allowDuplicates: boolean, cb: (error?: Error | null) => void) => {
      instance.scanServiceUuids = serviceUuids;
      cb();
    },
    stopScanning: () => {
      discoverListeners.length = 0;
    },
    emitDiscover: (peripheral: MockPeripheral) => {
      for (const listener of [...discoverListeners]) {
        listener(peripheral);
      }
    },
    removeAllListeners: () => {
      discoverListeners.length = 0;
    },
  };
  return instance;
};

describe('NobleBLEClient discovery behavior', () => {
  let noble: MockNoble;

  beforeEach(() => {
    noble = buildNoble();
  });

  it('connects to the first candidate that is connectable', async () => {
    const failFast = buildPeripheral({
      id: 'bad',
      address: 'aa:bb:cc:dd:ee:01',
      connectError: new Error('bad candidate'),
    });
    const good = buildPeripheral({
      id: 'good',
      address: 'aa:bb:cc:dd:ee:02',
    });

    const client = new NobleBLEClient({
      noble,
      scanTimeoutMs: 200,
      serviceUuid: DEFAULT_BLE_UUIDS.serviceUuid,
      commandCharacteristicUuid: DEFAULT_BLE_UUIDS.commandCharacteristicUuid,
      notifyCharacteristicUuid: DEFAULT_BLE_UUIDS.notifyCharacteristicUuid,
    });

    const connectPromise = client.connect();
    await Promise.resolve();
    noble.emitDiscover(failFast);
    noble.emitDiscover(good);
    await connectPromise;

    expect(client.isConnected).toBe(true);
    expect(failFast.connectCalls).toBe(1);
    expect(good.connectCalls).toBe(1);
    expect(noble.scanServiceUuids).toEqual([DEFAULT_BLE_UUIDS.serviceUuid]);
  });

  it('continues to next candidate when previous one lacks required characteristics', async () => {
    const invalid = buildPeripheral({
      id: 'no-notify',
      address: 'aa:bb:cc:dd:ee:10',
      includeNotify: false,
    });
    const valid = buildPeripheral({
      id: 'notify',
      address: 'aa:bb:cc:dd:ee:11',
    });

    const client = new NobleBLEClient({
      noble,
      scanTimeoutMs: 200,
    });

    const connectPromise = client.connect();
    await Promise.resolve();
    noble.emitDiscover(invalid);
    noble.emitDiscover(valid);
    await connectPromise;

    expect(client.isConnected).toBe(true);
    expect(invalid.connectCalls).toBe(1);
    expect(valid.connectCalls).toBe(1);
  });

  it('matches peripheral name as a prefix', async () => {
    const wrong = buildPeripheral({
      id: 'first',
      address: 'aa:bb:cc:dd:ee:20',
      name: 'Other Device',
      connectError: new Error('first should be ignored'),
    });
    const prefixed = buildPeripheral({
      id: 'second',
      address: 'aa:bb:cc:dd:ee:21',
      name: 'Dual CS529',
    });

    const client = new NobleBLEClient({
      noble,
      peripheralName: 'Dual',
      scanTimeoutMs: 200,
    });

    const connectPromise = client.connect();
    await Promise.resolve();
    noble.emitDiscover(wrong);
    noble.emitDiscover(prefixed);
    await connectPromise;

    expect(wrong.connectCalls).toBe(0);
    expect(prefixed.connectCalls).toBe(1);
  });
});
