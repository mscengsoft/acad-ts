import { CadReaderConfiguration } from '../CadReaderConfiguration.js';

export class DwgReaderConfiguration extends CadReaderConfiguration {
	crcCheck: boolean = false;
	readSummaryInfo: boolean = true;
	maxDecompressedSectionSize: number = 512 * 1024 * 1024;
}
