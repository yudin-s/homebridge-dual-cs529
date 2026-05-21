# homebridge-dual-cs529

Homebridge dynamic platform plugin for Dual CS529.

## Features

- Dynamic platform plugin for Homebridge
- Power / Start-Stop switch
- Speed switches (33 / 45 / 78)
- Repeat mode switch
- Loop mode switch
- Reconnect with desired-state restoration on reconnect
- Native BLE transport built on `@abandonware/noble`

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
  "serviceUuid": "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  "commandCharacteristicUuid": "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  "notifyCharacteristicUuid": "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  "pollIntervalMs": 120000,
  "reconnectDelayMs": 2000,
  "reconnectMaxAttempts": 15
}
```

Discovery by default creates one HomeKit accessory and auto-connects it to the first matching and connectable Dual CS529 / Dual CS turntable found via the Nordic UART service UUID from the APK. If an early candidate cannot connect or does not expose the expected command/notify characteristics, the plugin keeps scanning until another candidate works or the scan times out. `peripheralId` and `peripheralName` are optional pinning filters; `peripheralName` is treated as a prefix.

## Notes

- Commands are sent using the protocol patterns extracted from APK traffic:
  - `@0PTTTRS33`, `@0PTTTRS45`, `@0PTTTRS78`
  - `@0PTTTST00`, `@0PTTTST01`, `@0PTTTST02`
  - `@0PTTTRP%02d`
  - `@0PTTTLS%02d`
- Query commands use the APK-visible form: `@0?PTTTRS`, `@0?PTTTST`, `@0?PTTTLS`, `@0?PTTTRP`.
- Unit tests mock the BLE adapter and exercise reconnect + restore behavior without any physical device.
- The UUIDs above are the Nordic UART service and RX/TX characteristics found in the APK. Override them only if a real device scan shows different values.

## Development

```bash
npm install
npm run build
npm test
```
