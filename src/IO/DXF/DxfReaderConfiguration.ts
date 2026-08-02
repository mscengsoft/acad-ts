import { CadReaderConfiguration } from '../CadReaderConfiguration.js';

export class DxfReaderConfiguration extends CadReaderConfiguration {
  public clearCache: boolean = false;

  public createDefaults: boolean = false;
}
