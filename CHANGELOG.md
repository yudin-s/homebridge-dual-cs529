# Changelog

All notable changes to this project will be documented in this file.

## 0.1.0

- Initial Homebridge dynamic platform plugin for Dual CS 529 vinyl turntables.
- Added Bluetooth LE control over the Nordic UART service found in the official Android APK.
- Added HomeKit switches for start/stop, 33/45/78 RPM speed selection, repeat mode, and loop mode.
- Added automatic BLE discovery of the first connectable matching Dual CS turntable.
- Added reconnect handling with desired-state restoration.
- Added Homebridge Settings GUI schema.
- Added protocol, controller, reconnect, and BLE discovery tests.
