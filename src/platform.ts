import { BLEAdapterOptions, BLEClient, NobleBLEClient } from './transport';
import { DualCS529Controller, DualCS529ControllerOptions } from './controller';
import { DualCS529Accessory } from './accessory';

type Logger = {
  debug: (...args: unknown[]) => void;
};

type HomebridgeAPI = {
  on: (event: string, cb: () => void) => void;
  hap: {
    Service: {
      Switch: unknown;
    };
    Characteristic: {
      On: unknown;
    };
    uuid: {
      generate: (id: string) => string;
    };
  };
  platformAccessory: (name: string, uuid: string) => PlatformAccessory;
  registerPlatformAccessories: (pluginId: string, platformName: string, accessories: PlatformAccessory[]) => void;
};

type PlatformAccessory = {
  UUID: string;
  displayName: string;
  context: Record<string, unknown>;
  services: unknown;
  getService: (name: string) => CharacteristicObject | undefined;
  addService: (s: unknown, name: string, subType: string) => CharacteristicObject;
};

type CharacteristicObject = {
  getCharacteristic: (c: unknown) => CharacteristicState;
};

type CharacteristicState = {
  onGet: (cb: () => unknown) => CharacteristicState;
  onSet: (cb: (v: unknown) => Promise<void>) => CharacteristicState;
  updateValue: (v: unknown) => void;
};

type PlatformConfig = {
  name?: string;
  deviceName?: string;
  peripheralId?: string;
  peripheralName?: string;
  serviceUuid?: string;
  commandCharacteristicUuid?: string;
  notifyCharacteristicUuid?: string;
  pollIntervalMs?: number;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
};

export interface HomebridgeDualCS529Config extends PlatformConfig {
  deviceName?: string;
  peripheralId?: string;
  peripheralName?: string;
  serviceUuid?: string;
  commandCharacteristicUuid?: string;
  notifyCharacteristicUuid?: string;
  pollIntervalMs?: number;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
}

export class DualCS529Platform {
  private readonly accessories: Map<string, DualCS529Accessory> = new Map();
  private readonly controllers = new Map<string, DualCS529Controller>();

  public constructor(
    public readonly log: Logger,
    private readonly config: HomebridgeDualCS529Config,
    public readonly api: HomebridgeAPI,
  ) {
    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    const uuid = accessory.UUID;
    this.log.debug('Restoring accessory from cache:', accessory.displayName, uuid);
    this.createDeviceAccessory(accessory);
  }

  private async discoverDevices(): Promise<void> {
    const name = this.config.deviceName ?? 'CS529';
    const accessoryTag = this.config.peripheralId ?? this.config.peripheralName ?? name;
    const accessoryId = `homebridge-dual-cs529-${name}-${accessoryTag}`;
    const uuid = this.api.hap.uuid.generate(accessoryId);
    if (this.accessories.has(uuid)) {
      return;
    }

    const accessory = this.api.platformAccessory(name, uuid);
    this.api.registerPlatformAccessories('homebridge-dual-cs529', 'DualCS529', [accessory]);
    this.createDeviceAccessory(accessory);
  }

  private createDeviceAccessory(accessory: PlatformAccessory): void {
    if (this.accessories.has(accessory.UUID)) {
      return;
    }

    const client = this.createClient();
    const options: DualCS529ControllerOptions = {
      pollIntervalMs: this.config.pollIntervalMs,
      reconnectDelayMs: this.config.reconnectDelayMs,
      reconnectMaxAttempts: this.config.reconnectMaxAttempts,
    };

    const controller = new DualCS529Controller(client, options);
    this.controllers.set(accessory.UUID, controller);
    const pluginAccessory = new DualCS529Accessory(
      controller,
      this.api.hap,
      accessory,
      {
        deviceName: this.config.deviceName ?? 'CS529',
      },
    );

    this.accessories.set(accessory.UUID, pluginAccessory);
    void controller.initialize();
  }

  private createClient(): BLEClient {
    const options: BLEAdapterOptions = {
      peripheralId: this.config.peripheralId,
      peripheralName: this.config.peripheralName ?? this.config.deviceName,
      serviceUuid: this.config.serviceUuid,
      commandCharacteristicUuid: this.config.commandCharacteristicUuid,
      notifyCharacteristicUuid: this.config.notifyCharacteristicUuid,
    };
    return new NobleBLEClient(options);
  }
}
