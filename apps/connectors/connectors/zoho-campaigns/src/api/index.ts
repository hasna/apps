import { ZohoCampaignsClient } from './client';
import type { ZohoCampaignsConfig } from '../types';

export { ZohoCampaignsClient, DC_BASES, buildQuery, resolveBaseUrl } from './client';

export class ZohoCampaigns {
  private readonly client: ZohoCampaignsClient;

  constructor(config: ZohoCampaignsConfig) {
    this.client = new ZohoCampaignsClient(config);
  }

  static fromEnv(): ZohoCampaigns {
    const token = process.env.ZOHOCAMPAIGNS_TOKEN;
    if (!token) throw new Error('ZOHOCAMPAIGNS_TOKEN is required');
    return new ZohoCampaigns({
      token,
      dataCenter: process.env.ZOHOCAMPAIGNS_DATA_CENTER,
      baseUrl: process.env.ZOHOCAMPAIGNS_BASE_URL,
    });
  }

  getClient(): ZohoCampaignsClient {
    return this.client;
  }

  // Mailing lists
  async listMailingLists(options: { sort?: 'asc' | 'desc'; fromIndex?: number; range?: number } = {}) {
    return this.client.get('/getmailinglists', {
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
    });
  }

  async getMailingListDetails(listKey: string) {
    return this.client.get('/getmailinglistdetails', { listkey: listKey });
  }

  async createMailingList(options: {
    listName: string;
    signupForm?: 'public' | 'private';
    mode?: string;
  }) {
    return this.client.post('/addlist', {
      query: {
        listname: options.listName,
        signupform: options.signupForm,
        mode: options.mode,
      },
    });
  }

  async updateMailingList(options: { listKey: string; listName?: string; description?: string }) {
    return this.client.post('/updatelist', {
      query: {
        listkey: options.listKey,
        listname: options.listName,
        listdescription: options.description,
      },
    });
  }

  // Subscribers
  async listSubscribers(options: {
    listKey: string;
    status?: 'active' | 'recent' | 'unsub' | 'bounce';
    sort?: 'asc' | 'desc';
    fromIndex?: number;
    range?: number;
  }) {
    return this.client.get('/getlistsubscribers', {
      listkey: options.listKey,
      status: options.status,
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
    });
  }

  async addSubscribersBulk(options: { listKey: string; emailIds: string[]; sources?: string }) {
    return this.client.post('/addlistsubscribersinbulk', {
      query: {
        listkey: options.listKey,
        emailids: options.emailIds.join(','),
        sources: options.sources,
      },
    });
  }

  async addSubscribers(options: {
    listKey: string;
    contactInfo: Array<Record<string, unknown>>;
    sources?: string;
  }) {
    return this.client.post('/json/listsubscribe', {
      query: {
        listkey: options.listKey,
        sources: options.sources,
      },
      body: { contactinfo: options.contactInfo },
    });
  }

  async unsubscribeSubscriber(options: { listKey: string; contactInfo: Record<string, unknown> }) {
    return this.client.post('/listunsubscribe', {
      query: { listkey: options.listKey },
      body: { contactinfo: options.contactInfo },
    });
  }

  async removeSubscriber(options: { listKey: string; contactInfo: Record<string, unknown> }) {
    return this.client.post('/removelistsubscriber', {
      query: { listkey: options.listKey },
      body: { contactinfo: options.contactInfo },
    });
  }

  async getSubscriberDetails(options: { listKey: string; emailId: string }) {
    return this.client.get('/contact/getcontactdetails', {
      listkey: options.listKey,
      contactemail: options.emailId,
    });
  }

  async tagSubscriber(options: { emailId: string; tag: string }) {
    return this.client.post('/tag/associate', {
      query: {
        leademail: options.emailId,
        tagName: options.tag,
      },
    });
  }

  // Campaigns
  async listRecentCampaigns(options: {
    sort?: 'asc' | 'desc';
    fromIndex?: number;
    range?: number;
    status?: 'all' | 'drafts' | 'schedules' | 'active' | 'stopped' | 'recent';
  } = {}) {
    return this.client.get('/recentcampaigns', {
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
      status: options.status,
    });
  }

  async listAllCampaigns(options: {
    sort?: 'asc' | 'desc';
    fromIndex?: number;
    range?: number;
    status?: string;
  } = {}) {
    return this.client.get('/allcampaigns', {
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
      status: options.status,
    });
  }

  async searchCampaigns(options: {
    searchKey: string;
    sort?: 'asc' | 'desc';
    fromIndex?: number;
    range?: number;
  }) {
    return this.client.get('/searchcampaigns', {
      searchkey: options.searchKey,
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
    });
  }

  async getCampaignDetails(campaignKey: string) {
    return this.client.get('/getcampaigndetails', { campaignkey: campaignKey });
  }

  async createCampaign(options: {
    campaignName: string;
    fromEmail: string;
    subject: string;
    contentUrl?: string;
    htmlContent?: string;
    listKey?: string;
    topicId?: string;
    replyTo?: string;
  }) {
    return this.client.post('/createCampaign', {
      query: {
        campaignname: options.campaignName,
        from_email: options.fromEmail,
        subject: options.subject,
        content_url: options.contentUrl,
        html_content: options.htmlContent,
        list_details: options.listKey,
        topicId: options.topicId,
        replyto: options.replyTo,
      },
    });
  }

  async cloneCampaign(options: { campaignKey: string; campaignName?: string }) {
    return this.client.post('/clonecampaign', {
      query: {
        campaignkey: options.campaignKey,
        campaignname: options.campaignName,
      },
    });
  }

  async sendCampaign(campaignKey: string) {
    return this.client.post('/sendcampaign', { query: { campaignkey: campaignKey } });
  }

  async sendCampaignTestMail(options: { campaignKey: string; emailIds: string[] }) {
    return this.client.post('/sendmailertestmail', {
      query: {
        campaignkey: options.campaignKey,
        emailids: options.emailIds.join(','),
      },
    });
  }

  async stopCampaign(campaignKey: string) {
    return this.client.post('/stopcampaign', { query: { campaignkey: campaignKey } });
  }

  async deleteCampaign(campaignKey: string) {
    return this.client.post('/deletecampaign', { query: { campaignkey: campaignKey } });
  }

  // Reports
  async getCampaignReports(campaignKey: string) {
    return this.client.get('/getcampaignreports', { campaignkey: campaignKey });
  }

  async getCampaignSummary(campaignKey: string) {
    return this.client.get('/getcampaignrecentsummary', { campaignkey: campaignKey });
  }

  async getCampaignMembers(options: {
    campaignKey: string;
    type?: 'sent' | 'delivered' | 'opens' | 'clicks' | 'unopens' | 'bounce' | 'unsub';
    sort?: 'asc' | 'desc';
    fromIndex?: number;
    range?: number;
  }) {
    return this.client.get('/getcampaignmembers', {
      campaignkey: options.campaignKey,
      type: options.type,
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
    });
  }

  async getCampaignClickDetails(campaignKey: string) {
    return this.client.get('/campaignlinkclickdetails', { campaignkey: campaignKey });
  }

  // Topics, segments, fields
  async listTopics() {
    return this.client.get('/topics');
  }

  async listCustomFields() {
    return this.client.get('/contact/allcustomfields');
  }

  async listSegments(options: { sort?: 'asc' | 'desc'; fromIndex?: number; range?: number } = {}) {
    return this.client.get('/getallsegments', {
      sort: options.sort,
      fromindex: options.fromIndex,
      range: options.range,
    });
  }
}
