import { CRC } from './CRC.js';

// Slicing-by-2 companion table: T1[i] applies the CRC table twice, letting the
// hot loops fold two input bytes per iteration. Valid because CRC tables are
// linear over GF(2): T[a ^ b] = T[a] ^ T[b].
const crcTable2: Uint16Array = (() => {
	const t0 = CRC.crcTable;
	const t1 = new Uint16Array(256);
	for (let i = 0; i < 256; i++) {
		t1[i] = ((t0[i] >>> 8) ^ t0[t0[i] & 0xFF]) & 0xFFFF;
	}
	return t1;
})();

export class CRC8StreamHandler {
	private _data: Uint8Array;
	private _position: number = 0;
	seed: number;

	get length(): number { return this._data.length; }
	get position(): number { return this._position; }
	set position(value: number) { this._position = value; }

	constructor(data: Uint8Array, seed: number) {
		this._data = data;
		this.seed = seed;
	}

	read(buffer: Uint8Array, offset: number, count: number): number {
		const nbytes = Math.min(count, this._data.length - this._position);
		const length = offset + nbytes;

		for (let index = offset; index < length; ++index) {
			buffer[index] = this._data[this._position + (index - offset)];
			this.seed = CRC8StreamHandler._decode(this.seed, buffer[index]);
		}

		this._position += nbytes;
		return nbytes;
	}

	write(buffer: Uint8Array, offset: number, count: number): void {
		const length = offset + count;
		const data = this._data;
		const table = CRC.crcTable;
		const table2 = crcTable2;
		let seed = this.seed;
		let position = this._position;

		const pairEnd = offset + (count & ~1);
		for (let index = offset; index < pairEnd; index += 2) {
			const value0 = buffer[index];
			const value1 = buffer[index + 1];
			const x = seed ^ value0 ^ (value1 << 8);
			seed = (table2[x & 0xFF] ^ table[(x >>> 8) & 0xFF]) & 0xFFFF;
			data[position++] = value0;
			data[position++] = value1;
		}
		if ((count & 1) !== 0) {
			const value = buffer[length - 1];
			seed = ((seed >>> 8) ^ table[(value ^ seed) & 0xFF]) & 0xFFFF;
			data[position++] = value;
		}

		this.seed = seed;
		this._position = position;
	}

	static getCRCValue(seed: number, buffer: Uint8Array, startPos: number, endPos: number): number {
		const table = CRC.crcTable;
		const table2 = crcTable2;
		let currValue = seed;
		let index = startPos;
		const count = endPos;

		const pairEnd = index + (count & ~1);
		while (index < pairEnd) {
			const x = currValue ^ buffer[index] ^ (buffer[index + 1] << 8);
			currValue = (table2[x & 0xFF] ^ table[(x >>> 8) & 0xFF]) & 0xFFFF;
			index += 2;
		}
		if ((count & 1) !== 0) {
			const value = buffer[index];
			currValue = ((currValue >>> 8) ^ table[(value ^ currValue) & 0xFF]) & 0xFFFF;
		}

		return currValue;
	}

	private static _decode(key: number, value: number): number {
		const index = value ^ (key & 0xFF);
		key = ((key >>> 8) ^ CRC.crcTable[index]) & 0xFFFF;
		return key;
	}
}
