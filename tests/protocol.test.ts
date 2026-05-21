import { describe, expect, it } from 'vitest';
import {
  DeviceSpeed,
  Protocol,
  parseProtocolMessage,
  parseStatusPayload,
} from '../src/protocol';

describe('protocol commands', () => {
  it('builds start-stop command', () => {
    expect(Protocol.power.buildStartStopCommand(0)).toBe('@0PTTTST00');
    expect(Protocol.power.buildStartStopCommand(1)).toBe('@0PTTTST01');
    expect(Protocol.power.buildStartStopCommand(2)).toBe('@0PTTTST02');
  });

  it('builds speed commands', () => {
    expect(Protocol.speed.buildCommand(33)).toBe('@0PTTTRS33');
    expect(Protocol.speed.buildCommand(45)).toBe('@0PTTTRS45');
    expect(Protocol.speed.buildCommand(78)).toBe('@0PTTTRS78');
  });

  it('builds repeat command', () => {
    expect(Protocol.repeat.buildCommand(true)).toBe('@0PTTTRP01');
    expect(Protocol.repeat.buildCommand(false)).toBe('@0PTTTRP00');
  });

  it('builds loop command', () => {
    expect(Protocol.loop.buildCommand(true)).toBe('@0PTTTLS01');
    expect(Protocol.loop.buildCommand(false)).toBe('@0PTTTLS00');
  });

  it('builds query commands', () => {
    expect(Protocol.query.version).toBe('@0?PTSTVN');
    expect(Protocol.query.startStop).toBe('@0?PTTTST');
    expect(Protocol.query.speed).toBe('@0?PTTTRS');
    expect(Protocol.query.repeat).toBe('@0?PTTTRP');
    expect(Protocol.query.loop).toBe('@0?PTTTLS');
    expect(Protocol.query.all).toBe('@0?PTTTRS;@0?PTTTST;@0?PTTTLS;@0?PTTTRP');
  });
});

describe('protocol parser', () => {
  it('parses frame payload', () => {
    const message = '@0PTTTST01;@0PTTTRS45;@0PTTTRP01;@0PTTTLS01';
    const parsed = parseProtocolMessage(message);
    expect(parsed).toEqual({});
    const payload = parseStatusPayload(message);
    expect(payload.power).toBe(true);
    expect(payload.speed).toBe(45 as DeviceSpeed);
    expect(payload.repeatMode).toBe(true);
    expect(payload.loopMode).toBe(true);
    expect(payload.startStopMode).toBe(1);
  });

  it('ignores garbage lines', () => {
    const payload = parseStatusPayload('@@invalid;@0PTTTRS78;');
    expect(payload.speed).toBe(78 as DeviceSpeed);
    expect(payload.power).toBeUndefined();
  });
});
