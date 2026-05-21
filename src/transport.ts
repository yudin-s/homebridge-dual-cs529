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
    this.scanTimeoutMs = options.scanTimeoutMs ?? 12_000;
    this.serviceUuid = normalizeUuid(options.serviceUuid ?? DEFAULT_BLE_UUIDS.serviceUuid);
    this.commandCharacteristicUuid = normalizeUuid(options.commandCharacteristicUuid ?? DEFAULT_BLE_UUIDS.commandCharacteristicUuid);
    this.notifyCharacteristicUuid = normalizeUuid(options.notifyCharacteristicUuid ?? DEFAULT_BLE_UUIDS.notifyCharacteristicUuid);
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
    try {
      await waitForPoweredOn();
      const peripheral = await discoverPeripheral(this.target, this.scanTimeoutMs);
      await connectPeripheral(peripheral);
      const serviceUuidFilter = this.serviceUuid ? [this.serviceUuid] : null;
      const services = await discoverServices(peripheral, serviceUuidFilter);
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

      peripheral.on('disconnect', this.handleDisconnect);
      notifyCharacteristic.on('data', this.handleData.bind(this));
      this.emit('connected');
    } catch (error) {
      this.connected = false;
      this.peripheral?.disconnect(() => undefined);
      throw error as Error;
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

async function waitForPoweredOn(): Promise<void> {
  if (getNobleState() === 'poweredOn') {
    return;
  }

  if (getNobleState() === 'unsupported' || getNobleState() === 'unauthorized') {
    throw new Error(`noble state is ${getNobleState()}`);
  }

  await new Promise<void>((resolve, reject) => {
    const onStateChange = (state: string) => {
      if (state === 'poweredOn') {
        noble.removeListener('stateChange', onStateChange);
        resolve();
        return;
      }
      if (state === 'unsupported' || state === 'unauthorized') {
        noble.removeListener('stateChange', onStateChange);
        reject(new Error(`noble state is ${state}`));
      }
    };

    noble.on('stateChange', onStateChange);
  });
}

function getNobleState(): string {
  const anyNoble = noble as { state?: string; _state?: string };
  return anyNoble.state ?? anyNoble._state ?? 'unknown';
}

async function discoverPeripheral(
  target: { id?: string; name?: string },
  timeoutMs: number,
): Promise<NoblePeripheral> {
  const serviceUuids: string[] = [];

  const peripheral = await new Promise<NoblePeripheral>((resolve, reject) => {
    const clear = () => {
      noble.removeListener('discover', onDiscover);
      noble.stopScanning();
    };

    const finish = () => {
      clearTimeout(timer);
      clear();
    };

    const timer = sleepTimeout(() => {
      finish();
      reject(new Error('BLE peripheral not found within timeout'));
    }, timeoutMs);

    const onDiscover = (candidate: NoblePeripheral) => {
      if (target.id && !matchPeripheralId(candidate, target.id)) {
        return;
      }
      if (target.name && !matchPeripheralName(candidate, target.name)) {
        return;
      }
      finish();
      resolve(candidate);
    };

    noble.on('discover', onDiscover);

    noble.startScanning(serviceUuids, false, (error?: Error | null) => {
      if (error) {
        finish();
        reject(error);
      }
    });
  });

  return peripheral;
}

function matchPeripheralId(peripheral: NoblePeripheral, targetId: string): boolean {
  return normalizeUuid(peripheral.id) === targetId || normalizeUuid(peripheral.address) === targetId;
}

function matchPeripheralName(peripheral: NoblePeripheral, targetName: string): boolean {
  return (peripheral.name ?? '').toLowerCase() === targetName.toLowerCase();
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
}> > {
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
  service: { discoverCharacteristics: (
    uuids: string[] | null,
    cb: (error: Error | null, characteristics: NobleCharacteristic[]) => void,
  ) => void; },
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
