import { ICompressor } from './ICompressor.js';

export class DwgLZ77AC18Compressor implements ICompressor {
	private _source!: Uint8Array;

	private _dest: Uint8Array = new Uint8Array(0x8000);
	private _destLength: number = 0;

	private _block: Int32Array = new Int32Array(0x8000);

	private _currOffset: number = 0;

	private _lastSource: Uint8Array | null = null;
	private _lastEnd: number = 0;

	constructor() {
	}

	compress(source: Uint8Array, offset: number, totalSize: number): Uint8Array {
		// Sequential chunks of the same buffer can share the hash table: every
		// stale entry points below the new initialOffset and is rejected by the
		// `value >= initialOffset` guard, so match results are identical to a
		// fresh table. Any other input needs the table cleared.
		if (source !== this._lastSource || offset < this._lastEnd) {
			this._block.fill(-1);
		}
		this._lastSource = source;
		this._lastEnd = offset + totalSize;

		this._source = source;
		this._destLength = 0;
		if (this._dest.length < totalSize + (totalSize >>> 3) + 0x20) {
			this._dest = new Uint8Array(totalSize + (totalSize >>> 3) + 0x20);
		}

		const block = this._block;
		const initialOffset = offset;
		const totalOffset = offset + totalSize;
		const loopEnd = totalOffset - 0x13;
		this._currOffset = offset;

		let currPosition = offset + 4;
		let compressionOffset = 0;
		let matchPos = 0;
		let misses = 0;

		while (currPosition < loopEnd) {
			const v1 = source[currPosition + 3] << 6;
			const v2 = v1 ^ source[currPosition + 2];
			const v3 = (v2 << 5) ^ source[currPosition + 1];
			const v4 = (v3 << 5) ^ source[currPosition];
			let valueIndex = (v4 + (v4 >>> 5)) & 0x7FFF;

			let value = block[valueIndex];
			let dist = currPosition - value;
			let matchLength = 0;

			if (value >= initialOffset && dist <= 0xBFFF) {
				if (dist > 0x400 && source[currPosition + 3] !== source[value + 3]) {
					valueIndex = (valueIndex & 0x7FF) ^ 0b100000000011111;
					value = block[valueIndex];
					dist = currPosition - value;
					if (value < initialOffset ||
						dist > 0xBFFF ||
						(dist > 0x400 &&
						source[currPosition + 3] !== source[value + 3])) {
						block[valueIndex] = currPosition;
						currPosition += 1 + (misses++ >> 6);
						continue;
					}
				}
				if (source[currPosition] === source[value] &&
					source[currPosition + 1] === source[value + 1] &&
					source[currPosition + 2] === source[value + 2]) {
					matchLength = 3;
					let index = value + 3;
					let currOff = currPosition + 3;
					while (currOff < totalOffset && source[index++] === source[currOff++]) {
						matchLength++;
					}
				}
			}

			block[valueIndex] = currPosition;

			if (matchLength < 3) {
				// Accelerating skip through long incompressible runs: after 64
				// consecutive misses start stepping further. Skipped positions
				// simply aren't match candidates - the output stays valid.
				currPosition += 1 + (misses++ >> 6);
				continue;
			}
			misses = 0;

			const mask = currPosition - this._currOffset;

			if (compressionOffset !== 0) {
				this._applyMask(matchPos, compressionOffset, mask);
			}

			this._writeLiteralLength(mask);
			currPosition += matchLength;
			this._currOffset = currPosition;
			compressionOffset = matchLength;
			matchPos = dist;
		}

		const literalLength = totalOffset - this._currOffset;

		if (compressionOffset !== 0) {
			this._applyMask(matchPos, compressionOffset, literalLength);
		}

		this._writeLiteralLength(literalLength);

		//0x11 : Terminates the input stream.
		this._push(0x11);
		this._push(0);
		this._push(0);

		// A view into the reused scratch buffer: valid until the next compress()
		// call. Callers write it out (and checksum it) immediately.
		return this._dest.subarray(0, this._destLength);
	}

	private _push(value: number): void {
		if (this._destLength >= this._dest.length) {
			const grown = new Uint8Array(this._dest.length * 2);
			grown.set(this._dest);
			this._dest = grown;
		}
		this._dest[this._destLength++] = value;
	}

	private _writeLen(len: number): void {
		if (len <= 0) {
			throw new Error('Invalid length');
		}

		while (len > 0xFF) {
			len -= 0xFF;
			this._push(0);
		}

		this._push(len & 0xFF);
	}

	private _writeOpCode(opCode: number, compressionOffset: number, value: number): void {
		if (compressionOffset <= 0) {
			throw new Error('Invalid compressionOffset');
		}

		if (value <= 0) {
			throw new Error('Invalid value');
		}

		if (compressionOffset <= value) {
			this._push((opCode | (compressionOffset - 2)) & 0xFF);
		} else {
			this._push(opCode & 0xFF);
			this._writeLen(compressionOffset - value);
		}
	}

	private _writeLiteralLength(length: number): void {
		if (length <= 0) return;

		if (length > 3) {
			this._writeOpCode(0, length - 1, 0x11);
		}

		if (this._destLength + length > this._dest.length) {
			const grown = new Uint8Array(Math.max(this._dest.length * 2, this._destLength + length));
			grown.set(this._dest);
			this._dest = grown;
		}
		this._dest.set(this._source.subarray(this._currOffset, this._currOffset + length), this._destLength);
		this._destLength += length;
	}

	private _applyMask(matchPosition: number, compressionOffset: number, mask: number): void {
		let curr = 0;
		let next = 0;
		if (compressionOffset >= 0x0F || matchPosition > 0x400) {
			if (matchPosition <= 0x4000) {
				matchPosition--;
				//compressedBytes is read as the next Long Compression Offset + 0x21
				this._writeOpCode(0x20, compressionOffset, 0x21);
			} else {
				matchPosition -= 0x4000;
				//compressedBytes is read as the next Long Compression Offset, with 9 added
				this._writeOpCode(0x10 | ((matchPosition >>> 11) & 8), compressionOffset, 0x09);
			}

			//offset = (firstByte >> 2) | (readByte() << 6))
			curr = (matchPosition & 0xFF) << 2;
			next = matchPosition >>> 6;
		} else {
			matchPosition--;
			//compressedBytes = ((opcode1 & 0xF0) >> 4) – 1
			curr = ((compressionOffset + 1) << 4) | ((matchPosition & 0b11) << 2);
			next = matchPosition >>> 2;
		}

		if (mask < 4) {
			curr |= mask;
		}

		this._push(curr & 0xFF);
		this._push(next & 0xFF);
	}
}
