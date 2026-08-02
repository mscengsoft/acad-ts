import { DxfStreamReaderBase } from './DxfStreamReaderBase.js';
import { DxfCode } from '../../../DxfCode.js';

const hexDigits = new Int8Array(256).fill(-1);
for (let value = 0; value <= 9; value++) hexDigits[0x30 + value] = value;
for (let value = 0; value < 6; value++) {
  hexDigits[0x41 + value] = value + 10;
  hexDigits[0x61 + value] = value + 10;
}

export class DxfTextReader extends DxfStreamReaderBase {
  protected get baseStream(): Uint8Array {
    return this._data;
  }

  private _data: Uint8Array;
  private _bytePos: number = 0;
  private _rawStart: number = 0;
  private _rawEnd: number = 0;
  private _rawDecoded: string | null = '';

  public override get valueRaw(): string {
    if (this._rawDecoded === null) {
      const data = this._data;
      let start = this._rawStart;
      let end = this._rawEnd;
      // ASCII whitespace trim on byte bounds: one string allocation instead
      // of subarray + decode + trim. Non-ASCII content keeps the original
      // decode-then-trim semantics (e.g. Unicode spaces).
      while (start < end) {
        const b = data[start];
        if (b === 0x20 || (b >= 0x09 && b <= 0x0D)) start++;
        else break;
      }
      while (end > start) {
        const b = data[end - 1];
        if (b === 0x20 || (b >= 0x09 && b <= 0x0D)) end--;
        else break;
      }
      let hasHighByte = false;
      for (let i = start; i < end; i++) {
        if (data[i] >= 0x80) {
          hasHighByte = true;
          break;
        }
      }
      this._rawDecoded = hasHighByte
        ? this.decodeString(data.subarray(this._rawStart, this._rawEnd)).trim()
        : this.decodeStringRange(data, start, end);
    }
    return this._rawDecoded;
  }

  public override set valueRaw(value: string) {
    this._rawDecoded = value;
  }

  public constructor(stream: Uint8Array) {
    super();
    this._data = stream;
    this.start();
  }

  public override start(): void {
    super.start();

    this._bytePos = 0;
  }

  public override readNext(): void {
    super.readNext();
    this.position += 2;
  }

  private _deferredIsChunk: boolean = false;

  protected readStringLine(): string {
    this._readLineBounds();
    // Decoding is deferred: tokens whose value is never read skip the
    // subarray + decode + trim entirely.
    this._deferredIsChunk = false;
    this.deferCurrentValue();
    return undefined as unknown as string;
  }

  protected readCode(): DxfCode {
    const value = this._readIntegerLine(10);
    if (!Number.isNaN(value)) {
      return value as DxfCode;
    }

    this.position++;

    return DxfCode.Invalid;
  }

  protected lineAsBool(): boolean {
    const result = this._readIntegerLine(10);
    if (!Number.isNaN(result)) {
      return result > 0;
    }
    return false;
  }

  private static readonly _pow10: number[] = [
    1, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10,
    1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
  ];

  protected lineAsDouble(): number {
    this._readLineBounds();
    const data = this._data;
    const end = this._rawEnd;
    let i = this._rawStart;

    while (i < end) {
      const b = data[i];
      if (b === 0x20 || (b >= 0x09 && b <= 0x0D)) {
        i++;
      } else {
        break;
      }
    }

    let sign = 1;
    if (i < end) {
      if (data[i] === 0x2D) {
        sign = -1;
        i++;
      } else if (data[i] === 0x2B) {
        i++;
      }
    }

    let mantissa = 0;
    let digits = 0;
    let exp = 0;
    let seenDigit = false;
    let tooLong = false;

    while (i < end) {
      const b = data[i];
      if (b < 0x30 || b > 0x39) {
        break;
      }
      if (digits < 15) {
        mantissa = mantissa * 10 + (b - 0x30);
        if (mantissa !== 0) {
          digits++;
        }
      } else {
        tooLong = true;
      }
      seenDigit = true;
      i++;
    }

    if (i < end && data[i] === 0x2E) {
      i++;
      while (i < end) {
        const b = data[i];
        if (b < 0x30 || b > 0x39) {
          break;
        }
        if (digits < 15) {
          mantissa = mantissa * 10 + (b - 0x30);
          exp--;
          if (mantissa !== 0) {
            digits++;
          }
        } else {
          tooLong = true;
        }
        seenDigit = true;
        i++;
      }
    }

    if (seenDigit && !tooLong) {
      let expValue = 0;
      if (i < end && (data[i] === 0x65 || data[i] === 0x45)) {
        let j = i + 1;
        let expSign = 1;
        if (j < end) {
          if (data[j] === 0x2D) {
            expSign = -1;
            j++;
          } else if (data[j] === 0x2B) {
            j++;
          }
        }
        let expDigits = 0;
        let parsed = 0;
        while (j < end) {
          const b = data[j];
          if (b < 0x30 || b > 0x39) {
            break;
          }
          if (parsed < 10000) {
            parsed = parsed * 10 + (b - 0x30);
          }
          expDigits++;
          j++;
        }
        if (expDigits > 0) {
          expValue = expSign * parsed;
        }
      }

      if (mantissa === 0) {
        return sign < 0 ? -0 : 0;
      }

      const totalExp = exp + expValue;
      if (totalExp === 0) {
        return sign * mantissa;
      }
      if (totalExp > 0 && totalExp <= 22) {
        return sign * (mantissa * DxfTextReader._pow10[totalExp]);
      }
      if (totalExp < 0 && totalExp >= -22) {
        return sign * (mantissa / DxfTextReader._pow10[-totalExp]);
      }
    }

    const str = this.valueRaw;
    const result = parseFloat(str);
    if (!isNaN(result)) {
      return result;
    }
    return 0.0;
  }

  protected lineAsShort(): number {
    const result = this._readIntegerLine(10);
    if (!Number.isNaN(result)) {
      return result;
    }
    return 0;
  }

  protected lineAsInt(): number {
    const result = this._readIntegerLine(10);
    if (!Number.isNaN(result)) {
      return result;
    }
    return 0;
  }

  protected lineAsLong(): number {
    const result = this._readIntegerLine(10);
    if (!Number.isNaN(result)) {
      return result;
    }
    return 0;
  }

  protected lineAsHandle(): number {
    const result = this._readIntegerLine(16);
    if (!Number.isNaN(result)) {
      return result;
    }
    return 0;
  }

  protected lineAsBinaryChunk(): Uint8Array {
    this._readLineBounds();
    this._deferredIsChunk = true;
		this.deferCurrentValue();
		return undefined as unknown as Uint8Array;
	}

	protected override materializeDeferredValue(): Uint8Array | string {
		if (!this._deferredIsChunk) {
			return this.valueRaw;
		}
		return this._materializeChunk();
	}

	private _materializeChunk(): Uint8Array {
    const data = this._data;
    let start = this._rawStart;
    let end = this._rawEnd;
    while (start < end && data[start] <= 0x20) start++;
    while (end > start && data[end - 1] <= 0x20) end--;

    const bytes = this.allocChunk(Math.ceil((end - start) / 2));
    let outputIndex = 0;
    const last = end - 1;
    let index = start;
    for (; index < last; index += 2) {
      const high = hexDigits[data[index]];
      const low = hexDigits[data[index + 1]];
      if ((high | low) >= 0) {
        bytes[outputIndex++] = (high << 4) | low;
        continue;
      }

      if (high < 0) return this._materializeChunkLegacy();

      bytes[outputIndex++] = high;
    }

    if (index === last) {
      const high = hexDigits[data[index]];
      if (high < 0) return this._materializeChunkLegacy();
      bytes[outputIndex++] = high;
    }

    return bytes;
  }

  // Fallback for chunk lines the byte fast path cannot handle (e.g. interior
  // whitespace). Reproduces the historical parseInt-per-pair semantics exactly,
  // including its treatment of half-invalid pairs.
  private _materializeChunkLegacy(): Uint8Array {
    const str = this.valueRaw;
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i += 2) {
      const value = parseInt(str.substring(i, i + 2), 16);
      if (isNaN(value)) return new Uint8Array(0);
      bytes.push(value);
    }
    return new Uint8Array(bytes);
  }

  private _readLineBounds(): void {
    const start = this._bytePos;
    const data = this._data;
    const dataLength = data.length;
    // Hybrid scan: for typical short lines an inline byte loop beats the
    // fixed cost of the native TypedArray indexOf; long lines (hex chunk
    // data) fall back to the SIMD-backed native scan.
    let end = start;
    const probeEnd = Math.min(start + 32, dataLength);
    while (end < probeEnd && data[end] !== 0x0A) {
      end++;
    }
    if (end === probeEnd && (end >= dataLength || data[end] !== 0x0A)) {
      end = data.indexOf(0x0A, probeEnd);
      if (end === -1) {
        end = dataLength;
      }
    }

    this._bytePos = end < dataLength ? end + 1 : end;
    if (end > start && data[end - 1] === 0x0D) {
      end--;
    }

    this._rawStart = start;
    this._rawEnd = end;
    this._rawDecoded = null;
  }

  private _readIntegerLine(radix: 10 | 16): number {
    this._readLineBounds();

    const data = this._data;
    const rawEnd = this._rawEnd;
    let index = this._rawStart;
    while (index < rawEnd && data[index] <= 0x20) {
      index++;
    }

    let sign = 1;
    if (data[index] === 0x2D) {
      sign = -1;
      index++;
    } else if (data[index] === 0x2B) {
      index++;
    }

    if (radix === 16 && index + 1 < rawEnd && data[index] === 0x30 &&
      (data[index + 1] === 0x78 || data[index + 1] === 0x58)) {
      index += 2;
    }

    // Exact accumulation is only guaranteed below 2^53: 15 decimal or
    // 13 hex significant digits. Longer values defer to parseInt so the
    // rounding stays identical to the pre-optimization string path.
    const maxSignificant = radix === 10 ? 15 : 13;
    let value = 0;
    let digits = 0;
    let significant = 0;
    while (index < rawEnd) {
      const byte = data[index++];
      let digit: number;
      if (byte >= 0x30 && byte <= 0x39) {
        digit = byte - 0x30;
      } else if (radix === 16 && byte >= 0x41 && byte <= 0x46) {
        digit = byte - 0x37;
      } else if (radix === 16 && byte >= 0x61 && byte <= 0x66) {
        digit = byte - 0x57;
      } else {
        break;
      }

      value = value * radix + digit;
      digits++;
      if (value !== 0) {
        significant++;
        if (significant > maxSignificant) {
          return parseInt(this.valueRaw, radix);
        }
      }
    }

    return digits === 0 ? Number.NaN : value * sign;
  }

}
