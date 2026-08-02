import { DxfStreamReaderBase } from './DxfStreamReaderBase.js';
import { DxfCode } from '../../../DxfCode.js';

export class DxfBinaryReader extends DxfStreamReaderBase {
  public static readonly sentinel: string = 'AutoCAD Binary DXF\r\n\x1a\0';

  public static readonly sentinelBytes: Uint8Array = new Uint8Array([
    0x41, 0x75, 0x74, 0x6F, 0x43, 0x41, 0x44, 0x20,
    0x42, 0x69, 0x6E, 0x61, 0x72, 0x79, 0x20, 0x44,
    0x58, 0x46, 0x0D, 0x0A, 0x1A, 0x00,
  ]);

  protected get baseStream(): Uint8Array {
    return this._data;
  }

  protected _data: Uint8Array;
  protected _view: DataView;
  protected _pos: number = 0;
	private _chunkStart: number = 0;
	private _chunkEnd: number = 0;
	private _deferredIsChunk: boolean = false;
	private _strStart: number = 0;
	private _strEnd: number = 0;
	private _rawDecoded: string | null = '';

	public override get valueRaw(): string {
		if (this._rawDecoded === null) {
			this._rawDecoded = this.decodeStringRange(this._data, this._strStart, this._strEnd);
		}
		return this._rawDecoded;
	}

	public override set valueRaw(value: string) {
		this._rawDecoded = value;
	}

  public constructor(stream: Uint8Array) {
    super();
    this._data = stream;
    this._view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    this.start();
  }

  public override start(): void {
    super.start();
    this._pos = 0;

    // Skip sentinel (22 bytes)
    this._pos = 22;
    this.position = this._pos;
  }

  protected readStringLine(): string {
    const start = this._pos;
    const data = this._data;
    const dataLength = data.length;
    // Manual scan beats the native indexOf call cost for short strings.
    let end = start;
    while (end < dataLength && data[end] !== 0) {
      end++;
    }
    this._pos = end;

    // Decoding is deferred: tokens whose value is never read skip the
    // subarray + decode entirely.
    this._strStart = start;
    this._strEnd = end;
    this._rawDecoded = null;
    this._deferredIsChunk = false;
    this.deferCurrentValue();

    if (this._pos < this._data.length) {
      this._pos++;
    }
    this.position = this._pos;
    return undefined as unknown as string;
  }

  protected readCode(): DxfCode {
    const code = this._view.getInt16(this._pos, true);
    this._pos += 2;
    this.position = this._pos;
    return code as DxfCode;
  }

  protected lineAsBool(): boolean {
    const val = this._data[this._pos++];
    this.position = this._pos;
    return val > 0;
  }

  protected lineAsDouble(): number {
    const val = this._view.getFloat64(this._pos, true);
    this._pos += 8;
    this.position = this._pos;
    return val;
  }

  protected lineAsShort(): number {
    const val = this._view.getInt16(this._pos, true);
    this._pos += 2;
    this.position = this._pos;
    return val;
  }

  protected lineAsInt(): number {
    const val = this._view.getInt32(this._pos, true);
    this._pos += 4;
    this.position = this._pos;
    return val;
  }

  protected lineAsLong(): number {
    // Read as two 32-bit integers (JS doesn't have native 64-bit int)
    const lo = this._view.getUint32(this._pos, true);
    const hi = this._view.getInt32(this._pos + 4, true);
    this._pos += 8;
    this.position = this._pos;
    return hi * 0x100000000 + lo;
  }

  protected lineAsHandle(): number {
    const data = this._data;
    const dataLength = data.length;
    const start = this._pos;
    let end = start;
    while (end < dataLength && data[end] !== 0) {
      end++;
    }

    const length = end - start;
    if (length > 0 && length <= 13) {
      let value = 0;
      let i = start;
      for (; i < end; i++) {
        const c = data[i];
        if (c >= 48 && c <= 57) value = value * 16 + (c - 48);
        else if (c >= 65 && c <= 70) value = value * 16 + (c - 55);
        else if (c >= 97 && c <= 102) value = value * 16 + (c - 87);
        else break;
      }
      if (i === end) {
        this._pos = end < data.length ? end + 1 : end;
        this.position = this._pos;
        return value;
      }
    }

    this.readStringLine();
    const result = parseInt(this.valueRaw, 16);
    const handle = isNaN(result) ? 0 : result;
    // readStringLine deferred the value; the token's value is this number.
    this.value = handle;
    return handle;
  }

  protected lineAsBinaryChunk(): Uint8Array {
    const length = this._data[this._pos++];
		this._chunkStart = this._pos;
    this._pos += length;
		this._chunkEnd = this._pos;
    this.position = this._pos;
		this._deferredIsChunk = true;
		this.deferCurrentValue();
		return undefined as unknown as Uint8Array;
	}

	protected override materializeDeferredValue(): Uint8Array | string {
		if (!this._deferredIsChunk) {
			return this.valueRaw;
		}
		const chunk = this.allocChunk(this._chunkEnd - this._chunkStart);
		chunk.set(this._data.subarray(this._chunkStart, this._chunkEnd));
		return chunk;
  }
}
