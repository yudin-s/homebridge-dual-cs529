import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedTransport } from '../src/transport';
import { DualCS529Controller } from '../src/controller';
import { Protocol } from '../src/protocol';

describe('controller reconnect behavior', () => {
  let transport: SimulatedTransport;
  let controller: DualCS529Controller;

  beforeEach(async () => {
    transport = new SimulatedTransport({ latencyMs: 1 });
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

    await transport.connect();
    await new Promise((resolve) => setTimeout(resolve, 40));

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
    await transport.disconnect();
    await transport.connect();
    await new Promise((resolve) => setTimeout(resolve, 40));

    const restored = statuses.at(-1);
    expect(restored).toBeDefined();
    expect(restored?.loopMode).toBe(true);
  });
});
