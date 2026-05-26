import type { ConnectorClient } from './client';
import type {
  CompressParams,
  ExportParams,
  CombineParams,
  SplitParams,
  OcrParams,
  ProtectParams,
  RemoveProtectionParams,
  ExtractParams,
  WatermarkParams,
  DeletePagesParams,
  ReorderPagesParams,
  RotatePagesParams,
  DocumentMergeParams,
} from '../types';

interface JobLocation {
  location: string;
}

export class OperationsApi {
  constructor(private readonly client: ConnectorClient) {}

  /**
   * Compress a PDF
   */
  async compress(params: CompressParams): Promise<string> {
    const body: Record<string, unknown> = { assetID: params.assetID };
    if (params.compressionLevel) {
      body.compressionLevel = params.compressionLevel;
    }
    const result = await this.client.post<JobLocation>('/operation/compresspdf', body);
    return result.location;
  }

  /**
   * Export PDF to another format (docx, xlsx, pptx, rtf, jpeg, png)
   */
  async exportPdf(params: ExportParams): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/exportpdf', {
      assetID: params.assetID,
      targetFormat: params.targetFormat,
    });
    return result.location;
  }

  /**
   * Create PDF from supported formats
   */
  async createPdf(assetID: string): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/createpdf', {
      assetID,
    });
    return result.location;
  }

  /**
   * Combine multiple PDFs into one
   */
  async combine(params: CombineParams): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/combinepdf', {
      assets: params.assets,
    });
    return result.location;
  }

  /**
   * Split a PDF into multiple parts
   */
  async split(params: SplitParams): Promise<string> {
    const body: Record<string, unknown> = { assetID: params.assetID };
    if (params.pageRanges) body.pageRanges = params.pageRanges;
    if (params.pageCount) body.pageCount = params.pageCount;
    const result = await this.client.post<JobLocation>('/operation/splitpdf', body);
    return result.location;
  }

  /**
   * OCR a scanned PDF
   */
  async ocr(params: OcrParams): Promise<string> {
    const body: Record<string, unknown> = { assetID: params.assetID };
    if (params.ocrLocale) body.ocrLocale = params.ocrLocale;
    if (params.ocrType) body.ocrType = params.ocrType;
    const result = await this.client.post<JobLocation>('/operation/ocr', body);
    return result.location;
  }

  /**
   * Password-protect a PDF
   */
  async protect(params: ProtectParams): Promise<string> {
    const body: Record<string, unknown> = {
      assetID: params.assetID,
      passwordProtection: params.passwordProtection,
    };
    if (params.encryptionAlgorithm) body.encryptionAlgorithm = params.encryptionAlgorithm;
    const result = await this.client.post<JobLocation>('/operation/protectpdf', body);
    return result.location;
  }

  /**
   * Remove password protection from a PDF
   */
  async removeProtection(params: RemoveProtectionParams): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/removeprotection', {
      assetID: params.assetID,
      password: params.password,
    });
    return result.location;
  }

  /**
   * Extract text and tables from a PDF
   */
  async extract(params: ExtractParams): Promise<string> {
    const body: Record<string, unknown> = { assetID: params.assetID };
    if (params.elementsToExtract) body.elementsToExtract = params.elementsToExtract;
    if (params.renditionsToExtract) body.renditionsToExtract = params.renditionsToExtract;
    const result = await this.client.post<JobLocation>('/operation/extractpdf', body);
    return result.location;
  }

  /**
   * Add a watermark to a PDF
   */
  async watermark(params: WatermarkParams): Promise<string> {
    const body: Record<string, unknown> = { assetID: params.assetID };
    if (params.watermarkAssetID) body.watermarkAssetID = params.watermarkAssetID;
    if (params.text) body.text = params.text;
    if (params.appearance) body.appearance = params.appearance;
    const result = await this.client.post<JobLocation>('/operation/pdfwatermark', body);
    return result.location;
  }

  /**
   * Delete pages from a PDF
   */
  async deletePages(params: DeletePagesParams): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/deletepages', {
      assetID: params.assetID,
      pageRanges: params.pageRanges,
    });
    return result.location;
  }

  /**
   * Reorder pages in a PDF
   */
  async reorderPages(params: ReorderPagesParams): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/reorderpages', {
      assetID: params.assetID,
      pagesOrdering: params.pagesOrdering,
    });
    return result.location;
  }

  /**
   * Rotate pages in a PDF
   */
  async rotatePages(params: RotatePagesParams): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/rotatepages', {
      assetID: params.assetID,
      pagesRotation: params.pagesRotation,
    });
    return result.location;
  }

  /**
   * Linearize a PDF for fast web viewing
   */
  async linearize(assetID: string): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/linearizepdf', {
      assetID,
    });
    return result.location;
  }

  /**
   * Get PDF properties (page count, security, etc.)
   */
  async getProperties(assetID: string): Promise<string> {
    const result = await this.client.post<JobLocation>('/operation/pdfproperties', {
      assetID,
    });
    return result.location;
  }

  /**
   * Merge data into a document template
   */
  async documentMerge(params: DocumentMergeParams): Promise<string> {
    const body: Record<string, unknown> = {
      assetID: params.assetID,
      jsonDataForMerge: params.jsonDataForMerge,
    };
    if (params.outputFormat) body.outputFormat = params.outputFormat;
    const result = await this.client.post<JobLocation>('/operation/documentmerge', body);
    return result.location;
  }
}
