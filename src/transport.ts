import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { setTimeout as sleepTimeout } from 'node:timers';
import noble from '@abandonware/noble';

export interface ProtocolFrame {
  timestamp: string;
  message: string;
}

export interface BLEClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: string): Promise<void>;
  readonly isConnected: boolean;
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'message', listener: (frame: ProtocolFrame) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export interface BLEAdapterOptions {
  noble?: NobleLike;
  peripheralId?: string;
  peripheralName?: string;
  serviceUuid?: string;
  commandCharacteristicUuid?: string;
  notifyCharacteristicUuid?: string;
  scanTimeoutMs?: number;
}

export const DEFAULT_BLE_UUIDS = {
  serviceUuid: '6e400001b5a3f393e0a9e50e24dcca9e',
  commandCharacteristicUuid: '6e400002b5a3f393e0a9e50e24dcca9e',
  notifyCharacteristicUuid: '6e400003b5a3f393e0a9e50e24dcca9e',
} as const;

export class NobleBLEClient extends EventEmitter implements BLEClient {
  private readonly scanTimeoutMs: number;
  private readonly serviceUuid?: string;
  private readonly commandCharacteristicUuid?: string;
  private readonly notifyCharacteristicUuid?: string;
  private readonly scanServiceUuids: string[];
  private readonly noble: NobleLike;

  private peripheral?: NoblePeripheral;
  private commandCharacteristic?: {
    properties: string[];
    write: (data: Buffer, withoutResponse: boolean, cb: (error?: Error | null) => void) => void;
  };
  private notifyCharacteristic?: {
    subscribe: (cb: (error?: Error | null) => void) => void;
    on: (event: 'data', cb: (data: Buffer) => void) => void;
    removeAllListeners: () => void;
  };
  private connected = false;
  private connectPromise: Promise<void> | null = null;

  public constructor(options: BLEAdapterOptions = {}) {
    super();
    this.noble = options.noble ?? noble;
    this.scanTimeoutMs = options.scanTimeoutMs ?? 12_000;
    this.serviceUuid = normalizeUuid(options.serviceUuid ?? DEFAULT_BLE_UUIDS.serviceUuid);
    this.scanServiceUuids = this.serviceUuid ? [this.serviceUuid] : [];
    this.commandCharacteristicUuid = normalizeUuid(
      options.commandCharacteristicUuid ?? DEFAULT_BLE_UUIDS.commandCharacteristicUuid,
    );
    this.notifyCharacteristicUuid = normalizeUuid(
      options.notifyCharacteristicUuid ?? DEFAULT_BLE_UUIDS.notifyCharacteristicUuid,
    );
    this.target = {
      id: normalizeUuid(options.peripheralId),
      name: options.peripheralName?.toLowerCase(),
    };
  }

  private readonly target: {
    id?: string;
    name?: string;
  };

  public get isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.performConnect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.peripheral) {
      this.connected = false;
      return;
    }

    await new Promise<void>((resolve) => {
      this.peripheral!.disconnect(() => {
        resolve();
      });
    });
    this.connected = false;
  }

  public async send(command: string): Promise<void> {
    if (!this.connected || !this.commandCharacteristic) {
      throw new Error('ble client is not connected');
    }

    const data = Buffer.from(command, 'utf8');
    const withoutResponse =
      !this.commandCharacteristic.properties.includes('write') &&
      this.commandCharacteristic.properties.includes('writeWithoutResponse');
    await new Promise<void>((resolve, reject) => {
      this.commandCharacteristic!.write(data, withoutResponse, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async performConnect(): Promise<void> {
    let discovery: MatchingPeripheralDiscovery | undefined;

    try {
      await waitForPoweredOn(this.noble);
      discovery = createMatchingPeripheralDiscovery(this.noble, this.target, {
        scanTimeoutMs: this.scanTimeoutMs,
        scanServiceUuids: this.scanServiceUuids,
      });

      while (true) {
        const peripheral = await discovery.nextCandidate();
        try {
          await connectPeripheral(peripheral);
          const services = await discoverServices(peripheral, this.scanServiceUuids);
          const { commandCharacteristic, notifyCharacteristic } = await resolveCharacteristics(
            services,
            {
              commandCharacteristicUuid: this.commandCharacteristicUuid,
              notifyCharacteristicUuid: this.notifyCharacteristicUuid,
            },
          );
          await subscribeToNotifications(notifyCharacteristic);

          this.peripheral = peripheral;
          this.commandCharacteristic = commandCharacteristic;
          this.notifyCharacteristic = notifyCharacteristic;
          this.connected = true;
          discovery.stop();

          peripheral.on('disconnect', this.handleDisconnect);
          notifyCharacteristic.on('data', this.handleData.bind(this));
          this.emit('connected');
          return;
        } catch (error) {
          this.connected = false;
          this.peripheral = undefined;
          this.commandCharacteristic = undefined;
          this.notifyCharacteristic?.removeAllListeners();
          this.notifyCharacteristic = undefined;
          await disconnectPeripheral(peripheral);
          continue;
        }
      }
    } catch (error) {
      this.connected = false;
      this.peripheral?.disconnect(() => undefined);
      throw error as Error;
    } finally {
      discovery?.stop();
    }
  }

  private handleData(data: Buffer): void {
    const raw = data.toString('utf8');
    const parts = raw.split(/[\r\n]+/);
    for (const part of parts) {
      const message = part.trim();
      if (message.length === 0) {
        continue;
      }
      this.emit('message', {
        timestamp: new Date().toISOString(),
        message,
      });
    }
  }

  private readonly handleDisconnect = () => {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.commandCharacteristic = undefined;
    this.notifyCharacteristic?.removeAllListeners();
    this.notifyCharacteristic = undefined;
    this.emit('disconnected');
  };
}

async function waitForPoweredOn(nobleLike: NobleLike): Promise<void> {
  if (getNobleState(nobleLike) === 'poweredOn') {
    return;
  }

  if (getNobleState(nobleLike) === 'unsupported' || getNobleState(nobleLike) === 'unauthorized') {
    throw new Error(`noble state is ${getNobleState(nobleLike)}`);
  }

  await new Promise<void>((resolve, reject) => {
    const onStateChange = (state: string) => {
      if (state === 'poweredOn') {
        nobleLike.removeListener('stateChange', onStateChange);
        resolve();
        return;
      }
      if (state === 'unsupported' || state === 'unauthorized') {
        nobleLike.removeListener('stateChange', onStateChange);
        reject(new Error(`noble state is ${state}`));
      }
    };

    nobleLike.on('stateChange', onStateChange);
  });
}

function getNobleState(nobleLike: NobleLike): string {
  const anyNoble = nobleLike as { state?: string; _state?: string };
  return anyNoble.state ?? anyNoble._state ?? 'unknown';
}

function createMatchingPeripheralDiscovery(
  nobleLike: NobleLike,
  target: { id?: string; name?: string },
  options: {
    scanTimeoutMs: number;
    scanServiceUuids: string[];
  },
): MatchingPeripheralDiscovery {
  const queue: NoblePeripheral[] = [];
  const waiters: Array<{
    resolve: (peripheral: NoblePeripheral) => void;
    reject: (error: Error) => void;
  }> = [];
  const seenIds = new Set<string>();
  let stopped = false;
  const timeoutError = new Error('BLE peripheral not found within timeout');

  const finish = (error?: Error): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    clearTimeout(timer);
    nobleLike.removeListener('discover', onDiscover);
    nobleLike.stopScanning();
    if (error) {
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.reject(error);
      }
    }
  };

  const timer = sleepTimeout(() => {
    finish(timeoutError);
  }, options.scanTimeoutMs);

  const onDiscover = (candidate: NoblePeripheral) => {
    if (stopped) {
      return;
    }
    if (target.id && !matchPeripheralId(candidate, target.id)) {
      return;
    }
    if (target.name && !matchPeripheralName(candidate, target.name)) {
      return;
    }

    const key = `${candidate.id}|${candidate.address}`;
    if (seenIds.has(key)) {
      return;
    }
    seenIds.add(key);

    if (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.resolve(candidate);
      return;
    }
    queue.push(candidate);
  };

  nobleLike.on('discover', onDiscover);
  nobleLike.startScanning(options.scanServiceUuids, false, (error?: Error | null) => {
    if (error) {
      finish(error);
    }
  });

  return {
    nextCandidate: (): Promise<NoblePeripheral> =>
      new Promise((resolve, reject) => {
        if (stopped) {
          reject(timeoutError);
          return;
        }

        if (queue.length > 0) {
          resolve(queue.shift() as NoblePeripheral);
          return;
        }

        waiters.push({ resolve, reject });
      }),
    stop: (error?: Error): void => {
      finish(error);
    },
  };
}

function matchPeripheralId(peripheral: NoblePeripheral, targetId: string): boolean {
  return normalizeUuid(peripheral.id) === targetId || normalizeUuid(peripheral.address) === targetId;
}

function matchPeripheralName(peripheral: NoblePeripheral, targetName: string): boolean {
  return (peripheral.name ?? '').toLowerCase().startsWith(targetName);
}

function connectPeripheral(peripheral: NoblePeripheral): Promise<void> {
  return new Promise((resolve, reject) => {
    peripheral.connect((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function discoverServices(
  peripheral: NoblePeripheral,
  serviceUuids: string[] | null,
): Promise<Array<{
  uuid: string;
  discoverCharacteristics: (
    uuids: string[] | null,
    cb: (error: Error | null, characteristics: NobleCharacteristic[]) => void,
  ) => void;
}>> {
  return new Promise((resolve, reject) => {
    peripheral.discoverServices(serviceUuids, (error, services) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(services as Array<any>);
    });
  });
}

async function resolveCharacteristics(
  services: Array<{
    uuid: string;
    discoverCharacteristics: (
      uuids: string[] | null,
      cb: (error: Error | null, characteristics: NobleCharacteristic[]) => void,
    ) => void;
  }>,
  options: {
    commandCharacteristicUuid?: string;
    notifyCharacteristicUuid?: string;
  },
): Promise<{ commandCharacteristic: NobleCharacteristic; notifyCharacteristic: NobleCharacteristic }> {
  const characteristics = await Promise.all(
    services.map((service) => discoverCharacteristics(service)),
  ).then((all) => all.flat());

  const commandCharacteristic = chooseCharacteristic(characteristics, options.commandCharacteristicUuid, canWrite);
  const notifyCharacteristic = chooseCharacteristic(characteristics, options.notifyCharacteristicUuid, canNotify);

  return { commandCharacteristic, notifyCharacteristic };
}

async function discoverCharacteristics(
  service: {
    discoverCharacteristics: (
      uuids: string[] | null,
      cb: (error: Error | null, characteristics: NobleCharacteristic[]) => void,
    ) => void;
  },
): Promise<NobleCharacteristic[]> {
  return new Promise((resolve, reject) => {
    service.discoverCharacteristics(null, (error, characteristics) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(characteristics as NobleCharacteristic[]);
    });
  });
}

async function disconnectPeripheral(peripheral: NoblePeripheral): Promise<void> {
  await new Promise<void>((resolve) => {
    peripheral.disconnect(() => {
      resolve();
    });
  });
}

function chooseCharacteristic(
  characteristics: NobleCharacteristic[],
  uuid?: string,
  filter: (c: NobleCharacteristic) => boolean = () => true,
): NobleCharacteristic {
  const preferred = uuid ? characteristics.find((item) => normalizeUuid(item.uuid) === uuid) : undefined;
  if (preferred) {
    return preferred;
  }
  const fallback = characteristics.find((item) => filter(item));
  if (!fallback) {
    throw new Error(`BLE characteristic not found (uuid=${uuid ?? 'auto'})`);
  }
  return fallback;
}

function canWrite(characteristic: NobleCharacteristic): boolean {
  return characteristic.properties.includes('write') || characteristic.properties.includes('writeWithoutResponse');
}

function canNotify(characteristic: NobleCharacteristic): boolean {
  return characteristic.properties.includes('notify') || characteristic.properties.includes('indicate');
}

async function subscribeToNotifications(characteristic: NobleCharacteristic): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    characteristic.subscribe((error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function normalizeUuid(value?: string): string | undefined {
  return value
    ?.trim()
    .replace(/[-:]/g, '')
    .toLowerCase();
}

type MatchingPeripheralDiscovery = {
  nextCandidate: () => Promise<NoblePeripheral>;
  stop: (error?: Error) => void;
};

type NobleCharacteristic = {
  uuid: string;
  properties: string[];
  subscribe: (cb: (error?: Error | null) => void) => void;
  on: (event: 'data', cb: (data: Buffer) => void) => void;
  removeAllListeners: () => void;
  write: (data: Buffer, withoutResponse: boolean, cb: (error?: Error | null) => void) => void;
};

type NoblePeripheral = {
  id: string;
  address: string;
  name?: string;
  connect: (cb: (error?: Error | null) => void) => void;
  disconnect: (cb: (error?: Error | null) => void) => void;
  discoverServices: (
    uuids: string[] | null,
    cb: (error: Error | null, services: Array<{
      uuid: string;
      discoverCharacteristics: (
        uuids: string[] | null,
        cb: (error: Error | null, characteristics: NobleCharacteristic[]) => void,
      ) => void;
    }>) => void,
  ) => void;
  on: (event: 'disconnect', cb: () => void) => void;
};

type NobleLike = {
  on(event: 'stateChange', listener: (state: string) => void): void;
  on(event: 'discover', listener: (peripheral: NoblePeripheral) => void): void;
  removeListener(event: 'stateChange', listener: (state: string) => void): void;
  removeListener(event: 'discover', listener: (peripheral: NoblePeripheral) => void): void;
  startScanning(serviceUuids: string[], allowDuplicates: boolean, callback: (error?: Error | null) => void): void;
  stopScanning(): void;
};
