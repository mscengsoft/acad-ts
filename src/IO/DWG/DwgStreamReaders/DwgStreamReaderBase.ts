import { XY, XYZ } from '../../../Math/index.js';
import { Color } from '../../../Color.js';
import { Transparency } from '../../../Transparency.js';
import { ObjectType } from '../../../Types/ObjectType.js';
import { ACadVersion } from '../../../ACadVersion.js';
import { CadNotSupportedException } from '../../../Exceptions/CadNotSupportedException.js';
import { DwgException } from '../../../Exceptions/DwgException.js';
import { DwgReferenceType } from '../../../Types/DwgReferenceType.js';
import { IDwgStreamReader } from './IDwgStreamReader.js';

// Factory registration for breaking circular dependency
type StreamReaderFactory = new (stream: Uint8Array, resetPosition: boolean) => IDwgStreamReader;
const _readerFactories: Map<string, StreamReaderFactory> = new Map();
const _textDecoders: Map<string, TextDecoder> = new Map();

// Reused char-code scratch for the manual short-string decode fast paths.
const _charScratch: number[] = [];

// Reused byte scratch for gathering bit-shifted short strings.
const _strScratch: Uint8Array = new Uint8Array(512);

export function registerStreamReader(key: string, factory: StreamReaderFactory): void {
	_readerFactories.set(key, factory);
}

export abstract class DwgStreamReaderBase implements IDwgStreamReader {
	public bitShift: number = 0;

	get position(): number {
		return this._position;
	}
	set position(value: number) {
		this._position = value;
		this.bitShift = 0;
	}

	public isEmpty: boolean = false;
	public encoding: string = 'utf-8';

	get stream(): Uint8Array {
		return this._stream;
	}

	protected _stream: Uint8Array;
	protected _view: DataView;
	protected _position: number;
	protected _lastByte: number = 0;
	private readonly _doubleBytes: Uint8Array = new Uint8Array(8);
	private readonly _doubleView: DataView = new DataView(this._doubleBytes.buffer);

	constructor(stream: Uint8Array, resetPosition: boolean) {
		this._stream = stream;
		this._view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
		this._position = resetPosition ? 0 : 0;
	}

	public static getStreamHandler(version: ACadVersion, stream: Uint8Array, encoding?: string, resetPosition: boolean = false): IDwgStreamReader {
		let reader: IDwgStreamReader;

		let key: string;
		switch (version) {
			case ACadVersion.Unknown:
			case ACadVersion.MC0_0:
			case ACadVersion.AC1_2:
			case ACadVersion.AC1_4:
			case ACadVersion.AC1_50:
			case ACadVersion.AC2_10:
			case ACadVersion.AC1002:
			case ACadVersion.AC1003:
			case ACadVersion.AC1004:
			case ACadVersion.AC1006:
			case ACadVersion.AC1009:
				throw new CadNotSupportedException(version);
			case ACadVersion.AC1012:
			case ACadVersion.AC1014:
				key = 'AC12';
				break;
			case ACadVersion.AC1015:
				key = 'AC15';
				break;
			case ACadVersion.AC1018:
				key = 'AC18';
				break;
			case ACadVersion.AC1021:
				key = 'AC21';
				break;
			case ACadVersion.AC1024:
			case ACadVersion.AC1027:
			case ACadVersion.AC1032:
				key = 'AC24';
				break;
			default:
				throw new CadNotSupportedException();
		}

		const Factory = _readerFactories.get(key);
		if (!Factory) {
			throw new Error(`DwgStreamReader factory for ${key} not registered. Import DwgStreamReaderFactory first.`);
		}
		reader = new Factory(stream, resetPosition);

		if (encoding !== undefined) {
			reader.encoding = encoding;
		}

		return reader;
	}

	// --- Base stream read methods ---

	public readByte(): number {
		if (this.bitShift === 0) {
			this._lastByte = this._stream[this._position++];
			return this._lastByte;
		}

		const lastValues = (this._lastByte << this.bitShift) & 0xFF;
		this._lastByte = this._stream[this._position++];
		return (lastValues | (this._lastByte >>> (8 - this.bitShift))) & 0xFF;
	}

	public readBytes(length: number): Uint8Array {
		if (this.bitShift === 0 && length >= 0 && this._position + length <= this._stream.length) {
			const start = this._position;
			this._position += length;
			return this._stream.slice(start, this._position);
		}
		const numArray = new Uint8Array(length);
		this._applyShiftToArr(length, numArray);
		return numArray;
	}

	/** Reads `length` bytes into the caller-provided buffer (no allocation). */
	public readBytesInto(target: Uint8Array, length: number): void {
		this._applyShiftToArr(length, target);
	}

	/**
	 * Re-points this reader at another buffer and resets the cursor, so a
	 * pooled instance can service many small aligned regions without
	 * re-allocating the reader. The DataView is only rebuilt when the
	 * underlying buffer actually changes.
	 */
	public rebind(stream: Uint8Array): void {
		if (stream !== this._stream) {
			this._stream = stream;
			this._view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
		}
		this._position = 0;
		this.bitShift = 0;
		this._lastByte = 0;
		this.isEmpty = false;
	}

	public readBytesView(length: number): Uint8Array {
		if (this.bitShift === 0 && length >= 0 && this._position + length <= this._stream.length) {
			const start = this._position;
			this._position += length;
			return this._stream.subarray(start, this._position);
		}
		return this.readBytes(length);
	}

	public setPositionByFlag(position: number): number {
		this.setPositionInBits(position);

		const flag: boolean = this.readBit();

		let startPosition: number = position;
		if (flag) {
			const result = this.applyFlagToPosition(position);
			startPosition = result.length - result.strDataSize;
			this.setPositionInBits(startPosition);
		} else {
			this.isEmpty = true;
			this.position = this._stream.length;
		}

		return startPosition;
	}

	// --- BIT CODES AND DATA DEFINITIONS ---

	public readBit(): boolean {
		if (this.bitShift === 0) {
			this.advanceByte();
			const result = (this._lastByte & 128) === 128;
			this.bitShift = 1;
			return result;
		}

		const value = ((this._lastByte << this.bitShift) & 128) === 128;
		++this.bitShift;
		this.bitShift &= 7;
		return value;
	}

	public readBitAsShort(): number {
		return this.readBit() ? 1 : 0;
	}

	public read2Bits(): number {
		let value: number;
		if (this.bitShift === 0) {
			this.advanceByte();
			value = this._lastByte >>> 6;
			this.bitShift = 2;
		} else if (this.bitShift === 7) {
			const lastValue = (this._lastByte << 1) & 2;
			this.advanceByte();
			value = lastValue | (this._lastByte >>> 7);
			this.bitShift = 1;
		} else {
			value = (this._lastByte >>> (6 - this.bitShift)) & 3;
			++this.bitShift;
			++this.bitShift;
			this.bitShift &= 7;
		}
		return value;
	}

	public readBitShort(): number {
		let value: number;
		switch (this.read2Bits()) {
			case 0:
				value = this.readShortLittleEndian();
				break;
			case 1:
				if (this.bitShift === 0) {
					this.advanceByte();
					value = this._lastByte;
					break;
				}
				value = this.applyShiftToLastByte();
				break;
			case 2:
				value = 0;
				break;
			case 3:
				value = 256;
				break;
			default:
				throw this.throwException('ReadBitShort');
		}
		// Sign-extend to short
		if (value > 32767) value -= 65536;
		return value;
	}

	public readBitShortAsBool(): boolean {
		return this.readBitShort() !== 0;
	}

	public readBitLong(): number {
		let value: number;
		switch (this.read2Bits()) {
			case 0:
				value = this.readIntLittleEndian();
				break;
			case 1:
				if (this.bitShift === 0) {
					this.advanceByte();
					value = this._lastByte;
					break;
				}
				value = this.applyShiftToLastByte();
				break;
			case 2:
				value = 0;
				break;
			default:
				throw new Error('Failed to read ReadBitLong');
		}
		return value;
	}

	public readBitLongLong(): number {
		let value = 0;
		const size = this._read3bits();

		for (let i = 0; i < size; ++i) {
			const b = this.readByte();
			value += b << (i << 3);
		}

		return value;
	}

	public readBitDouble(): number {
		let value: number;
		switch (this.read2Bits()) {
			case 0:
				value = this.readDoubleLittleEndian();
				break;
			case 1:
				value = 1.0;
				break;
			case 2:
				value = 0.0;
				break;
			default:
				throw this.throwException('ReadBitDouble');
		}
		return value;
	}

	public read2BitDouble(): XY {
		return new XY(this.readBitDouble(), this.readBitDouble());
	}

	public read3BitDouble(): XYZ {
		return new XYZ(this.readBitDouble(), this.readBitDouble(), this.readBitDouble());
	}

	public readRawChar(): number {
		return this.readByte();
	}

	public readRawLong(): number {
		return this.readIntLittleEndian();
	}

	public readRawULong(): number {
		return this.readULongLittleEndian();
	}

	public read2RawDouble(): XY {
		return new XY(this.readDouble(), this.readDouble());
	}

	public read3RawDouble(): XYZ {
		return new XYZ(this.readDouble(), this.readDouble(), this.readDouble());
	}

	public readModularChar(): number {
		let shift = 0;
		let lastByte = this.readByte();

		let value = lastByte & 0b01111111;

		if ((lastByte & 0b10000000) !== 0) {
			while (true) {
				shift += 7;
				const last = this.readByte();
				value |= (last & 0b01111111) << shift;

				if ((last & 0b10000000) === 0) {
					break;
				}
			}
		}

		return value;
	}

	public readSignedModularChar(): number {
		let value: number;

		if (this.bitShift === 0) {
			this.advanceByte();

			if ((this._lastByte & 0b10000000) === 0) {
				value = this._lastByte & 0b00111111;
				if ((this._lastByte & 0b01000000) > 0) {
					value = -value;
				}
			} else {
				let totalShift = 0;
				let sum = this._lastByte & 0x7F;
				while (true) {
					totalShift += 7;
					this.advanceByte();

					if ((this._lastByte & 0b10000000) !== 0) {
						sum |= (this._lastByte & 0x7F) << totalShift;
					} else {
						break;
					}
				}

				value = sum | ((this._lastByte & 0b00111111) << totalShift);
				if ((this._lastByte & 0b01000000) > 0) {
					value = -value;
				}
			}
		} else {
			let lastByte = this.applyShiftToLastByte();
			if ((lastByte & 0b10000000) === 0) {
				value = lastByte & 0b00111111;
				if ((lastByte & 0b01000000) > 0) {
					value = -value;
				}
			} else {
				let totalShift = 0;
				let sum = lastByte & 0x7F;
				let currByte: number;
				while (true) {
					totalShift += 7;
					currByte = this.applyShiftToLastByte();

					if ((currByte & 0b10000000) !== 0) {
						sum |= (currByte & 0x7F) << totalShift;
					} else {
						break;
					}
				}

				value = sum | ((currByte! & 0b00111111) << totalShift);
				if ((currByte! & 0b01000000) > 0) {
					value = -value;
				}
			}
		}
		return value;
	}

	public readModularShort(): number {
		let shift = 0b1111;

		let b1 = this.readByte();
		let b2 = this.readByte();

		let flag = (b2 & 0b10000000) === 0;

		let value = b1 | ((b2 & 0b1111111) << 8);

		while (!flag) {
			b1 = this.readByte();
			b2 = this.readByte();

			flag = (b2 & 0b10000000) === 0;

			value |= b1 << shift;
			shift += 8;
			value |= (b2 & 0b1111111) << shift;

			shift += 7;
		}

		return value;
	}

	// --- Handle reference ---

	public handleReference(): number {
		return this._readHandleReference(this.readByte(), 0);
	}

	public handleReferenceWithRef(referenceHandle: number): number {
		return this._readHandleReference(this.readByte(), referenceHandle);
	}

	public handleReferenceWithRefAndType(referenceHandle: number): { handle: number; reference: DwgReferenceType } {
		const form = this.readByte();
		return {
			handle: this._readHandleReference(form, referenceHandle),
			reference: ((form >>> 4) & 0b0011) as DwgReferenceType,
		};
	}

	private _readHandleReference(form: number, referenceHandle: number): number {
		const code = form >>> 4;
		const counter = form & 0b00001111;

		let initialPos: number;

		if (code <= 0x5) {
			initialPos = this._readHandle(counter);
		} else if (code === 0x6) {
			initialPos = referenceHandle + 1;
		} else if (code === 0x8) {
			initialPos = referenceHandle - 1;
		} else if (code === 0xA) {
			const offset = this._readHandle(counter);
			initialPos = referenceHandle + offset;
		} else if (code === 0xC) {
			const offset = this._readHandle(counter);
			initialPos = referenceHandle - offset;
		} else {
			throw new DwgException(`[HandleReference] invalid reference code with value: ${code}`);
		}

		return initialPos;
	}

	private _readHandle(length: number): number {
		let value = 0;
		for (let index = 0; index < length; index++) {
			value = value * 256 + this.readByte();
		}
		return value;
	}

	// --- Text ---

	public readTextUnicode(): string {
		const textLength = this.readShort();
		const encodingKey = this.readByte();
		let value: string;

		if (textLength === 0) {
			value = '';
		} else {
			value = this.readStringEncoded(textLength, this._getEncodingFromCodePage(encodingKey));
		}

		return value;
	}

	public readVariableText(): string {
		const length = this.readBitShort();
		let str: string;
		if (length > 0) {
			str = this.readStringEncoded(length, this.encoding).replace(/\0/g, '');
		} else {
			str = '';
		}
		return str;
	}

	public readSentinel(): Uint8Array {
		return this.readBytes(16);
	}

	public read2BitDoubleWithDefault(defValues: XY): XY {
		return new XY(this.readBitDoubleWithDefault(defValues.x), this.readBitDoubleWithDefault(defValues.y),);
	}

	public read3BitDoubleWithDefault(defValues: XYZ): XYZ {
		return new XYZ(this.readBitDoubleWithDefault(defValues.x), this.readBitDoubleWithDefault(defValues.y), this.readBitDoubleWithDefault(defValues.z),);
	}

	public readCmColor(_useTextStream: boolean = false): Color {
		const colorIndex = this.readBitShort();
		return new Color(colorIndex);
	}

	public readEnColor(): { color: Color; transparency: Transparency; flag: boolean } {
		const colorNumber = this.readBitShort();
		return {
			color: new Color(colorNumber),
			transparency: Transparency.byLayer,
			flag: false,
		};
	}

	public readColorByIndex(): Color {
		return new Color(this.readBitShort());
	}

	public readObjectType(): ObjectType {
		return this.readBitShort() as ObjectType;
	}

	public readBitExtrusion(): XYZ {
		return this.read3BitDouble();
	}

	public readBitDoubleWithDefault(def: number): number {
		const arr = this._doubleBytes;
		const view = this._doubleView;

		switch (this.read2Bits()) {
			case 0:
				return def;
			case 1:
				// The default's bytes are only needed when patching parts of it.
				view.setFloat64(0, def, true);
				if (this.bitShift === 0) {
					this.advanceByte(); arr[0] = this._lastByte;
					this.advanceByte(); arr[1] = this._lastByte;
					this.advanceByte(); arr[2] = this._lastByte;
					this.advanceByte(); arr[3] = this._lastByte;
				} else {
					const shift = 8 - this.bitShift;
					arr[0] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[0] = (arr[0] | (this._lastByte >>> shift)) & 0xFF;
					arr[1] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[1] = (arr[1] | (this._lastByte >>> shift)) & 0xFF;
					arr[2] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[2] = (arr[2] | (this._lastByte >>> shift)) & 0xFF;
					arr[3] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[3] = (arr[3] | (this._lastByte >>> shift)) & 0xFF;
				}
				return view.getFloat64(0, true);
			case 2:
				view.setFloat64(0, def, true);
				if (this.bitShift === 0) {
					this.advanceByte(); arr[4] = this._lastByte;
					this.advanceByte(); arr[5] = this._lastByte;
					this.advanceByte(); arr[0] = this._lastByte;
					this.advanceByte(); arr[1] = this._lastByte;
					this.advanceByte(); arr[2] = this._lastByte;
					this.advanceByte(); arr[3] = this._lastByte;
				} else {
					const shift = 8 - this.bitShift;
					arr[4] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[4] = (arr[4] | (this._lastByte >>> shift)) & 0xFF;
					arr[5] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[5] = (arr[5] | (this._lastByte >>> shift)) & 0xFF;
					arr[0] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[0] = (arr[0] | (this._lastByte >>> shift)) & 0xFF;
					arr[1] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[1] = (arr[1] | (this._lastByte >>> shift)) & 0xFF;
					arr[2] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[2] = (arr[2] | (this._lastByte >>> shift)) & 0xFF;
					arr[3] = (this._lastByte << this.bitShift) & 0xFF;
					this.advanceByte();
					arr[3] = (arr[3] | (this._lastByte >>> shift)) & 0xFF;
				}
				return view.getFloat64(0, true);
			case 3:
				return this.readDouble();
			default:
				throw this.throwException('ReadBitDoubleWithDefault');
		}
	}

	public readBitThickness(): number {
		return this.readBitDouble();
	}

	// --- Date/Time ---

	public read8BitJulianDate(): Date {
		return this._julianToDate(this.readInt(), this.readInt());
	}

	public readDateTime(): Date {
		return this._julianToDate(this.readBitLong(), this.readBitLong());
	}

	public readTimeSpan(): number {
		const hours = this.readBitLong();
		const milliseconds = this.readBitLong();
		return hours * 3600000 + milliseconds;
	}

	// --- Stream pointer control ---

	public positionInBits(): number {
		let bitPosition = this._position * 8;

		if (this.bitShift > 0) {
			bitPosition += this.bitShift - 8;
		}

		return bitPosition;
	}

	public setPositionInBits(position: number): void {
		this.position = position >> 3;
		this.bitShift = position & 7;

		if (this.bitShift <= 0) {
			return;
		}

		this.advanceByte();
	}

	public advanceByte(): void {
		this._lastByte = this._stream[this._position++];
	}

	public advance(offset: number): void {
		if (offset > 1) {
			this._position += offset - 1;
		}
		this.readByte();
	}

	public resetShift(): number {
		if (this.bitShift > 0) {
			this.bitShift = 0;
		}

		this.advanceByte();
		let num = this._lastByte;
		this.advanceByte();

		return (num | (this._lastByte << 8)) & 0xFFFF;
	}

	// --- Low-level read helpers ---

	public readShort(): number {
		// The bounds/sign guards keep out-of-range reads on the byte-loop path,
		// which preserves the tolerant EOF-garbage semantics instead of letting
		// the DataView throw a RangeError that can escape failsafe handling.
		if (this.bitShift === 0 && this._position >= 0 && this._position + 2 <= this._stream.length) {
			const value = this._view.getInt16(this._position, true);
			this._lastByte = this._stream[this._position + 1];
			this._position += 2;
			return value;
		}
		const b0 = this.readByte();
		const b1 = this.readByte();
		let value = b0 | (b1 << 8);
		if (value > 32767) value -= 65536;
		return value;
	}

	public readShortLittleEndian(): number {
		return this.readShort();
	}

	public readShortBigEndian(): number {
		const b0 = this.readByte();
		const b1 = this.readByte();
		let value = (b0 << 8) | b1;
		if (value > 32767) value -= 65536;
		return value;
	}

	public readInt(): number {
		if (this.bitShift === 0 && this._position >= 0 && this._position + 4 <= this._stream.length) {
			const value = this._view.getInt32(this._position, true);
			this._lastByte = this._stream[this._position + 3];
			this._position += 4;
			return value;
		}
		const b0 = this.readByte();
		const b1 = this.readByte();
		const b2 = this.readByte();
		const b3 = this.readByte();
		return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
	}

	public readIntLittleEndian(): number {
		return this.readInt();
	}

	public readUInt(): number {
		return this.readInt() >>> 0;
	}

	public readDouble(): number {
		if (this.bitShift === 0 && this._position >= 0 && this._position + 8 <= this._stream.length) {
			const value = this._view.getFloat64(this._position, true);
			this._position += 8;
			return value;
		}
		for (let index = 0; index < 8; index++) {
			this._doubleBytes[index] = this.readByte();
		}
		return this._doubleView.getFloat64(0, true);
	}

	public readDoubleLittleEndian(): number {
		return this.readDouble();
	}

	public readUShort(): number {
		if (this.bitShift === 0 && this._position >= 0 && this._position + 2 <= this._stream.length) {
			const value = this._view.getUint16(this._position, true);
			this._lastByte = this._stream[this._position + 1];
			this._position += 2;
			return value;
		}
		const b0 = this.readByte();
		const b1 = this.readByte();
		return (b0 | (b1 << 8)) & 0xFFFF;
	}

	public readULongLittleEndian(): number {
		if (this.bitShift === 0 && this._position >= 0 && this._position + 8 <= this._stream.length) {
			const low = this._view.getUint32(this._position, true);
			const high = this._view.getUint32(this._position + 4, true);
			this._lastByte = this._stream[this._position + 7];
			this._position += 8;
			return low + high * 0x100000000;
		}
		const b0 = this.readByte();
		const b1 = this.readByte();
		const b2 = this.readByte();
		const b3 = this.readByte();
		const b4 = this.readByte();
		const b5 = this.readByte();
		const b6 = this.readByte();
		const b7 = this.readByte();
		const lo = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
		const hi = (b4 | (b5 << 8) | (b6 << 16) | (b7 << 24)) >>> 0;
		return lo + hi * 0x100000000;
	}

	public readStringEncoded(length: number, encoding: string): string {
		// Manual decode for short strings: TextDecoder has a high fixed cost
		// per call. Bit-shifted reads are gathered into a reusable scratch
		// first (R2007 text streams usually sit at bit offsets). Surrogates
		// and non-ASCII content fall through to the TextDecoder.
		if (length >= 0 && length <= 512) {
			let data: Uint8Array;
			let start: number;
			if (this.bitShift === 0 && this._position + length <= this._stream.length) {
				data = this._stream;
				start = this._position;
				this._position += length;
			} else {
				this._applyShiftToArr(length, _strScratch);
				data = _strScratch;
				start = 0;
			}
			const end = start + length;

			if (encoding === 'utf-16le') {
				if ((length & 1) === 0) {
					const count = length >>> 1;
					const chars = _charScratch;
					chars.length = count;
					let fast = true;
					for (let i = 0, position = start; i < count; i++, position += 2) {
						const code = data[position] | (data[position + 1] << 8);
						if (code >= 0xD800 && code <= 0xDFFF) {
							fast = false;
							break;
						}
						chars[i] = code;
					}
					if (fast) {
						return String.fromCharCode.apply(null, chars as unknown as number[]);
					}
				}
			} else {
				let ascii = true;
				for (let i = start; i < end; i++) {
					if (data[i] >= 0x80) {
						ascii = false;
						break;
					}
				}
				if (ascii) {
					const chars = _charScratch;
					chars.length = length;
					for (let i = 0, position = start; i < length; i++, position++) {
						chars[i] = data[position];
					}
					return String.fromCharCode.apply(null, chars as unknown as number[]);
				}
			}

			return this._getDecoder(encoding).decode(data.subarray(start, end));
		}

		const decoder = this._getDecoder(encoding);
		if (this.bitShift === 0 && length >= 0 && this._position + length <= this._stream.length) {
			const start = this._position;
			this._position += length;
			return decoder.decode(this._stream.subarray(start, this._position));
		}
		return decoder.decode(this.readBytes(length));
	}

	private _getDecoder(encoding: string): TextDecoder {
		let decoder = _textDecoders.get(encoding);
		if (!decoder) {
			decoder = new TextDecoder(encoding);
			_textDecoders.set(encoding, decoder);
		}
		return decoder;
	}

	// --- Protected helpers ---

	protected applyFlagToPosition(lastPos: number): { length: number; strDataSize: number } {
		let length = lastPos - 16;
		this.setPositionInBits(length);

		let strDataSize = this.readUShort();

		if ((strDataSize & 0x8000) > 0) {
			length -= 16;
			this.setPositionInBits(length);

			strDataSize &= 0x7FFF;

			const hiSize = this.readUShort();
			strDataSize += (hiSize & 0xFFFF) << 15;
		}

		return { length, strDataSize };
	}

	protected applyShiftToLastByte(): number {
		let value = (this._lastByte << this.bitShift) & 0xFF;
		this.advanceByte();
		return (value | (this._lastByte >>> (8 - this.bitShift))) & 0xFF;
	}

	protected throwException(callerName?: string): DwgException {
		return new DwgException(`Failed to read ${callerName || 'unknown'}`);
	}

	private _applyShiftToArr(length: number, arr: Uint8Array): void {
		if (this.bitShift <= 0) {
			arr.set(this._stream.subarray(this._position, this._position + length));
			this._position += length;
			return;
		}

		const stream = this._stream;
		const bitShift = this.bitShift;
		const shift = 8 - this.bitShift;
		let position = this._position;
		let lastByte = this._lastByte;
		let index = 0;
		const n4 = length & ~3;
		if (n4 >= 32 && position + n4 <= stream.length) {
			// Word-at-a-time: one 32-bit load and one store per 4 bytes.
			// (bX << bitShift | bY >>> shift) & 0xFF == ((bX << 8 | bY) >>> shift) & 0xFF
			const sview = this._view;
			const aview = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
			while (index < n4) {
				const w = sview.getUint32(position, false);
				const a0 = (((lastByte << 8) | (w >>> 24)) >>> shift) & 0xFF;
				const a1 = ((w >>> 16) >>> shift) & 0xFF;
				const a2 = ((w >>> 8) >>> shift) & 0xFF;
				const a3 = (w >>> shift) & 0xFF;
				aview.setUint32(index, a0 | (a1 << 8) | (a2 << 16) | (a3 << 24), true);
				lastByte = w & 0xFF;
				position += 4;
				index += 4;
			}
		}
		while (index < n4) {
			const b0 = stream[position];
			const b1 = stream[position + 1];
			const b2 = stream[position + 2];
			const b3 = stream[position + 3];
			arr[index] = ((lastByte << bitShift) | (b0 >>> shift)) & 0xFF;
			arr[index + 1] = ((b0 << bitShift) | (b1 >>> shift)) & 0xFF;
			arr[index + 2] = ((b1 << bitShift) | (b2 >>> shift)) & 0xFF;
			arr[index + 3] = ((b2 << bitShift) | (b3 >>> shift)) & 0xFF;
			lastByte = b3;
			position += 4;
			index += 4;
		}
		for (; index < length; index++) {
			const currentByte = stream[position++];
			arr[index] = ((lastByte << bitShift) | (currentByte >>> shift)) & 0xFF;
			lastByte = currentByte;
		}
		this._position = position;
		this._lastByte = lastByte;
	}

	private _read3bits(): number {
		let b1 = 0;
		if (this.readBit()) b1 = 1;
		let b2 = (b1 << 1) & 0xFF;
		if (this.readBit()) b2 |= 1;
		let b3 = (b2 << 1) & 0xFF;
		if (this.readBit()) b3 |= 1;
		return b3;
	}

	private _julianToDate(jdate: number, milliseconds: number): Date {
		const unixTime = (jdate - 2440587.5) * 86400;

		try {
			const dt = new Date(unixTime * 1000 + milliseconds);
			return dt;
		} catch {
			return new Date(0);
		}
	}

	private _getEncodingFromCodePage(codePage: number): string {
		// Map common Windows code pages to TextDecoder encoding labels
		switch (codePage) {
			case 0: return 'utf-8';
			case 1: return 'ascii';
			case 28591: return 'iso-8859-1';
			case 1252: return 'windows-1252';
			case 1250: return 'windows-1250';
			case 1251: return 'windows-1251';
			case 1253: return 'windows-1253';
			case 1254: return 'windows-1254';
			case 1255: return 'windows-1255';
			case 1256: return 'windows-1256';
			case 1257: return 'windows-1257';
			case 1258: return 'windows-1258';
			case 932: return 'shift_jis';
			case 936: return 'gb2312';
			case 949: return 'euc-kr';
			case 950: return 'big5';
			case 65001: return 'utf-8';
			default: return 'windows-1252';
		}
	}
}
