import { IDxfStreamReader } from './IDxfStreamReader.js';
import { DxfCode } from '../../../DxfCode.js';
import { DxfFileToken } from '../../../DxfFileToken.js';
import { GroupCodeValue, GroupCodeValueType } from '../../../GroupCodeValue.js';
import { DxfException } from '../../../Exceptions/DxfException.js';
import { MathHelper } from '../../../Math/MathHelper.js';
import { getDecoderEncodingLabel } from '../../TextEncoding.js';

export abstract class DxfStreamReaderBase implements IDxfStreamReader {
  private _encoding: string = getDecoderEncodingLabel('ANSI_1252');

  private _decoder: TextDecoder = new TextDecoder(this._encoding);

  public get encoding(): string {
    return this._encoding;
  }

  public set encoding(value: string) {
    const encoding = getDecoderEncodingLabel(value);
    if (encoding === this._encoding) {
      return;
    }

    this._encoding = encoding;
    this._decoder = new TextDecoder(encoding);
  }

  public dxfCode: DxfCode = DxfCode.Invalid;

  public groupCodeValue: GroupCodeValueType = GroupCodeValueType.None;

  public get code(): number {
    return this.dxfCode as number;
  }

  protected _value: unknown = '';
  private _valueIsDeferred: boolean = false;

  public get value(): unknown {
    if (this._valueIsDeferred) {
      this._value = this.materializeDeferredValue();
      this._valueIsDeferred = false;
    }
    return this._value;
  }

  public set value(value: unknown) {
    this._value = value;
    this._valueIsDeferred = false;
  }

  public position: number = 0;

  protected _valueRaw: string = '';

  public get valueRaw(): string {
    return this._valueRaw;
  }

  public set valueRaw(value: string) {
    this._valueRaw = value;
  }

  private _valueAsStringCache: string | null = null;
  private _valueAsStringSource: unknown = undefined;

  public get valueAsString(): string {
		const currentValue = this._valueIsDeferred ? this.value : this._value;
    // The escape transform below is pure, so memoizing on the raw value is
    // always correct - repeated reads of the same token skip the scan.
    if (this._valueAsStringCache !== null && this._valueAsStringSource === currentValue) {
      return this._valueAsStringCache;
    }

		const value = typeof currentValue === 'string' ? currentValue : String(currentValue);
    let result = value;
    if (value.includes('^')) {
      result = value.replace(/\^([JMI ])/g, (_match, escape: string) => {
        switch (escape) {
          case 'J': return '\n';
          case 'M': return '\r';
          case 'I': return '\t';
          default: return '^';
        }
      });
    }

    this._valueAsStringSource = currentValue;
    this._valueAsStringCache = result;
    return result;
  }

  public get valueAsBool(): boolean {
		return Boolean(this.value);
  }

  public get valueAsShort(): number {
		return Number(this.value) & 0xFFFF;
  }

  public get valueAsUShort(): number {
		return (Number(this.value) & 0xFFFF) >>> 0;
  }

  public get valueAsInt(): number {
		return Number(this.value) | 0;
  }

  public get valueAsLong(): number {
		return Number(this.value);
  }

  public get valueAsDouble(): number {
		return Number(this.value);
  }

  public get valueAsAngle(): number {
		return MathHelper.degToRad(Number(this.value));
  }

  public get valueAsHandle(): number {
		return Number(this.value);
  }

  public get valueAsBinaryChunk(): Uint8Array {
    return this.value as Uint8Array;
  }

  protected abstract get baseStream(): Uint8Array;

  public readNext(): void {
    this._valueIsDeferred = false;
    this.dxfCode = this.readCode();
    this.groupCodeValue = GroupCodeValue.transformValue(this.code);
		const value = this._transformValue(this.groupCodeValue);
		if (!this._valueIsDeferred) {
			this._value = value;
		}

    if (this.dxfCode === DxfCode.Comment) {
      this.readNext();
    }
  }

  public find(dxfEntry: string): boolean {
    this.start();

    let current: string;
    do {
      this.readNext();
      current = this.valueAsString;
    } while (current !== dxfEntry && current !== DxfFileToken.endOfFile);

    return current === dxfEntry;
  }

  public expectedCode(code: number): void {
    this.readNext();

    if (this.code !== code) {
      throw new DxfException(code, this.position);
    }
  }

  public toString(): string {
    return `${this.code} | ${this.value}`;
  }

  public start(): void {
    this.dxfCode = DxfCode.Invalid;
    this.value = '';

    this._streamPosition = 0;

    this.position = 0;
  }

  protected _streamPosition: number = 0;

  protected abstract readCode(): DxfCode;

  protected abstract readStringLine(): string;

  protected abstract lineAsDouble(): number;

  protected abstract lineAsShort(): number;

  protected abstract lineAsInt(): number;

  protected abstract lineAsLong(): number;

  protected abstract lineAsHandle(): number;

  protected abstract lineAsBinaryChunk(): Uint8Array;

  protected abstract lineAsBool(): boolean;

  private static _charScratch: number[] = [];

  // Chunk values are handed out as views into shared arena blocks: thousands
  // of small binary chunks per file otherwise mean one backing-store
  // allocation each. Spans never overlap, so views stay independent.
  private _chunkArena: Uint8Array = new Uint8Array(0);
  private _chunkArenaPos: number = 0;

  protected allocChunk(size: number): Uint8Array {
    if (size > 0x4000) {
      return new Uint8Array(size);
    }
    if (this._chunkArenaPos + size > this._chunkArena.length) {
      this._chunkArena = new Uint8Array(0x10000);
      this._chunkArenaPos = 0;
    }
    const view = this._chunkArena.subarray(this._chunkArenaPos, this._chunkArenaPos + size);
    this._chunkArenaPos += size;
    return view;
  }

  /**
   * Decodes a byte range without allocating a subarray for the common
   * short-ASCII case. Falls back to the TextDecoder for anything else.
   */
  protected decodeStringRange(data: Uint8Array, start: number, end: number): string {
    const length = end - start;
    if (length <= 0) {
      return '';
    }

    if (length <= 256 && this._encoding !== 'utf-16le') {
      let isAscii = true;
      for (let i = start; i < end; i++) {
        if (data[i] >= 0x80) {
          isAscii = false;
          break;
        }
      }
      if (isAscii) {
        const chars = DxfStreamReaderBase._charScratch;
        chars.length = length;
        for (let i = 0; i < length; i++) {
          chars[i] = data[start + i];
        }
        return String.fromCharCode.apply(null, chars as unknown as number[]);
      }
    }

    return this._decoder.decode(data.subarray(start, end));
  }

  protected decodeString(bytes: Uint8Array): string {
    const length = bytes.length;
    if (length === 0) {
      return '';
    }

    if (length <= 256 && this._encoding !== 'utf-16le') {
      let isAscii = true;
      for (let i = 0; i < length; i++) {
        if (bytes[i] >= 0x80) {
          isAscii = false;
          break;
        }
      }
      if (isAscii) {
        return String.fromCharCode.apply(null, bytes as unknown as number[]);
      }
    }

    return this._decoder.decode(bytes);
  }

	protected deferCurrentValue(): void {
		this._value = undefined;
		this._valueIsDeferred = true;
	}

	protected materializeDeferredValue(): unknown {
		return this._value;
	}

  private _transformValue(code: GroupCodeValueType): unknown {
    switch (code) {
      case GroupCodeValueType.String:
      case GroupCodeValueType.Comment:
      case GroupCodeValueType.ExtendedDataString:
        return this.readStringLine();
      case GroupCodeValueType.Point3D:
      case GroupCodeValueType.Double:
      case GroupCodeValueType.ExtendedDataDouble:
        return this.lineAsDouble();
      case GroupCodeValueType.Byte:
      case GroupCodeValueType.Int16:
      case GroupCodeValueType.ExtendedDataInt16:
        return this.lineAsShort();
      case GroupCodeValueType.Int32:
      case GroupCodeValueType.ExtendedDataInt32:
        return this.lineAsInt();
      case GroupCodeValueType.Int64:
        return this.lineAsLong();
      case GroupCodeValueType.Handle:
      case GroupCodeValueType.ObjectId:
      case GroupCodeValueType.ExtendedDataHandle:
        return this.lineAsHandle();
      case GroupCodeValueType.Bool:
        return this.lineAsBool();
      case GroupCodeValueType.Chunk:
      case GroupCodeValueType.ExtendedDataChunk:
        return this.lineAsBinaryChunk();
      case GroupCodeValueType.None:
      default:
        throw new DxfException(code as number, this.position);
    }
  }
}
