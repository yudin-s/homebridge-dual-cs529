import { beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { BLEClient, ProtocolFrame } from '../src/transport';
import { DualCS529Controller } from '../src/controller';
import { Protocol } from '../src/protocol';

class MockBleClient extends EventEmitter implements BLEClient {
  private connected = false;
  public sentCommandLog: string[] = [];
  public connectCalls = 0;
  public disconnectCalls = 0;

  public get isConnected(): boolean {
    return this.connected;
  }

  public async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
    this.emit('connected');
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    if (!this.connected) {
      return;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  public async send(command: string): Promise<void> {
    if (!this.connected) {
      throw new Error('mock ble client is not connected');
    }
    this.sentCommandLog.push(command);
  }

  public emitStatus(message: string): void {
    const frame: ProtocolFrame = {
      timestamp: new Date().toISOString(),
      message,
    };
    this.emit('message', frame);
  }
}

describe('controller reconnect behavior', () => {
  let transport: MockBleClient;
  let controller: DualCS529Controller;

  beforeEach(async () => {
    transport = new MockBleClient();
    controller = new DualCS529Controller(transport, {
      reconnectDelayMs: 5,
      reconnectMaxAttempts: 5,
      pollIntervalMs: 0,
    });
    await controller.connect();
  });

  it('restores desired repeat and speed after reconnect', async () => {
    await controller.setSpeed(78);
    await controller.setRepeatMode(true);
    expect(controller.status.speed).toBe(78);
    expect(controller.status.repeatMode).toBe(true);

    await transport.disconnect();
    await controller.setLoopMode(true);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(transport.connectCalls).toBe(2);
    expect(transport.disconnectCalls).toBe(1);
    const log = transport.sentCommandLog;
    const hasRepeat = log.some((line) => line === Protocol.repeat.buildCommand(true));
    const hasSpeed = log.some((line) => line === Protocol.speed.buildCommand(78));
    const hasLoop = log.some((line) => line === Protocol.loop.buildCommand(true));
    const hasQuery = log.includes(Protocol.query.all);

    expect(hasRepeat).toBeTruthy();
    expect(hasSpeed).toBeTruthy();
    expect(hasLoop).toBeTruthy();
    expect(hasQuery).toBeTruthy();
  });

  it('queues desired state then emits restored status', async () => {
    const statuses: Array<typeof controller.status> = [];
    controller.on('status', (state) => {
      statuses.push(state);
    });

    await controller.setLoopMode(true);
    await transport.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));

    const restored = statuses.at(-1);
    expect(restored).toBeDefined();
    expect(restored?.loopMode).toBe(true);
  });
});
