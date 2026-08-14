import { SpongeClient, compact } from './client';
import type {
  StoreCreditCardParams,
  LinkPaymentMethodParams,
  LinkPaymentCredentialParams,
  GetCardParams,
  IssueVirtualCardParams,
  ReportCardUsageParams,
  SpongeCardOnboardParams,
  SpongeCardTermsParams,
  CreateSpongeCardParams,
  SpongeCardAmountParams,
} from '../types';

/**
 * Cards API — stored credit cards, Link payment methods, single-use/virtual
 * cards, usage reporting, and the Sponge Card lifecycle.
 */
export class CardsApi {
  constructor(private readonly client: SpongeClient) {}

  // Stored credit cards

  storeCreditCard(params: StoreCreditCardParams): Promise<unknown> {
    return this.client.post('/api/credit-cards', compact({ ...params }));
  }

  listCreditCards(options: { agentId?: string } = {}): Promise<unknown> {
    return this.client.get('/api/credit-cards', { agentId: options.agentId });
  }

  // Link payment methods (per agent)

  linkPaymentMethod(agentId: string, params: LinkPaymentMethodParams): Promise<unknown> {
    return this.client.post(
      `/api/agents/${encodeURIComponent(agentId)}/link-payment-methods/link`,
      compact({ ...params }),
    );
  }

  linkPaymentCredential(agentId: string, params: LinkPaymentCredentialParams): Promise<unknown> {
    return this.client.post(
      `/api/agents/${encodeURIComponent(agentId)}/link-payment-methods/credential`,
      compact({ ...params }),
    );
  }

  // Card issuance / usage

  getCard(params: GetCardParams = {}): Promise<unknown> {
    return this.client.post('/api/cards', compact({ ...params }));
  }

  issueVirtualCard(params: IssueVirtualCardParams): Promise<unknown> {
    return this.client.post('/api/virtual-cards', compact({ ...params }));
  }

  reportCardUsage(params: ReportCardUsageParams): Promise<unknown> {
    return this.client.post('/api/card-usage', compact({ ...params }));
  }

  // Sponge Card lifecycle

  spongeCardStatus(options: { agentId?: string; refresh?: boolean } = {}): Promise<unknown> {
    return this.client.get('/api/sponge-card/status', {
      agentId: options.agentId,
      refresh: options.refresh,
    });
  }

  spongeCardOnboard(params: SpongeCardOnboardParams = {}): Promise<unknown> {
    return this.client.post('/api/sponge-card/onboard', compact({ ...params }));
  }

  spongeCardTerms(params: SpongeCardTermsParams): Promise<unknown> {
    return this.client.post('/api/sponge-card/terms', compact({ ...params }));
  }

  spongeCardCreate(params: CreateSpongeCardParams): Promise<unknown> {
    return this.client.post('/api/sponge-card/create-card', compact({ ...params }));
  }

  spongeCardDetails(options: { agentId?: string } = {}): Promise<unknown> {
    return this.client.get('/api/sponge-card/details', { agentId: options.agentId });
  }

  spongeCardFund(params: SpongeCardAmountParams): Promise<unknown> {
    return this.client.post('/api/sponge-card/fund', compact({ ...params }));
  }

  spongeCardWithdraw(params: SpongeCardAmountParams): Promise<unknown> {
    return this.client.post('/api/sponge-card/withdraw', compact({ ...params }));
  }
}
