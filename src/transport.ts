import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { Protocol, ProtocolStatusFrame } from './protocol';

export interface TransportEvents {
  connected: () => void;
  disconnected: () => void;
  message: (frame: ProtocolStatusFrame) => void;
  error: (error: Error) => void;
}

export interface Transport extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: string): Promise<void>;
  readonly isConnected: boolean;
}

export interface TransportOptions {
  host: string;
  port: number;
}

export class SocketTransport extends EventEmitter implements Transport {
  private socket?: Socket;
  private connected = false;

  constructor(private readonly options: TransportOptions) {
    super();
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<void> {
    if (this.socket && this.connected) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      const onError = (error: Error) => {
        socket.off('connect', onConnect);
        socket.off('error', onError);
        reject(error);
      };

      const onConnect = () => {
        socket.off('error', onError);
        socket.off('connect', onConnect);
        this.connected = true;
        this.socket = socket;
        socket.on('data', (data) => this.handleData(data));
        socket.on('close', () => this.onDisconnect());
        this.emit('connected');
        resolve();
      };

      socket.once('error', onError);
      socket.connect(this.options.port, this.options.host, onConnect);
    });
  }

  public async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket.removeAllListeners();
      this.socket = undefined;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  public async send(command: string): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error('socket transport is not connected');
    }

    return new Promise((resolve, reject) => {
      this.socket!.write(`${command}\n`, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private handleData(data: Buffer): void {
    const raw = data.toString('utf8');
    const frame: ProtocolStatusFrame = {
      timestamp: new Date().toISOString(),
      message: raw.trim(),
    };
    this.emit('message', frame);
  }

  private onDisconnect(): void {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.emit('disconnected');
  }
}

interface SimulatedTransportState {
  power: boolean;
  startStopMode: 0 | 1 | 2;
  speed: 33 | 45 | 78;
  repeatMode: boolean;
  loopMode: boolean;
}

export interface SimulatedTransportOptions {
  initialState?: Partial<SimulatedTransportState>;
  name?: string;
  latencyMs?: number;
}

export class SimulatedTransport extends EventEmitter implements Transport {
  private connected = false;
  private readonly latencyMs: number;
  private readonly sentCommands: string[] = [];
  private state: SimulatedTransportState;

  public constructor(private readonly options: SimulatedTransportOptions = {}) {
    super();
    this.latencyMs = options.latencyMs ?? 20;
    this.state = {
      power: false,
      startStopMode: 0,
      speed: 33,
      repeatMode: false,
      loopMode: false,
      ...options.initialState,
    };
  }

  public get isConnected(): boolean {
    return this.connected;
  }

  public get sentCommandLog(): string[] {
    return [...this.sentCommands];
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.delay();
    this.connected = true;
    this.emit('connected');
    this.emitStatus();
  }

  public async disconnect(): Promise<void> {
    this.connected = false;
    await this.delay();
    this.emit('disconnected');
  }

  public async send(command: string): Promise<void> {
    if (!this.connected) {
      throw new Error('simulated transport is not connected');
    }

    this.sentCommands.push(command);
    await this.delay();

    const normalized = command.trim();
    const startStop = Protocol.power.parse(normalized);
    if (startStop !== undefined) {
      this.state.startStopMode = startStop;
      this.state.power = startStop === 1;
    }

    const speed = Protocol.speed.parse(normalized);
    if (speed !== undefined) {
      this.state.speed = speed;
    }

    const repeat = Protocol.repeat.parse(normalized);
    if (repeat !== undefined) {
      this.state.repeatMode = repeat;
    }

    const loop = Protocol.loop.parse(normalized);
    if (loop !== undefined) {
      this.state.loopMode = loop;
    }

    if (normalized === Protocol.query.startStop) {
      this.emitStatus();
      return;
    }
    if (normalized === Protocol.query.repeat) {
      this.emitStatus();
      return;
    }
    if (normalized === Protocol.query.loop) {
      this.emitStatus();
      return;
    }
    if (normalized === Protocol.query.speed || normalized === Protocol.query.all) {
      this.emitStatus();
      return;
    }

    this.emit(
      'message',
      this.toFrame(
        `${Protocol.power.buildStartStopCommand(this.state.startStopMode)};${Protocol.speed.buildCommand(this.state.speed)};${Protocol.repeat.buildCommand(this.state.repeatMode)};${Protocol.loop.buildCommand(this.state.loopMode)}`,
      ),
    );
  }

  public simulateIncoming(message: string): void {
    this.emit('message', this.toFrame(message));
  }

  public async injectStateUpdate(patch: Partial<SimulatedTransportState>): Promise<void> {
    this.state = { ...this.state, ...patch };
    await this.delay();
    this.emitStatus();
  }

  private emitStatus(): void {
    const payload = `${Protocol.power.buildStartStopCommand(this.state.startStopMode)};${Protocol.speed.buildCommand(this.state.speed)};${Protocol.repeat.buildCommand(this.state.repeatMode)};${Protocol.loop.buildCommand(this.state.loopMode)}`;
    this.emit('message', this.toFrame(payload));
  }

  private toFrame(message: string): ProtocolStatusFrame {
    return {
      timestamp: new Date().toISOString(),
      message,
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}
