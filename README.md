# homebridge-dual-cs529

Homebridge dynamic platform plugin for Dual CS529.

## Features

- Dynamic platform plugin for Homebridge
- Power / Start-Stop switch
- Speed switches (33 / 45 / 78)
- Repeat mode switch
- Loop mode switch
- Reconnect with desired-state restoration on reconnect
- Simulated transport for local testing without a physical CS 529
- Socket transport abstraction for a future BLE bridge process or external protocol probe

## Installation

```bash
npm install -g homebridge-dual-cs529
```

## Configuration

```json
{
  "platform": "DualCS529",
  "name": "DualCS529",
  "deviceName": "CS529",
  "host": "192.168.1.20",
  "port": 3333,
  "simulate": false,
  "pollIntervalMs": 120000,
  "reconnectDelayMs": 2000,
  "reconnectMaxAttempts": 15
}
```

## Notes

- Set `simulate: true` to use the in-memory transport when developing or running unit tests.
- Commands are sent using the protocol patterns extracted from APK traffic:
  - `@0PTTTRS33`, `@0PTTTRS45`, `@0PTTTRS78`
  - `@0PTTTST00`, `@0PTTTST01`, `@0PTTTST02`
  - `@0PTTTRP%02d`
  - `@0PTTTLS%02d`
- Query commands use the APK-visible form: `@0?PTTTRS`, `@0?PTTTST`, `@0?PTTTLS`, `@0?PTTTRP`.
- The real BLE layer is intentionally isolated behind the transport interface. Replace or extend the socket transport with a Noble/BlueZ transport once a physical device is available for validation.

## Development

```bash
npm install
npm run build
npm test
```
