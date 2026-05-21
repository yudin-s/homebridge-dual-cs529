import { EventEmitter } from 'node:events';
import { clearInterval, setInterval, setTimeout } from 'node:timers';
import {
  parseProtocolMessage,
  PartialDeviceState,
  Protocol,
  DeviceState,
  DEFAULT_DEVICE_STATE,
  DeviceSpeed,
  StartStopMode,
  parseStatusPayload,
} from './protocol';
import { BLEClient, ProtocolFrame } from './transport';

export interface DualCS529ControllerOptions {
  pollIntervalMs?: number;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
}

export class DualCS529Controller extends EventEmitter {
  private readonly options: Required<DualCS529ControllerOptions>;
  private readonly desiredState: PartialDeviceState = {};
  private readonly poller?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private reconnecting = false;
  private destroyed = false;
  private state: DeviceState = { ...DEFAULT_DEVICE_STATE };

  public constructor(
    private readonly client: BLEClient,
    options: DualCS529ControllerOptions = {},
  ) {
    super();
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 120_000,
      reconnectDelayMs: options.reconnectDelayMs ?? 2_000,
      reconnectMaxAttempts: options.reconnectMaxAttempts ?? 15,
    };

    this.client.on('connected', () => this.handleConnected());
    this.client.on('disconnected', () => this.handleDisconnected());
    this.client.on('message', (frame: ProtocolFrame) => this.handleMessage(frame.message));
    this.client.on('error', (error) => this.handleError(error));

    if (this.options.pollIntervalMs > 0) {
      this.poller = setInterval(() => this.queryAll(), this.options.pollIntervalMs).unref();
    }
  }

  public get status(): DeviceState {
    return { ...this.state };
  }

  public async initialize(): Promise<void> {
    await this.connect();
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.poller) {
      clearInterval(this.poller);
    }
    void this.client.disconnect();
    this.removeAllListeners();
  }

  public async connect(): Promise<void> {
    if (this.client.isConnected) {
      return;
    }
    try {
      await this.client.connect();
      this.reconnectAttempts = 0;
      this.reconnecting = false;
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  public async setPowerState(power: boolean): Promise<void> {
    const mode: StartStopMode = power ? 1 : 0;
    this.desiredState.power = power;
    this.desiredState.startStopMode = mode;
    this.state.power = power;
    this.state.startStopMode = mode;
    this.emitState();
    await this.sendOrSchedule(Protocol.power.buildStartStopCommand(mode));
  }

  public async setSpeed(speed: DeviceSpeed): Promise<void> {
    this.desiredState.speed = speed;
    this.state.speed = speed;
    this.emitState();
    await this.sendOrSchedule(Protocol.speed.buildCommand(speed));
  }

  public async setRepeatMode(enabled: boolean): Promise<void> {
    this.desiredState.repeatMode = enabled;
    this.state.repeatMode = enabled;
    this.emitState();
    await this.sendOrSchedule(Protocol.repeat.buildCommand(enabled));
  }

  public async setLoopMode(enabled: boolean): Promise<void> {
    this.desiredState.loopMode = enabled;
    this.state.loopMode = enabled;
    this.emitState();
    await this.sendOrSchedule(Protocol.loop.buildCommand(enabled));
  }

  public async queryAll(): Promise<void> {
    await this.sendOrSchedule(Protocol.query.all);
  }

  private async sendOrSchedule(command: string): Promise<void> {
    if (!this.client.isConnected) {
      this.handleError(new Error('ble client is not connected'));
      return;
    }
    try {
      await this.client.send(command);
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  private async handleConnected(): Promise<void> {
    if (this.destroyed) return;
    await this.restoreDesiredState();
  }

  private handleDisconnected(): void {
    if (this.destroyed || this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    this.scheduleReconnect();
    this.emitState();
  }

  private handleError(error: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
    this.scheduleReconnect();
  }

  private async handleMessage(raw: string): Promise<void> {
    let payload = parseStatusPayload(raw);
    if (Object.keys(payload).length === 0) {
      payload = parseProtocolMessage(raw);
    }
    const merged: DeviceState = { ...this.state, ...payload };
    this.state = merged;
    this.emitState();
  }

  private async restoreDesiredState(): Promise<void> {
    const toRestore: Array<() => Promise<void>> = [];

    if (this.desiredState.power !== undefined) {
      const mode = this.desiredState.power ? 1 : 0;
      toRestore.push(() => this.sendOrSchedule(Protocol.power.buildStartStopCommand(mode)));
    }
    if (this.desiredState.speed !== undefined) {
      toRestore.push(() => this.sendOrSchedule(Protocol.speed.buildCommand(this.desiredState.speed!)));
    }
    if (this.desiredState.repeatMode !== undefined) {
      toRestore.push(() => this.sendOrSchedule(Protocol.repeat.buildCommand(this.desiredState.repeatMode!)));
    }
    if (this.desiredState.loopMode !== undefined) {
      toRestore.push(() => this.sendOrSchedule(Protocol.loop.buildCommand(this.desiredState.loopMode!)));
    }

    for (const send of toRestore) {
      await send();
    }
    this.emitState();
    await this.queryAll();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || !this.reconnecting) {
      this.reconnecting = true;
    }

    if (this.reconnectAttempts >= this.options.reconnectMaxAttempts) {
      this.emitState();
      return;
    }

    if (!this.destroyed) {
      this.emitState();
      setTimeout(async () => {
        this.reconnectAttempts += 1;
        if (this.destroyed) {
          return;
        }
        try {
          await this.connect();
        } catch {
          this.scheduleReconnect();
        }
      }, this.options.reconnectDelayMs).unref();
    }
  }

  private emitState(): void {
    this.emit('status', { ...this.state });
  }
}
