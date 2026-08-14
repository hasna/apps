import type { WixClient } from './client';
import type {
  Product,
  CreateProductRequest,
  UpdateProductRequest,
  Stock,
  Price,
  PriceData,
  FormattedPrice,
  CostAndProfitData,
  ProductInfoSection,
  Ribbon,
  ProductMedia,
  MediaItem,
  ImageInfo,
  VideoInfo,
  CustomTextField,
  ProductOption,
  ProductOptionChoice,
  ProductPageUrl,
  Discount,
  ProductVariant,
  VariantData,
  WeightRange,
  PriceRange,
  CostRange,
} from '../types';

export interface ListProductsOptions {
  limit?: number;
  offset?: number;
  includeHiddenProducts?: boolean;
  includeVariants?: boolean;
}

export interface QueryProductsOptions extends ListProductsOptions {
  filter?: Record<string, unknown>;
  sort?: { fieldName: string; order?: 'ASC' | 'DESC' }[];
}

/**
 * Wix Stores Products API
 * Endpoint: /stores/v1/products
 */
export class ProductsApi {
  constructor(private readonly client: WixClient) {}

  /**
   * List products
   */
  async list(options: ListProductsOptions = {}): Promise<Product[]> {
    const response = await this.client.request<{ products: Record<string, unknown>[] }>(
      '/stores/v1/products/query',
      {
        method: 'POST',
        body: {
          query: {
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
          includeHiddenProducts: options.includeHiddenProducts,
          includeVariants: options.includeVariants,
        },
      }
    );

    return this.transformProducts(response.products || []);
  }

  /**
   * Query products with filters
   */
  async query(options: QueryProductsOptions = {}): Promise<Product[]> {
    const response = await this.client.request<{ products: Record<string, unknown>[] }>(
      '/stores/v1/products/query',
      {
        method: 'POST',
        body: {
          query: {
            filter: options.filter,
            sort: options.sort,
            paging: {
              limit: options.limit || 50,
              offset: options.offset || 0,
            },
          },
          includeHiddenProducts: options.includeHiddenProducts,
          includeVariants: options.includeVariants,
        },
      }
    );

    return this.transformProducts(response.products || []);
  }

  /**
   * Get a single product by ID
   */
  async get(productId: string, includeVariants?: boolean): Promise<Product> {
    const response = await this.client.request<{ product: Record<string, unknown> }>(
      `/stores/v1/products/${productId}`,
      {
        params: {
          includeVariants: includeVariants,
        },
      }
    );

    return this.transformProduct(response.product);
  }

  /**
   * Create a new product
   */
  async create(product: CreateProductRequest): Promise<Product> {
    const body = {
      product: {
        name: product.name,
        productType: product.productType || 'physical',
        description: product.description,
        sku: product.sku,
        visible: product.visible ?? true,
        priceData: product.price ? {
          price: product.price,
          currency: product.currency || 'USD',
        } : undefined,
        weight: product.weight,
        ribbons: product.ribbons?.map(r => ({ text: r })),
        brand: product.brand,
        manageVariants: product.manageVariants,
        stock: product.trackInventory !== undefined ? {
          trackInventory: product.trackInventory,
          quantity: product.quantity,
        } : undefined,
      },
    };

    const response = await this.client.request<{ product: Record<string, unknown> }>(
      '/stores/v1/products',
      { method: 'POST', body }
    );

    return this.transformProduct(response.product);
  }

  /**
   * Update a product
   */
  async update(productId: string, product: UpdateProductRequest): Promise<Product> {
    const body = {
      product: {
        name: product.name,
        description: product.description,
        sku: product.sku,
        visible: product.visible,
        priceData: product.price ? { price: product.price } : undefined,
        weight: product.weight,
        ribbons: product.ribbons?.map(r => ({ text: r })),
        brand: product.brand,
      },
    };

    const response = await this.client.request<{ product: Record<string, unknown> }>(
      `/stores/v1/products/${productId}`,
      { method: 'PATCH', body }
    );

    return this.transformProduct(response.product);
  }

  /**
   * Delete a product
   */
  async delete(productId: string): Promise<void> {
    await this.client.request<void>(
      `/stores/v1/products/${productId}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Get product count
   */
  async count(filter?: Record<string, unknown>): Promise<number> {
    const response = await this.client.request<{ products: Record<string, unknown>[]; totalResults?: number }>(
      '/stores/v1/products/query',
      {
        method: 'POST',
        body: {
          query: {
            filter,
            paging: { limit: 1, offset: 0 },
          },
        },
      }
    );

    return response.totalResults || response.products?.length || 0;
  }

  /**
   * Transform API response to our types
   */
  private transformProduct(product: Record<string, unknown>): Product {
    const stock = product.stock as Record<string, unknown> | undefined;
    const price = product.price as Record<string, unknown> | undefined;
    const priceData = product.priceData as Record<string, unknown> | undefined;
    const convertedPriceData = product.convertedPriceData as Record<string, unknown> | undefined;
    const priceRange = product.priceRange as Record<string, unknown> | undefined;
    const costAndProfitData = product.costAndProfitData as Record<string, unknown> | undefined;
    const costRange = product.costRange as Record<string, unknown> | undefined;
    const weightRange = product.weightRange as Record<string, unknown> | undefined;
    const media = product.media as Record<string, unknown> | undefined;
    const productPageUrl = product.productPageUrl as Record<string, unknown> | undefined;
    const discount = product.discount as Record<string, unknown> | undefined;

    return {
      id: product.id as string || product._id as string || '',
      name: product.name as string || '',
      slug: product.slug as string || '',
      visible: product.visible as boolean || false,
      productType: (product.productType as 'physical' | 'digital') || 'physical',
      description: product.description as string | undefined,
      sku: product.sku as string | undefined,
      weight: product.weight as number | undefined,
      weightRange: weightRange ? this.transformWeightRange(weightRange) : undefined,
      stock: stock ? this.transformStock(stock) : undefined,
      price: price ? this.transformPrice(price) : undefined,
      priceData: priceData ? this.transformPriceData(priceData) : undefined,
      convertedPriceData: convertedPriceData ? this.transformPriceData(convertedPriceData) : undefined,
      priceRange: priceRange ? this.transformPriceRange(priceRange) : undefined,
      costAndProfitData: costAndProfitData ? this.transformCostAndProfitData(costAndProfitData) : undefined,
      costRange: costRange ? this.transformCostRange(costRange) : undefined,
      additionalInfoSections: this.transformInfoSections(product.additionalInfoSections as Record<string, unknown>[] | undefined),
      ribbons: this.transformRibbons(product.ribbons as Record<string, unknown>[] | undefined),
      media: media ? this.transformMedia(media) : undefined,
      customTextFields: this.transformCustomTextFields(product.customTextFields as Record<string, unknown>[] | undefined),
      manageVariants: product.manageVariants as boolean | undefined,
      productOptions: this.transformProductOptions(product.productOptions as Record<string, unknown>[] | undefined),
      productPageUrl: productPageUrl ? this.transformProductPageUrl(productPageUrl) : undefined,
      numericId: product.numericId as string | undefined,
      inventoryItemId: product.inventoryItemId as string | undefined,
      discount: discount ? this.transformDiscount(discount) : undefined,
      collectionIds: product.collectionIds as string[] | undefined,
      variants: this.transformVariants(product.variants as Record<string, unknown>[] | undefined),
      lastUpdated: product.lastUpdated as string | undefined,
      createdDate: product.createdDate as string | product._createdDate as string | undefined,
      brand: product.brand as string | undefined,
    };
  }

  private transformProducts(products: Record<string, unknown>[]): Product[] {
    return products.map(p => this.transformProduct(p));
  }

  private transformStock(stock: Record<string, unknown>): Stock {
    return {
      trackInventory: stock.trackInventory as boolean | undefined,
      quantity: stock.quantity as number | undefined,
      inStock: stock.inStock as boolean | undefined,
      inventoryStatus: stock.inventoryStatus as Stock['inventoryStatus'] | undefined,
    };
  }

  private transformPrice(price: Record<string, unknown>): Price {
    return {
      amount: price.amount as string || '0',
      currency: price.currency as string || 'USD',
      formattedAmount: price.formattedAmount as string | undefined,
    };
  }

  private transformPriceData(priceData: Record<string, unknown>): PriceData {
    const formatted = priceData.formatted as Record<string, unknown> | undefined;
    return {
      currency: priceData.currency as string | undefined,
      price: priceData.price as number | undefined,
      discountedPrice: priceData.discountedPrice as number | undefined,
      formatted: formatted ? this.transformFormattedPrice(formatted) : undefined,
    };
  }

  private transformFormattedPrice(formatted: Record<string, unknown>): FormattedPrice {
    return {
      price: formatted.price as string | undefined,
      discountedPrice: formatted.discountedPrice as string | undefined,
      pricePerUnit: formatted.pricePerUnit as string | undefined,
    };
  }

  private transformWeightRange(range: Record<string, unknown>): WeightRange {
    return {
      minValue: range.minValue as number | undefined,
      maxValue: range.maxValue as number | undefined,
    };
  }

  private transformPriceRange(range: Record<string, unknown>): PriceRange {
    return {
      minValue: range.minValue as number | undefined,
      maxValue: range.maxValue as number | undefined,
    };
  }

  private transformCostRange(range: Record<string, unknown>): CostRange {
    return {
      minValue: range.minValue as number | undefined,
      maxValue: range.maxValue as number | undefined,
    };
  }

  private transformCostAndProfitData(data: Record<string, unknown>): CostAndProfitData {
    return {
      itemCost: data.itemCost as number | undefined,
      formattedItemCost: data.formattedItemCost as string | undefined,
      profit: data.profit as number | undefined,
      formattedProfit: data.formattedProfit as string | undefined,
      profitMargin: data.profitMargin as number | undefined,
    };
  }

  private transformInfoSections(sections?: Record<string, unknown>[]): ProductInfoSection[] | undefined {
    if (!sections) return undefined;
    return sections.map(s => ({
      title: s.title as string | undefined,
      description: s.description as string | undefined,
    }));
  }

  private transformRibbons(ribbons?: Record<string, unknown>[]): Ribbon[] | undefined {
    if (!ribbons) return undefined;
    return ribbons.map(r => ({
      text: r.text as string || '',
    }));
  }

  private transformMedia(media: Record<string, unknown>): ProductMedia {
    const mainMedia = media.mainMedia as Record<string, unknown> | undefined;
    const items = media.items as Record<string, unknown>[] | undefined;
    return {
      mainMedia: mainMedia ? this.transformMediaItem(mainMedia) : undefined,
      items: items?.map(i => this.transformMediaItem(i)),
    };
  }

  private transformMediaItem(item: Record<string, unknown>): MediaItem {
    const image = item.image as Record<string, unknown> | undefined;
    const video = item.video as Record<string, unknown> | undefined;
    const thumbnail = item.thumbnail as Record<string, unknown> | undefined;
    return {
      id: item.id as string | item._id as string | undefined,
      title: item.title as string | undefined,
      mediaType: item.mediaType as 'IMAGE' | 'VIDEO' | undefined,
      image: image ? this.transformImageInfo(image) : undefined,
      video: video ? this.transformVideoInfo(video) : undefined,
      thumbnail: thumbnail ? this.transformImageInfo(thumbnail) : undefined,
    };
  }

  private transformImageInfo(image: Record<string, unknown>): ImageInfo {
    return {
      url: image.url as string | undefined,
      width: image.width as number | undefined,
      height: image.height as number | undefined,
      format: image.format as string | undefined,
      altText: image.altText as string | undefined,
    };
  }

  private transformVideoInfo(video: Record<string, unknown>): VideoInfo {
    return {
      url: video.url as string | undefined,
    };
  }

  private transformCustomTextFields(fields?: Record<string, unknown>[]): CustomTextField[] | undefined {
    if (!fields) return undefined;
    return fields.map(f => ({
      title: f.title as string | undefined,
      maxLength: f.maxLength as number | undefined,
      mandatory: f.mandatory as boolean | undefined,
    }));
  }

  private transformProductOptions(options?: Record<string, unknown>[]): ProductOption[] | undefined {
    if (!options) return undefined;
    return options.map(o => ({
      id: o.id as string | undefined,
      name: o.name as string | undefined,
      optionType: o.optionType as ProductOption['optionType'] | undefined,
      choices: this.transformOptionChoices(o.choices as Record<string, unknown>[] | undefined),
    }));
  }

  private transformOptionChoices(choices?: Record<string, unknown>[]): ProductOptionChoice[] | undefined {
    if (!choices) return undefined;
    return choices.map(c => {
      const media = c.media as Record<string, unknown> | undefined;
      return {
        id: c.id as string | undefined,
        value: c.value as string | undefined,
        description: c.description as string | undefined,
        media: media ? this.transformMediaItem(media) : undefined,
        inStock: c.inStock as boolean | undefined,
        visible: c.visible as boolean | undefined,
      };
    });
  }

  private transformProductPageUrl(url: Record<string, unknown>): ProductPageUrl {
    return {
      base: url.base as string | undefined,
      path: url.path as string | undefined,
    };
  }

  private transformDiscount(discount: Record<string, unknown>): Discount {
    return {
      type: discount.type as Discount['type'] | undefined,
      value: discount.value as number | undefined,
    };
  }

  private transformVariants(variants?: Record<string, unknown>[]): ProductVariant[] | undefined {
    if (!variants) return undefined;
    return variants.map(v => {
      const variant = v.variant as Record<string, unknown> | undefined;
      const stock = v.stock as Record<string, unknown> | undefined;
      return {
        id: v.id as string | v._id as string | undefined,
        choices: v.choices as Record<string, string> | undefined,
        variant: variant ? this.transformVariantData(variant) : undefined,
        stock: stock ? this.transformStock(stock) : undefined,
      };
    });
  }

  private transformVariantData(variant: Record<string, unknown>): VariantData {
    const priceData = variant.priceData as Record<string, unknown> | undefined;
    const convertedPriceData = variant.convertedPriceData as Record<string, unknown> | undefined;
    const costAndProfitData = variant.costAndProfitData as Record<string, unknown> | undefined;
    return {
      priceData: priceData ? this.transformPriceData(priceData) : undefined,
      convertedPriceData: convertedPriceData ? this.transformPriceData(convertedPriceData) : undefined,
      costAndProfitData: costAndProfitData ? this.transformCostAndProfitData(costAndProfitData) : undefined,
      weight: variant.weight as number | undefined,
      sku: variant.sku as string | undefined,
      visible: variant.visible as boolean | undefined,
    };
  }
}
