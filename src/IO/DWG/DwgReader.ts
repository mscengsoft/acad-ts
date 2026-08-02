import { ACadVersion } from '../../ACadVersion.js';
import { CadDocument } from '../../CadDocument.js';
import { CadSummaryInfo } from '../../CadSummaryInfo.js';
import { CadUtils } from '../../CadUtils.js';
import { DwgPreview } from '../../DwgPreview.js';
import { DxfClassCollection } from '../../Classes/DxfClassCollection.js';
import { CadNotSupportedException } from '../../Exceptions/CadNotSupportedException.js';
import { DwgException } from '../../Exceptions/DwgException.js';
import { CadHeader } from '../../Header/CadHeader.js';
import { CadReaderBase } from '../CadReaderBase.js';
import { HugeMemoryStream } from '../HugeMemoryStream.js';
import { NotificationEventHandler, NotificationType } from '../NotificationEventHandler.js';
import { DwgFileHeader } from './FileHeaders/DwgFileHeader.js';
import './FileHeaders/DwgFileHeaderFactory.js';
import { DwgFileHeaderAC15 } from './FileHeaders/DwgFileHeaderAC15.js';
import { DwgFileHeaderAC18 } from './FileHeaders/DwgFileHeaderAC18.js';
import { DwgFileHeaderAC21 } from './FileHeaders/DwgFileHeaderAC21.js';
import { DwgLocalSectionMap } from './FileHeaders/DwgLocalSectionMap.js';
import { DwgSectionDefinition } from './FileHeaders/DwgSectionDefinition.js';
import { DwgSectionDescriptor } from './FileHeaders/DwgSectionDescriptor.js';
import { DwgSectionLocatorRecord } from './FileHeaders/DwgSectionLocatorRecord.js';
import { Dwg21CompressedMetadata } from './FileHeaders/Dwg21CompressedMetadata.js';
import { DwgDocumentBuilder } from './DwgDocumentBuilder.js';
import { DwgHeaderHandlesCollection } from './DwgHeaderHandlesCollection.js';
import { DwgReaderConfiguration } from './DwgReaderConfiguration.js';
import { DwgSectionIO } from './DwgSectionIO.js';
import { CRC32StreamHandler } from './CRC32StreamHandler.js';
import { IDwgStreamReader } from './DwgStreamReaders/IDwgStreamReader.js';
import { DwgStreamReaderBase } from './DwgStreamReaders/DwgStreamReaderBase.js';
import './DwgStreamReaders/DwgStreamReaderFactory.js';
import { DwgClassesReader } from './DwgStreamReaders/DwgClassesReader.js';
import { DwgHandleReader } from './DwgStreamReaders/DwgHandleReader.js';
import { DwgHeaderReader } from './DwgStreamReaders/DwgHeaderReader.js';
import { DwgObjectReader } from './DwgStreamReaders/DwgObjectReader.js';
import { DwgPreviewReader } from './DwgStreamReaders/DwgPreviewReader.js';
import { DwgSummaryInfoReader } from './DwgStreamReaders/DwgSummaryInfoReader.js';
import { DwgLZ77AC18Decompressor } from './DwgStreamReaders/DwgLZ77AC18Decompressor.js';
import { DwgLZ77AC21Decompressor } from './DwgStreamReaders/DwgLZ77AC21Decompressor.js';

export class DwgReader extends CadReaderBase<DwgReaderConfiguration> {
	private _builder!: DwgDocumentBuilder;
	private _fileHeader!: DwgFileHeader;
	private _rsScratch: Uint8Array<ArrayBuffer> = new Uint8Array(0);

	constructor(stream: ArrayBuffer, notification: NotificationEventHandler | null = null) {
		super(stream, notification);
	}

	protected createDefaultConfiguration(): DwgReaderConfiguration {
		return new DwgReaderConfiguration();
	}

	static readFromStream(stream: ArrayBuffer, notification: NotificationEventHandler | null = null): CadDocument {
		return DwgReader.readFromStreamWithConfig(stream, new DwgReaderConfiguration(), notification);
	}

	static readFromStreamWithConfig(stream: ArrayBuffer, configuration: DwgReaderConfiguration, notification: NotificationEventHandler | null = null): CadDocument {
		const reader = new DwgReader(stream, notification);
		reader.configuration = configuration;
		const doc = reader.read();
		reader.dispose();
		return doc;
	}

	read(): CadDocument {
		this._document = new CadDocument(undefined, false);

		this._fileHeader = this.readFileHeader();

		this._builder = new DwgDocumentBuilder(this._fileHeader.acadVersion, this._document, this.configuration);
		this._builder.onNotification = this.onNotification ? (sender, e) => this.onNotificationEvent(sender, e) : null;

		this._document.summaryInfo = this.readSummaryInfo();
		this._document.header = this.readHeader();
		this._document.header.document = this._document;
		this._document.classes = this._readClasses();

		this._readObjects();

		this._builder.buildDocument();

		return this._document;
	}

	readSummaryInfo(): CadSummaryInfo {
		this._fileHeader = this._fileHeader ?? this.readFileHeader();

		if (this._fileHeader.acadVersion < ACadVersion.AC1018 || !this.configuration.readSummaryInfo) {
			return new CadSummaryInfo();
		}

		const reader = this._getSectionStream(DwgSectionDefinition.summaryInfo);
		if (!reader) return new CadSummaryInfo();

		const summaryReader = new DwgSummaryInfoReader(this._fileHeader.acadVersion, reader);
		return summaryReader.read();
	}

	readPreview(): DwgPreview | null {
		this._fileHeader = this._fileHeader ?? this.readFileHeader();

		if (this._fileHeader.previewAddress < 0) return null;

		let streamReader = this._getSectionStream(DwgSectionDefinition.preview);
		if (!streamReader) {
			streamReader = DwgStreamReaderBase.getStreamHandler(this._fileHeader.acadVersion, new Uint8Array(this._fileStream));
			streamReader.position = this._fileHeader.previewAddress;
		}

		const reader = new DwgPreviewReader(this._fileHeader.acadVersion, streamReader, this._fileHeader.previewAddress);
		return reader.read();
	}

	readHeader(): CadHeader {
		this._fileHeader = this._fileHeader ?? this.readFileHeader();

		const header = new CadHeader();
		header.codePage = CadUtils.getCodePageName(this._fileHeader.drawingCodePage);

		const sreader = this._getSectionStream(DwgSectionDefinition.header)!;

		const hReader = new DwgHeaderReader(this._fileHeader.acadVersion, sreader, header);
		hReader.onNotification = (sender, e) => this.onNotificationEvent(sender, e);

		const headerHandles = hReader.read(this._fileHeader.acadMaintenanceVersion);

		if (this._builder) {
			this._builder.headerHandles = headerHandles.objectPointers;
		}

		return header;
	}

	readFileHeader(): DwgFileHeader {
		// Reset stream position to beginning
		const fileBytes = new Uint8Array(this._fileStream);

		// 0x00  6  "ACXXXX" version string
		const versionStr = String.fromCharCode(...fileBytes.slice(0, 6));
		const version = CadUtils.getVersionFromName(versionStr);
		const fileHeader = DwgFileHeader.createFileHeader(version)!;

		// Get the stream reader, positioned after the version string
		const sreader = DwgStreamReaderBase.getStreamHandler(fileHeader.acadVersion, fileBytes);
		sreader.position = 6;

		// Read the file header based on version
		switch (fileHeader.acadVersion) {
			case ACadVersion.Unknown:
				throw new CadNotSupportedException();
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
				throw new CadNotSupportedException(fileHeader.acadVersion);
			case ACadVersion.AC1012:
			case ACadVersion.AC1014:
			case ACadVersion.AC1015:
				this._readFileHeaderAC15(fileHeader as DwgFileHeaderAC15, sreader);
				break;
			case ACadVersion.AC1018:
				this._readFileHeaderAC18(fileHeader as DwgFileHeaderAC18, sreader);
				break;
			case ACadVersion.AC1021:
				try {
					this._readFileHeaderAC21(fileHeader as DwgFileHeaderAC21, sreader);
				} catch (_err) {
					// Accept AC18-compatible AC1021 files by falling back to AC18 header parsing.
					sreader.position = 6;
					this._readFileHeaderAC18(fileHeader as DwgFileHeaderAC18, sreader);
				}
				break;
			case ACadVersion.AC1024:
			case ACadVersion.AC1027:
			case ACadVersion.AC1032:
				this._readFileHeaderAC18(fileHeader as DwgFileHeaderAC18, sreader);
				break;
			default:
				break;
		}

		return fileHeader;
	}

	private _readClasses(): DxfClassCollection {
		this._fileHeader = this._fileHeader ?? this.readFileHeader();

		const sreader = this._getSectionStream(DwgSectionDefinition.classes)!;

		const reader = new DwgClassesReader(this._fileHeader.acadVersion, sreader, this._fileHeader);
		reader.onNotification = (sender, e) => this.onNotificationEvent(sender, e);

		return reader.read();
	}

	private _readHandles(): Map<number, number> {
		this._fileHeader = this._fileHeader ?? this.readFileHeader();

		const sreader = this._getSectionStream(DwgSectionDefinition.handles)!;

		const handleReader = new DwgHandleReader(this._fileHeader.acadVersion, sreader);
		handleReader.onNotification = (sender, e) => this.onNotificationEvent(sender, e);

		return handleReader.read();
	}

	private _readObjFreeSpace(): number {
		this._fileHeader = this._fileHeader ?? this.readFileHeader();

		if (this._fileHeader.acadVersion < ACadVersion.AC1018) return 0;

		const sreader = this._getSectionStream(DwgSectionDefinition.objFreeSpace)!;

		sreader.advance(16);
		return sreader.readUInt();
	}

	private _readObjects(): void {
		const handles = this._readHandles();
		// read() already parsed the classes section; avoid decoding and
		// parsing it a second time when called through the standard path.
		if (!this._document.classes || this._document.classes.count === 0) {
			this._document.classes = this._readClasses();
		}

		let sreader: IDwgStreamReader;
		if (this._fileHeader.acadVersion <= ACadVersion.AC1015) {
			sreader = DwgStreamReaderBase.getStreamHandler(this._fileHeader.acadVersion, new Uint8Array(this._fileStream), this._encoding);
			sreader.position = 0;
		} else {
			sreader = this._getSectionStream(DwgSectionDefinition.acDbObjects)!;
		}

		const objectHandles: number[] = this._builder.headerHandles.getHandles()
			.filter((o): o is number => o != null)
			.map(a => a);

		const sectionReader = new DwgObjectReader(
			this._fileHeader.acadVersion,
			this._builder,
			sreader,
			objectHandles,
			handles,
			this._document.classes,
		);

		sectionReader.read();
	}

	private _getSectionStream(sectionName: string): IDwgStreamReader | null {
		let sectionBuffer: Uint8Array | null = null;

		switch (this._fileHeader.acadVersion) {
			case ACadVersion.Unknown:
				throw new CadNotSupportedException();
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
				throw new CadNotSupportedException(this._fileHeader.acadVersion);
			case ACadVersion.AC1012:
			case ACadVersion.AC1014:
			case ACadVersion.AC1015:
				sectionBuffer = this._getSectionBuffer15(this._fileHeader as DwgFileHeaderAC15, sectionName);
				break;
			case ACadVersion.AC1018:
				sectionBuffer = this._getSectionBuffer18(this._fileHeader as DwgFileHeaderAC18, sectionName);
				break;
			case ACadVersion.AC1021:
				if ((this._fileHeader as DwgFileHeaderAC21).compressedMetadata) {
					sectionBuffer = this._getSectionBuffer21(this._fileHeader as DwgFileHeaderAC21, sectionName);
				} else {
					sectionBuffer = this._getSectionBuffer18(this._fileHeader as DwgFileHeaderAC18, sectionName);
				}
				break;
			case ACadVersion.AC1024:
			case ACadVersion.AC1027:
			case ACadVersion.AC1032:
				sectionBuffer = this._getSectionBuffer18(this._fileHeader as DwgFileHeaderAC18, sectionName);
				break;
			default:
				break;
		}

		if (!sectionBuffer) return null;

		const streamHandler = DwgStreamReaderBase.getStreamHandler(this._fileHeader.acadVersion, sectionBuffer);
		streamHandler.encoding = this._encoding;
		return streamHandler;
	}

	// #region File Header reading methods

	private _readFileHeaderAC15(fileheader: DwgFileHeaderAC15, sreader: IDwgStreamReader): void {
		// The next 7 starting at offset 0x06 are to be six bytes of 0
		// (in R14, 5 0's and the ACADMAINTVER variable) and a byte of 1.
		sreader.readBytes(7);

		// At 0x0D is a seeker for the beginning sentinel of the image data.
		fileheader.previewAddress = sreader.readInt();

		// Undocumented Bytes at 0x11 and 0x12
		sreader.readBytes(2);

		// Bytes at 0x13 and 0x14 are a raw short indicating the code page
		fileheader.drawingCodePage = CadUtils.getCodePage(sreader.readShort());
		this._encoding = this.getListedEncoding(fileheader.drawingCodePage);

		// At 0x15 is a long that tells how many sets of recno/seeker/length records follow
		const nRecords = sreader.readRawLong();

		for (let i = 0; i < nRecords; ++i) {
			const record = new DwgSectionLocatorRecord();
			record.number = sreader.readByte();
			record.seeker = sreader.readRawLong();
			record.size = sreader.readRawLong();
			fileheader.records.set(record.number!, record);
		}

		// RS : CRC for BOF to this point.
		sreader.resetShift();

		const sn = sreader.readSentinel();
		DwgSectionIO.checkSentinel(sn, DwgFileHeaderAC15.endSentinel);
	}

	private _readFileMetaData(fileheader: DwgFileHeaderAC18, sreader: IDwgStreamReader): void {
		// 5 bytes of 0x00
		sreader.advance(5);

		// 0x0B  Maintenance release version
		fileheader.acadMaintenanceVersion = sreader.readByte();
		// 0x0C  Byte 0x00, 0x01, or 0x03
		sreader.advance(1);
		// 0x0D  Preview address
		fileheader.previewAddress = sreader.readRawLong();
		// 0x11  Dwg version
		fileheader.dwgVersion = sreader.readByte();
		// 0x12  Application maintenance release version
		fileheader.appReleaseVersion = sreader.readByte();

		// 0x13  Codepage
		fileheader.drawingCodePage = CadUtils.getCodePage(sreader.readShort());
		this._encoding = this.getListedEncoding(fileheader.drawingCodePage);

		// 0x15  3 zero bytes
		sreader.advance(3);

		// 0x18  SecurityType
		fileheader.securityType = sreader.readRawLong();
		// 0x1C  Unknown
		sreader.readRawLong();
		// 0x20  Summary info Address in stream
		fileheader.summaryInfoAddr = sreader.readRawLong();
		// 0x24  VBA Project Addr
		fileheader.vbaProjectAddr = sreader.readRawLong();

		// 0x28  0x00000080
		sreader.readRawLong();

		// 0x2C  App info Address in stream
		sreader.readRawLong();

		// Get to offset 0x80 - 0x30 = 80 bytes
		sreader.advance(80);
	}

	private _readFileHeaderAC18(fileheader: DwgFileHeaderAC18, sreader: IDwgStreamReader): void {
		this._readFileMetaData(fileheader, sreader);

		// 0x80  0x6C  Encrypted Data
		const encryptedData = sreader.readBytes(0x6C); // 108 bytes
		const headerStream = new CRC32StreamHandler(encryptedData, 0, true);

		// Read 20 extra bytes (check if useful)
		sreader.readBytes(20);

		// Read header encrypted data
		// 0x00  12  "AcFssFcAJMB" file ID string
		const fileIdBytes = new Uint8Array(12);
		headerStream.read(fileIdBytes, 0, 12);
		const fileId = String.fromCharCode(...fileIdBytes);
		if (!fileId.startsWith('AcFssFcAJMB')) {
			this.triggerNotification(`File validation failed, id should be: AcFssFcAJMB, but is: ${fileId}`, NotificationType.Warning);
		}

		const readInt32LE = (): number => {
			const buf = new Uint8Array(4);
			headerStream.read(buf, 0, 4);
			return new DataView(buf.buffer).getInt32(0, true);
		};

		const readUInt32LE = (): number => {
			const buf = new Uint8Array(4);
			headerStream.read(buf, 0, 4);
			return new DataView(buf.buffer).getUint32(0, true);
		};

		const readULong = (): number => {
			const buf = new Uint8Array(8);
			headerStream.read(buf, 0, 8);
			const view = new DataView(buf.buffer);
			// JavaScript numbers only support 53 bits, use low 32 bits for most values
			const low = view.getUint32(0, true);
			const high = view.getUint32(4, true);
			return high * 0x100000000 + low;
		};

		// 0x0C  0x00
		readInt32LE();
		// 0x10  0x6c
		readInt32LE();
		// 0x14  0x04
		readInt32LE();
		// 0x18  Root tree node gap
		fileheader.rootTreeNodeGap = readInt32LE();
		// 0x1C  Lowermost left tree node gap
		fileheader.leftGap = readInt32LE();
		// 0x20  Lowermost right tree node gap
		fileheader.rigthGap = readInt32LE();
		// 0x24  Unknown long (ODA writes 1)
		readInt32LE();
		// 0x28  Last section page Id
		fileheader.lastPageId = readInt32LE();

		// 0x2C  Last section page end address (64-bit)
		fileheader.lastSectionAddr = readULong();
		// 0x34  Second header data address (64-bit)
		fileheader.secondHeaderAddr = readULong();

		// 0x3C  Gap amount
		fileheader.gapAmount = readUInt32LE();
		// 0x40  Section page amount
		fileheader.sectionAmount = readUInt32LE();
		// 0x44  0x20
		readInt32LE();
		// 0x48  0x80
		readInt32LE();
		// 0x4C  0x40
		readInt32LE();
		// 0x50  Section Page Map Id
		fileheader.sectionPageMapId = readUInt32LE();
		// 0x54  Section Page Map address (add 0x100 to this value) (64-bit)
		fileheader.pageMapAddress = readULong() + 256;
		// 0x5C  Section Map Id
		fileheader.sectionMapId = readUInt32LE();
		// 0x60  Section page array size
		fileheader.sectionArrayPageSize = readUInt32LE();
		// 0x64  Gap array size
		fileheader.gapArraySize = readUInt32LE();
		// 0x68  CRC32
		fileheader.crcSeed = readUInt32LE();

		// #region Read page map of the file
		sreader.position = fileheader.pageMapAddress;
		// Get the page size
		const pmPageType = sreader.readRawLong();
		const pmDecompressedSize = sreader.readRawLong();
		const pmCompressedSize = sreader.readRawLong();
		const pmCompressionType = sreader.readRawLong();
		const pmChecksum = sreader.readRawLong();

		// Get the decompressed stream to read the records
		const decompressed = DwgLZ77AC18Decompressor.decompress(
			sreader.stream,
			sreader.position,
			this._validateSectionSize(pmDecompressedSize, 'page map'),
		);

		// Section size
		let total = 0x100;
		let decompPos = 0;
		const decompView = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

		while (decompPos < decompressed.length) {
			const record = new DwgSectionLocatorRecord();
			// 0x00  Section page number
			record.number = decompView.getInt32(decompPos, true);
			decompPos += 4;
			// 0x04  Section size
			record.size = decompView.getInt32(decompPos, true);
			decompPos += 4;

			if (record.number! >= 0) {
				record.seeker = total;
				fileheader.records.set(record.number!, record);
			} else {
				// Negative section number = gap, skip 4 ints (Parent, Left, Right, 0x00)
				decompPos += 16;
			}

			total += record.size;
		}
		// #endregion

		// #region Read the data section map
		sreader.position = fileheader.records.get(fileheader.sectionMapId)!.seeker;

		// Get the page size
		const smPageType = sreader.readRawLong();
		const smDecompressedSize = sreader.readRawLong();
		const smCompressedSize = sreader.readRawLong();
		const smCompressionType = sreader.readRawLong();
		const smChecksum = sreader.readRawLong();

		const decompressedStream = DwgLZ77AC18Decompressor.decompress(
			sreader.stream,
			sreader.position,
			this._validateSectionSize(smDecompressedSize, 'section map'),
		);
		let dsPos = 0;
		const dsView = new DataView(decompressedStream.buffer, decompressedStream.byteOffset, decompressedStream.byteLength);

		const readDsInt = (): number => {
			const v = dsView.getInt32(dsPos, true);
			dsPos += 4;
			return v;
		};

		const readDsULong = (): number => {
			const low = dsView.getUint32(dsPos, true);
			const high = dsView.getUint32(dsPos + 4, true);
			dsPos += 8;
			return high * 0x100000000 + low;
		};

		const readDsString = (length: number): string => {
			let result = '';
			for (let i = 0; i < length; i++) {
				result += String.fromCharCode(decompressedStream[dsPos + i]);
			}
			dsPos += length;
			return result.split('\0')[0];
		};

		// 0x00  Number of section descriptions
		const ndescriptions = readDsInt();
		// 0x04  0x02
		readDsInt();
		// 0x08  0x00007400
		readDsInt();
		// 0x0C  0x00
		readDsInt();
		// 0x10  NumDescriptions
		readDsInt();

		for (let i = 0; i < ndescriptions; ++i) {
			const descriptor = new DwgSectionDescriptor();
			// 0x00  Size of section (64-bit)
			descriptor.compressedSize = readDsULong();
			// 0x08  Page count
			descriptor.pageCount = readDsInt();
			// 0x0C  Max Decompressed Size
			descriptor.decompressedSize = readDsInt();
			// 0x10  Unknown
			readDsInt();
			// 0x14  Compressed (1=no, 2=yes)
			descriptor.compressedCode = readDsInt();
			// 0x18  Section Id
			descriptor.sectionId = readDsInt();
			// 0x1C  Encrypted
			descriptor.encrypted = readDsInt();
			// 0x20  Section Name (64 bytes)
			descriptor.name = readDsString(64);

			for (let j = 0; j < descriptor.pageCount; ++j) {
				const localmap = new DwgLocalSectionMap();
				// Page number
				localmap.pageNumber = readDsInt();
				// Data size (compressed)
				localmap.compressedSize = readDsInt();
				// Start offset (64-bit)
				localmap.offset = readDsULong();

				localmap.decompressedSize = descriptor.decompressedSize;
				localmap.seeker = fileheader.records.get(localmap.pageNumber)?.seeker ?? 0;

				descriptor.localSections.push(localmap);
			}

			// Get the final size for the local section
			const sizeLeft = descriptor.compressedSize % descriptor.decompressedSize;
			if (sizeLeft > 0 && descriptor.localSections.length > 0) {
				descriptor.localSections[descriptor.localSections.length - 1].decompressedSize = sizeLeft;
			}

			fileheader.descriptors.set(descriptor.name, descriptor);
		}
		// #endregion
	}

	private _readFileHeaderAC21(fileheader: DwgFileHeaderAC21, sreader: IDwgStreamReader): void {
		this._readFileMetaData(fileheader, sreader);

		// The last 0x28 bytes of this section consists of check data
		// The first 0x3D8 bytes should be decoded using Reed-Solomon (255, 239) with factor 3
		const compressedData = sreader.readBytes(0x400);
		const decodedData = new Uint8Array(3 * 239); // factor * blockSize
		this._reedSolomonDecoding(compressedData, decodedData, 3, 239);

		const decodedView = new DataView(decodedData.buffer);
		// 0x00  CRC (64-bit)
		const crc = this._readInt64(decodedView, 0);
		// 0x08  Unknown key (64-bit)
		const unknownKey = this._readInt64(decodedView, 8);
		// 0x10  Compressed Data CRC (64-bit)
		const compressedDataCRC = this._readInt64(decodedView, 16);
		// 0x18  ComprLen (32-bit)
		const comprLen = decodedView.getInt32(24, true);
		// 0x1C  Length2 (32-bit)
		const length2 = decodedView.getInt32(28, true);

		// The decompressed size is a fixed 0x110
		const buffer = new Uint8Array(0x110);
		if (comprLen < 0) {
			// Data is not compressed
			buffer.set(decodedData.subarray(32, 32 + Math.abs(comprLen)));
		} else {
			DwgLZ77AC21Decompressor.decompress(decodedData, 32, comprLen, buffer);
		}

		// Get the decompressed stream to read the records
		const bv = new DataView(buffer.buffer);
		let bPos = 0;

		const readBufULong = (): number => {
			const low = bv.getUint32(bPos, true);
			const high = bv.getUint32(bPos + 4, true);
			bPos += 8;
			return high * 0x100000000 + low;
		};

		fileheader.compressedMetadata = new Dwg21CompressedMetadata();
		fileheader.compressedMetadata.headerSize = readBufULong();
		fileheader.compressedMetadata.fileSize = readBufULong();
		fileheader.compressedMetadata.pagesMapCrcCompressed = readBufULong();
		fileheader.compressedMetadata.pagesMapCorrectionFactor = readBufULong();
		fileheader.compressedMetadata.pagesMapCrcSeed = readBufULong();
		fileheader.compressedMetadata.map2Offset = readBufULong();
		fileheader.compressedMetadata.map2Id = readBufULong();
		fileheader.compressedMetadata.pagesMapOffset = readBufULong();
		fileheader.compressedMetadata.pagesMapId = readBufULong();
		fileheader.compressedMetadata.header2offset = readBufULong();
		fileheader.compressedMetadata.pagesMapSizeCompressed = readBufULong();
		fileheader.compressedMetadata.pagesMapSizeUncompressed = readBufULong();
		fileheader.compressedMetadata.pagesAmount = readBufULong();
		fileheader.compressedMetadata.pagesMaxId = readBufULong();
		fileheader.compressedMetadata.unknow0x20 = readBufULong();
		fileheader.compressedMetadata.unknow0x40 = readBufULong();
		fileheader.compressedMetadata.pagesMapCrcUncompressed = readBufULong();
		fileheader.compressedMetadata.unknown0xF800 = readBufULong();
		fileheader.compressedMetadata.unknown4 = readBufULong();
		fileheader.compressedMetadata.unknown1 = readBufULong();
		fileheader.compressedMetadata.sectionsAmount = readBufULong();
		fileheader.compressedMetadata.sectionsMapCrcUncompressed = readBufULong();
		fileheader.compressedMetadata.sectionsMapSizeCompressed = readBufULong();
		fileheader.compressedMetadata.sectionsMap2Id = readBufULong();
		fileheader.compressedMetadata.sectionsMapId = readBufULong();
		fileheader.compressedMetadata.sectionsMapSizeUncompressed = readBufULong();
		fileheader.compressedMetadata.sectionsMapCrcCompressed = readBufULong();
		fileheader.compressedMetadata.sectionsMapCorrectionFactor = readBufULong();
		fileheader.compressedMetadata.sectionsMapCrcSeed = readBufULong();
		fileheader.compressedMetadata.streamVersion = readBufULong();
		fileheader.compressedMetadata.crcSeed = readBufULong();
		fileheader.compressedMetadata.crcSeedEncoded = readBufULong();
		fileheader.compressedMetadata.randomSeed = readBufULong();
		fileheader.compressedMetadata.headerCRC64 = readBufULong();

		// Prepare the page data stream to read
		const arr = this._getPageBuffer(
			fileheader.compressedMetadata.pagesMapOffset,
			fileheader.compressedMetadata.pagesMapSizeCompressed,
			fileheader.compressedMetadata.pagesMapSizeUncompressed,
			fileheader.compressedMetadata.pagesMapCorrectionFactor,
			0xEF,
			new Uint8Array(this._fileStream));

		// Read the page data
		const pageDataView = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
		let pdPos = 0;
		let offset = 0;

		while (pdPos < arr.length) {
			const size = this._readInt64View(pageDataView, pdPos);
			pdPos += 8;
			const id = Math.abs(this._readInt64View(pageDataView, pdPos));
			pdPos += 8;
			fileheader.records.set(id, new DwgSectionLocatorRecord(id, offset, size));
			offset += size;
		}

		// Prepare the section map data stream to read
		const arr2 = this._getPageBuffer(
			fileheader.records.get(fileheader.compressedMetadata.sectionsMapId)!.seeker,
			fileheader.compressedMetadata.sectionsMapSizeCompressed,
			fileheader.compressedMetadata.sectionsMapSizeUncompressed,
			fileheader.compressedMetadata.sectionsMapCorrectionFactor,
			239,
			new Uint8Array(this._fileStream));

		const smView = new DataView(arr2.buffer, arr2.byteOffset, arr2.byteLength);
		let smPos = 0;

		const readSmULong = (): number => {
			const low = smView.getUint32(smPos, true);
			const high = smView.getUint32(smPos + 4, true);
			smPos += 8;
			return high * 0x100000000 + low;
		};

		const readSmLong = (): number => {
			const low = smView.getInt32(smPos, true);
			const high = smView.getInt32(smPos + 4, true);
			smPos += 8;
			return high * 0x100000000 + low;
		};

		while (smPos < arr2.length) {
			const section = new DwgSectionDescriptor();
			// 0x00  Data size (64-bit)
			section.compressedSize = readSmULong();
			// 0x08  Max size (64-bit)
			section.decompressedSize = readSmULong();
			// 0x10  Encryption (64-bit)
			section.encrypted = readSmULong();
			// 0x18  HashCode (64-bit)
			section.hashCode = readSmULong();
			// 0x20  SectionNameLength (64-bit)
			const sectionNameLength = readSmLong();
			// 0x28  Unknown (64-bit)
			readSmULong();
			// 0x30  Encoding (64-bit)
			section.encoding = readSmULong();
			// 0x38  NumPages (64-bit)
			section.pageCount = readSmULong();

			// Read the name
			if (sectionNameLength > 0) {
				let name = '';
				for (let i = 0; i < sectionNameLength; i += 2) {
					const charCode = arr2[smPos + i] | (arr2[smPos + i + 1] << 8);
					if (charCode !== 0) name += String.fromCharCode(charCode);
				}
				smPos += sectionNameLength;
				section.name = name;
			}

			let currentOffset = 0;
			for (let i = 0; i < section.pageCount; ++i) {
				const page = new DwgLocalSectionMap();
				// 8  Page data offset (64-bit)
				page.offset = readSmULong();
				// 8  Page Size (64-bit)
				page.size = readSmLong();
				// 8  Page Id (64-bit)
				page.pageNumber = readSmLong();
				// 8  Page Uncompressed Size (64-bit)
				page.decompressedSize = this._validateSectionSize(readSmULong(), `${section.name} section page (uncompressed size)`);
				// 8  Page Compressed Size (64-bit)
				page.compressedSize = this._validateSectionSize(readSmULong(), `${section.name} section page (compressed size)`);
				// 8  Page Checksum (64-bit)
				page.checksum = readSmULong();
				// 8  Page CRC (64-bit)
				page.crc = readSmULong();

				section.localSections.push(page);
				currentOffset = page.offset + page.decompressedSize;
			}

			if (sectionNameLength > 0) {
				fileheader.descriptors.set(section.name, section);
			}
		}
	}

	// #endregion

	// #region Section buffer methods

	private _getSectionBuffer15(fileheader: DwgFileHeaderAC15, sectionName: string): Uint8Array | null {
		const sectionLocator = DwgSectionDefinition.getSectionLocatorByName(sectionName);
		if (sectionLocator === null) return null;

		const record = fileheader.records.get(sectionLocator);
		if (!record) return null;

		// Return a view of the file at the section's offset
		const fileBytes = new Uint8Array(this._fileStream);
		return fileBytes.subarray(record.seeker, record.seeker + record.size);
	}

	private _getSectionBuffer18(fileheader: DwgFileHeaderAC18, sectionName: string): Uint8Array | null {
		const descriptor = fileheader.descriptors.get(sectionName);
		if (!descriptor) return null;

		const totalSize = this._validateSectionSize(
			descriptor.decompressedSize * descriptor.localSections.length,
			`${sectionName} section`,
		);
		const memoryStream = new Uint8Array(totalSize);
		let msPos = 0;

		const fileBytes = new Uint8Array(this._fileStream);
		// The position setter resets bitShift, so one reader re-positioned per
		// page is equivalent to constructing a fresh reader for each page.
		const secreader = DwgStreamReaderBase.getStreamHandler(fileheader.acadVersion, fileBytes);

		for (const section of descriptor.localSections) {
			this._validateSectionSize(section.decompressedSize, `${sectionName} section page`);
			if (section.isEmpty) {
				// Fill with zeros
				memoryStream.fill(0, msPos, msPos + section.decompressedSize);
				msPos += section.decompressedSize;
			} else {
				secreader.position = section.seeker;

				// Decrypt the data section header
				this._decryptDataSection(section, secreader);

				if (descriptor.isCompressed) {
					// Decompress to memory stream. In failsafe mode a damaged page
					// degrades to a zero-filled page instead of aborting the read.
					try {
						const decompressed = DwgLZ77AC18Decompressor.decompress(
							secreader.stream, secreader.position, section.decompressedSize);
						memoryStream.set(decompressed.subarray(0, section.decompressedSize), msPos);
					} catch (ex) {
						if (!this.configuration.failsafe || !(ex instanceof RangeError)) {
							throw ex;
						}
						this.triggerNotification(`Failed to decompress ${sectionName} section page at ${section.seeker}: ${ex.message}`, NotificationType.Error);
						memoryStream.fill(0, msPos, msPos + section.decompressedSize);
					}
					msPos += section.decompressedSize;
				} else {
					// Read directly; the bytes are copied into memoryStream right
					// away, so a short-lived view avoids an intermediate copy.
					const buf = secreader.readBytesView(section.compressedSize);
					memoryStream.set(buf, msPos);
					msPos += section.compressedSize;
				}
			}
		}

		return memoryStream.subarray(0, msPos);
	}

	private _decryptDataSection(section: DwgLocalSectionMap, sreader: IDwgStreamReader): void {
		const secMask = 0x4164536B ^ sreader.position;

		// 0x00  Section page type
		const pageType = (sreader.readRawLong() ^ secMask) | 0;
		// 0x04  Section number
		const sectionNumber = (sreader.readRawLong() ^ secMask) | 0;
		// 0x08  Data size (compressed)
		section.compressedSize = (sreader.readRawLong() ^ secMask) | 0;
		// 0x0C  Page Size (decompressed)
		section.pageSize = (sreader.readRawLong() ^ secMask) | 0;
		// 0x10  Start Offset
		const startOffset = (sreader.readRawLong() ^ secMask) | 0;
		// 0x14  Page header Checksum
		const checksum = (sreader.readRawLong() ^ secMask) | 0;
		section.offset = ((checksum + startOffset) | 0) >>> 0;
		// 0x18  Data Checksum
		section.checksum = ((sreader.readRawLong() ^ secMask) | 0) >>> 0;
		// 0x1C  Unknown
		const oda = ((sreader.readRawLong() ^ secMask) | 0) >>> 0;
	}

	private _getSectionBuffer21(fileheader: DwgFileHeaderAC21, sectionName: string): Uint8Array | null {
		const section = fileheader.descriptors.get(sectionName);
		if (!section) return null;

		// Get total length of all uncompressed pages
		let totalLength = 0;
		for (const page of section.localSections) {
			this._validateSectionSize(page.decompressedSize, `${sectionName} section page`);
			totalLength = this._validateSectionSize(
				totalLength + page.decompressedSize,
				`${sectionName} section`,
			);
		}

		const memoryStream = new Uint8Array(totalLength);
		let msPos = 0;

		const fileBytes = new Uint8Array(this._fileStream);

		for (const page of section.localSections) {
			if (page.isEmpty) {
				// memoryStream is freshly zero-initialized, so just advance the cursor
				msPos += page.decompressedSize;
			} else {
				const pageData = fileheader.records.get(page.pageNumber);
				if (!pageData) continue;

				// Set pointer to current page (add 0x480 offset)
				const startPos = pageData.seeker + 0x480;
				let pageBytes = fileBytes.subarray(startPos, startPos + pageData.size);

				if (section.encoding === 4) {
					// Reed-Solomon encoded. Use safe (non-int32) arithmetic and
					// validate the resulting buffer size — compressedSize comes from
					// the file and must not drive an unbounded allocation.
					const v = Math.floor((page.compressedSize + 7) / 8) * 8;
					const alignedPageSize = Math.ceil(v / 251);
					const rsSize = this._validateSectionSize(
						alignedPageSize * 251,
						`${sectionName} section page (reed-solomon)`,
					);
					// Reuse one scratch buffer across pages; RS decode overwrites
					// the first rsSize bytes it reads and the tail is never read.
					if (this._rsScratch.length < rsSize) {
						this._rsScratch = new Uint8Array(rsSize + (rsSize >>> 1));
					}
					const arr = this._rsScratch.subarray(0, rsSize);
					this._reedSolomonDecoding(pageBytes, arr, alignedPageSize, 251);
					pageBytes = arr;
				}

				if (page.compressedSize !== page.decompressedSize) {
					// Compressed: decompress straight into the section buffer,
					// no intermediate page allocation.
					const decompressedSize = this._validateSectionSize(
						page.decompressedSize,
						`${sectionName} section page`,
					);
					const target = memoryStream.subarray(msPos, msPos + decompressedSize);
					try {
						DwgLZ77AC21Decompressor.decompress(pageBytes, 0, page.compressedSize, target);
					} catch (ex) {
						// A damaged page should not abort the whole document in
						// failsafe mode: leave the page zero-filled and keep the
						// cursor aligned for the following pages. Hard limits
						// (DwgException) still propagate.
						if (!this.configuration.failsafe || !(ex instanceof RangeError)) {
							throw ex;
						}
						this.triggerNotification(`Failed to decompress ${sectionName} section page ${page.pageNumber}: ${ex.message}`, NotificationType.Error);
						target.fill(0);
						msPos += page.decompressedSize;
						continue;
					}
					msPos += page.decompressedSize;
					continue;
				}

				memoryStream.set(pageBytes.subarray(0, page.decompressedSize), msPos);
				msPos += page.decompressedSize;
			}
		}

		return memoryStream.subarray(0, msPos);
	}

	// #endregion

	private _getPageBuffer(pageOffset: number, compressedSize: number, uncompressedSize: number, correctionFactor: number, blockSize: number, stream: Uint8Array): Uint8Array {
		// Round up to an 8-byte boundary without coercing to int32 — a huge
		// compressedSize must reach _validateSectionSize as-is, not masked.
		const v = Math.floor((compressedSize + 7) / 8) * 8;

		const totalSize = this._validateSectionSize(v * correctionFactor, 'encoded data page');
		const factor = Math.floor((totalSize + blockSize - 1) / blockSize);
		const length = this._validateSectionSize(factor * 255, 'encoded data page buffer');

		// Relative to data page map 1, add 0x480 to get stream position
		const readPos = 0x480 + pageOffset;
		let encoded: Uint8Array;
		if (readPos >= 0 && readPos + length <= stream.length) {
			// Common case: decode straight from a view of the file, no intermediate copy
			encoded = stream.subarray(readPos, readPos + length);
		} else {
			// Truncated/out-of-range page: keep the original zero-padded copy semantics
			encoded = new Uint8Array(length);
			encoded.set(stream.subarray(readPos, readPos + length));
		}

		const compressedData = new Uint8Array(totalSize);
		this._reedSolomonDecoding(encoded, compressedData, factor, blockSize);

		const decompressedData = new Uint8Array(this._validateSectionSize(uncompressedSize, 'data page'));
		DwgLZ77AC21Decompressor.decompress(compressedData, 0, compressedSize, decompressedData);

		return decompressedData;
	}

	private _validateSectionSize(size: number, sectionName: string): number {
		const maximum = this.configuration.maxDecompressedSectionSize;
		if (!Number.isSafeInteger(size) || size < 0) {
			throw new DwgException(`Invalid decompressed size ${size} for ${sectionName}.`);
		}
		if (!Number.isSafeInteger(maximum) || maximum <= 0) {
			throw new DwgException(`Invalid maxDecompressedSectionSize configuration: ${maximum}.`);
		}
		if (size > maximum) {
			throw new DwgException(
				`Decompressed size ${size} for ${sectionName} exceeds the configured limit ${maximum}.`,
			);
		}
		return size;
	}

	private _readInt64(view: DataView, offset: number): number {
		const low = view.getUint32(offset, true);
		const high = view.getInt32(offset + 4, true);
		return high * 0x100000000 + low;
	}

	private _readInt64View(view: DataView, offset: number): number {
		const low = view.getUint32(offset, true);
		const high = view.getInt32(offset + 4, true);
		return high * 0x100000000 + low;
	}

	private _reedSolomonDecoding(encoded: Uint8Array, buffer: Uint8Array, factor: number, blockSize: number): void {
		if (factor === 1) {
			// Single interleave block: the de-interleave is a plain contiguous copy.
			// subarray clamps to encoded.length; the pre-zeroed tail matches the old
			// undefined-coerces-to-0 writes byte for byte.
			const size = Math.min(buffer.length, blockSize);
			buffer.set(encoded.subarray(0, size));
			return;
		}
		let index = 0;
		let length = buffer.length;
		const factor2 = factor + factor;
		const factor3 = factor2 + factor;
		const factor4 = factor3 + factor;
		const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
		for (let i = 0; i < factor && i < encoded.length; ++i) {
			let cindex = i;
			const size = Math.min(length, blockSize);
			length -= size;
			const offset = index + size;
			const offsetUnrolled = offset - 3;
			while (index < offsetUnrolled) {
				view.setUint32(index,
					encoded[cindex]
					| (encoded[cindex + factor] << 8)
					| (encoded[cindex + factor2] << 16)
					| (encoded[cindex + factor3] << 24), true);
				index += 4;
				cindex += factor4;
			}
			while (index < offset) {
				buffer[index] = encoded[cindex];
				++index;
				cindex += factor;
			}
		}
	}
}
