import type { DualCS529Controller } from './controller';
import { DeviceSpeed } from './protocol';

type CharacteristicValue = unknown;
type HAP = {
  Service: {
    Switch: unknown;
  };
  Characteristic: {
    On: unknown;
  };
};
type Characteristic = {
  onGet: (cb: () => CharacteristicValue) => Characteristic;
  onSet: (cb: (v: CharacteristicValue) => Promise<void>) => Characteristic;
  updateValue: (v: boolean) => void;
};
type Service = {
  getCharacteristic: (c: unknown) => Characteristic;
};
type PlatformAccessory = {
  UUID: string;
  displayName: string;
  context: Record<string, unknown>;
  addService: (s: unknown, name: string, subType: string) => Service;
  getService: (name: string) => Service | undefined;
  services: unknown;
};

interface AccessoryConfig {
  deviceName: string;
  onStartStop?: boolean;
  speed?: DeviceSpeed;
  repeatMode?: boolean;
  loopMode?: boolean;
}

export class DualCS529Accessory {
  private powerService: Service;
  private speed33Service: Service;
  private speed45Service: Service;
  private speed78Service: Service;
  private repeatService: Service;
  private loopService: Service;

  private readonly hap: HAP;
  private readonly accessory: PlatformAccessory;
  private readonly controller: DualCS529Controller;
  private state = {
    power: false,
    speed: 33 as DeviceSpeed,
    repeatMode: false,
    loopMode: false,
  };

  public constructor(
    controller: DualCS529Controller,
    hap: HAP,
    accessory: PlatformAccessory,
    cfg: AccessoryConfig,
  ) {
    this.controller = controller;
    this.accessory = accessory;
    this.hap = hap;
    this.state = {
      power: cfg.onStartStop ?? false,
      speed: cfg.speed ?? 33,
      repeatMode: cfg.repeatMode ?? false,
      loopMode: cfg.loopMode ?? false,
    };

    this.powerService = this.accessory.getService('Power / Start-Stop') ?? this.accessory.addService(this.hap.Service.Switch, 'Power / Start-Stop', 'power');
    this.speed33Service = this.accessory.getService('Speed 33') ?? this.accessory.addService(this.hap.Service.Switch, 'Speed 33', 'speed33');
    this.speed45Service = this.accessory.getService('Speed 45') ?? this.accessory.addService(this.hap.Service.Switch, 'Speed 45', 'speed45');
    this.speed78Service = this.accessory.getService('Speed 78') ?? this.accessory.addService(this.hap.Service.Switch, 'Speed 78', 'speed78');
    this.repeatService = this.accessory.getService('Repeat Mode') ?? this.accessory.addService(this.hap.Service.Switch, 'Repeat Mode', 'repeat');
    this.loopService = this.accessory.getService('Loop Mode') ?? this.accessory.addService(this.hap.Service.Switch, 'Loop Mode', 'loop');

    this.bindServiceHandlers();
    this.syncFromController();
    this.controller.on('status', (state) => {
      this.state = {
        power: state.power,
        speed: state.speed,
        repeatMode: state.repeatMode,
        loopMode: state.loopMode,
      };
      this.syncFromController();
    });
  }

  public getAccessory(): PlatformAccessory {
    return this.accessory;
  }

  private bindServiceHandlers(): void {
    const on = (value: CharacteristicValue) => Boolean(value);
    const onChar = (service: Service) => service.getCharacteristic(this.hap.Characteristic.On);

    onChar(this.powerService)
      .onGet(() => this.state.power)
      .onSet(async (value: CharacteristicValue) => {
        const isOn = on(value);
        await this.controller.setPowerState(isOn);
        this.syncFromController();
      });

    onChar(this.speed33Service)
      .onGet(() => this.state.speed === 33)
      .onSet(async (value: CharacteristicValue) => {
        const isOn = on(value);
        if (!isOn) {
          return;
        }
        this.state.speed = 33;
        await this.controller.setSpeed(33);
        this.syncFromController();
      });

    onChar(this.speed45Service)
      .onGet(() => this.state.speed === 45)
      .onSet(async (value: CharacteristicValue) => {
        const isOn = on(value);
        if (!isOn) {
          return;
        }
        this.state.speed = 45;
        await this.controller.setSpeed(45);
        this.syncFromController();
      });

    onChar(this.speed78Service)
      .onGet(() => this.state.speed === 78)
      .onSet(async (value: CharacteristicValue) => {
        const isOn = on(value);
        if (!isOn) {
          return;
        }
        this.state.speed = 78;
        await this.controller.setSpeed(78);
        this.syncFromController();
      });

    onChar(this.repeatService)
      .onGet(() => this.state.repeatMode)
      .onSet(async (value: CharacteristicValue) => {
        const isOn = on(value);
        await this.controller.setRepeatMode(isOn);
        this.syncFromController();
      });

    onChar(this.loopService)
      .onGet(() => this.state.loopMode)
      .onSet(async (value: CharacteristicValue) => {
        const isOn = on(value);
        await this.controller.setLoopMode(isOn);
        this.syncFromController();
      });
  }

  private syncFromController(): void {
    const characteristic = (service: Service) => service.getCharacteristic(this.hap.Characteristic.On);
    characteristic(this.powerService).updateValue(this.state.power);
    characteristic(this.speed33Service).updateValue(this.state.speed === 33);
    characteristic(this.speed45Service).updateValue(this.state.speed === 45);
    characteristic(this.speed78Service).updateValue(this.state.speed === 78);
    characteristic(this.repeatService).updateValue(this.state.repeatMode);
    characteristic(this.loopService).updateValue(this.state.loopMode);
  }
}
