# homebridge-dual-cs529

[![npm version](https://img.shields.io/npm/v/homebridge-dual-cs529.svg)](https://www.npmjs.com/package/homebridge-dual-cs529)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-dual-cs529.svg)](https://www.npmjs.com/package/homebridge-dual-cs529)
[![license](https://img.shields.io/npm/l/homebridge-dual-cs529.svg)](LICENSE)

Homebridge dynamic platform plugin for controlling a Dual CS 529 vinyl turntable / record player over Bluetooth LE.

The plugin exposes HomeKit switches for start/stop, turntable speed, repeat mode, and loop mode. It uses the BLE control protocol observed in the official Dual BLE Remoter Android APK.

## Status

This plugin is a reverse-engineered implementation with automated tests for protocol formatting, BLE discovery, reconnect, and state restore.

## Features

- Auto-discovers the first connectable Dual CS 529 / Dual CS turntable using the Nordic UART BLE service.
- Optional pinning by BLE peripheral ID or peripheral name prefix.
- Power / Start-Stop switch.
- Speed switches for 33, 45, and 78 RPM.
- Repeat mode switch.
- Loop mode switch.
- Periodic status polling using APK-visible query commands.
- Automatic reconnect with desired-state restoration after BLE errors or disconnects.
- Homebridge Plugin Settings GUI via `config.schema.json`.

## Installation

### Homebridge UI

1. Open Homebridge UI.
2. Go to **Plugins**.
3. Search for `homebridge-dual-cs529`.
4. Install the plugin.
5. Configure it from the plugin settings screen.

The package appears in Homebridge plugin search after it is published to npm with the `homebridge-plugin` keyword.

### npm

```bash
npm install -g homebridge-dual-cs529
```

## Configuration

Minimal configuration:

```json
{
  "platform": "DualCS529",
  "name": "Dual CS529",
  "deviceName": "Dual CS529"
}
```

Advanced configuration:

```json
{
  "platform": "DualCS529",
  "name": "Dual CS529",
  "deviceName": "Dual CS529",
  "peripheralId": "AA:BB:CC:DD:EE:FF",
  "peripheralName": "Dual",
  "serviceUuid": "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  "commandCharacteristicUuid": "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  "notifyCharacteristicUuid": "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  "pollIntervalMs": 120000,
  "reconnectDelayMs": 2000,
  "reconnectMaxAttempts": 15
}
```

| Setting | Required | Default | Description |
| --- | --- | --- | --- |
| `platform` | yes | `DualCS529` | Homebridge platform alias. |
| `name` | yes | `Dual CS529` | Platform name shown in Homebridge. |
| `deviceName` | yes | `Dual CS529` | HomeKit accessory display name. |
| `peripheralId` | no | empty | BLE address / ID to pin a specific turntable. Leave empty for auto-discovery. |
| `peripheralName` | no | empty | BLE name prefix to pin discovery, for example `Dual` or `CS529`. |
| `serviceUuid` | no | Nordic UART service | BLE service UUID used for control. |
| `commandCharacteristicUuid` | no | Nordic UART RX | BLE characteristic used to write commands. |
| `notifyCharacteristicUuid` | no | Nordic UART TX | BLE characteristic used to receive notifications. |
| `pollIntervalMs` | no | `120000` | Status polling interval. |
| `reconnectDelayMs` | no | `2000` | Delay before reconnect attempts. |
| `reconnectMaxAttempts` | no | `15` | Maximum reconnect attempts before giving up until Homebridge restarts. |

## Discovery

By default, the plugin creates one HomeKit accessory and connects it to the first matching Dual CS 529 / Dual CS turntable it can successfully use over BLE. It scans for the Nordic UART service UUID found in the APK. If an early candidate cannot connect or does not expose the expected command/notify characteristics, scanning continues until another candidate works or the scan times out.

Use `peripheralId` or `peripheralName` only when you want to pin the plugin to a specific record player.

## HomeKit Controls

The Dual CS 529 is represented as a group of HomeKit switches:

- `Power / Start-Stop`
- `Speed 33`
- `Speed 45`
- `Speed 78`
- `Repeat Mode`
- `Loop Mode`

HomeKit does not have a native vinyl turntable service, so switches are used for reliable control and automation support.

## BLE Protocol Notes

Commands are based on strings found in the official Android APK:

```text
@0PTTTRS33
@0PTTTRS45
@0PTTTRS78
@0PTTTST00
@0PTTTST01
@0PTTTST02
@0PTTTRP%02d
@0PTTTLS%02d
```

Query commands use the APK-visible form:

```text
@0?PTTTRS
@0?PTTTST
@0?PTTTLS
@0?PTTTRP
```

The default BLE UUIDs are the Nordic UART service and RX/TX characteristics found in the APK. Override them only if your device exposes different values.

## Bluetooth Requirements

`@abandonware/noble` may require OS-level Bluetooth permissions and native BLE dependencies, especially on Linux/Raspberry Pi. Make sure the user running Homebridge can access the Bluetooth adapter. The plugin does not use post-install scripts and does not modify the host system.

## Development

```bash
npm install
npm run build
npm test
npm pack --dry-run
```

For local Homebridge testing:

```bash
npm link
homebridge -D
```

## Publishing Checklist

1. Create a public GitHub repository with issues enabled.
2. Push this repository to `https://github.com/yudin-s/homebridge-dual-cs529`.
3. Confirm `npm run build`, `npm test`, and `npm pack --dry-run` pass.
4. Publish to npm:

```bash
npm publish
```

5. Create a GitHub release with release notes for the published version.
6. Install from Homebridge UI by searching for `homebridge-dual-cs529`.

## Verified by Homebridge Readiness

This package is structured for the Homebridge verification path:

- dynamic platform plugin;
- npm package named `homebridge-dual-cs529`;
- `homebridge-plugin` npm keyword;
- Homebridge Settings GUI via `config.schema.json`;
- no analytics;
- no post-install scripts;
- GitHub repository metadata in `package.json`;
- tests and dry-run packaging commands documented.

Verification should wait until the plugin has been tested with a real Dual CS 529 vinyl turntable.

## License

MIT
