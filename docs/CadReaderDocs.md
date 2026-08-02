# CadReader

Both `DwgReader` and `DxfReader` follow the same pattern: construct with a binary buffer and an optional notification handler, then call `Read()` to get a `CadDocument`.

## DwgReader

Reads DWG binary files. Supports versions AC1014 through AC1032.

### Static methods

```ts
import fs from 'fs';
import { DwgReader, DwgReaderConfiguration } from '@node-projects/acad-ts';

const buffer = fs.readFileSync('drawing.dwg');
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

// Simple read
const doc = DwgReader.readFromStream(arrayBuffer);

// With notification handler
const doc2 = DwgReader.readFromStream(arrayBuffer, (_sender, event) => {
  console.log(`[${event.notificationType}] ${event.message}`);
});

// With configuration
const config = new DwgReaderConfiguration();
config.failsafe = false;
config.maxDecompressedSectionSize = 256 * 1024 * 1024;
const doc3 = DwgReader.readFromStreamWithConfig(arrayBuffer, config, notification);
```

### Instance usage

```ts
const reader = new DwgReader(arrayBuffer, notification);
reader.configuration.failsafe = false;
const doc = reader.read();
```

## DxfReader

Reads DXF files in both ASCII and binary format. Supports versions AC1009 through AC1032.

DXF string decoding follows `$DWGCODEPAGE` for both ASCII and binary DXF once the reader sees the raw bytes. Keep the source as `Uint8Array`; if you decode the file to a JavaScript string before calling `DxfReader`, any legacy-codepage bytes have already been normalized by the host runtime.

### Static methods

```ts
import fs from 'fs';
import { DxfReader } from '@node-projects/acad-ts';

const buffer = fs.readFileSync('drawing.dxf');
const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

// Simple read
const doc = DxfReader.readFromStream(data);

// Check if file is binary DXF
const isBinary = DxfReader.isBinaryStream(data);
```

### Instance usage

```ts
const reader = new DxfReader(data, notification);
const doc = reader.read();
```

## Reader configuration

Both readers inherit from `CadReaderBase<T>` and expose a `configuration` property.

| Property | Type | Default | Description |
|---|---|---|---|
| `failsafe` | `boolean` | `true` | When `true`, catches supported assignment errors during reading and continues. When `false`, throws on the first such error. |
| `keepUnknownEntities` | `boolean` | `false` | Keep entity types that the reader does not recognize. |
| `keepUnknownNonGraphicalObjects` | `boolean` | `false` | Keep non-graphical object types that the reader does not recognize. |

`DwgReaderConfiguration` also exposes `maxDecompressedSectionSize`, which defaults to 512 MiB. Lower it when processing untrusted files under a tighter memory budget, or raise it explicitly for known large drawings.

`DxfReaderConfiguration.clearCache` defaults to `false` so the bounded metadata map cache is reused across files. Set it to `true` when an application explicitly needs to discard that cache after each read.

## Notification handler

The notification handler is called during reading to report warnings, errors, or informational messages:

```ts
function onNotification(_sender: object | null, event: NotificationEventArgs): void {
  console.log(`[${event.notificationType}] ${event.message}`);
  if (event.exception) {
    console.error(event.exception);
  }
}
```
