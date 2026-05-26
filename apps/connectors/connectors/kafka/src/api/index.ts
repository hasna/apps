// Apache Kafka Connector — Distributed event streaming via REST Proxy
import { KafkaClient } from './client';
import type { KafkaConfig, KafkaTopic, KafkaTopicList, KafkaPartition, KafkaConsumerGroup, KafkaProduceResult } from '../types';
export { KafkaClient } from './client';

export class Kafka {
  private readonly client: KafkaClient;
  constructor(config: KafkaConfig) { this.client = new KafkaClient(config); }
  static fromEnv(): Kafka {
    const url = process.env.KAFKA_REST_URL;
    if (!url) throw new Error('KAFKA_REST_URL is required');
    return new Kafka({ url, username: process.env.KAFKA_USERNAME, password: process.env.KAFKA_PASSWORD, clusterId: process.env.KAFKA_CLUSTER_ID });
  }

  async listTopics(): Promise<KafkaTopicList> { return this.client.request<KafkaTopicList>(`/clusters/${this.client.getClusterId()}/topics`); }
  async getTopic(topicName: string): Promise<KafkaTopic> { return this.client.request<KafkaTopic>(`/clusters/${this.client.getClusterId()}/topics/${topicName}`); }
  async createTopic(name: string, options?: { partitions_count?: number; replication_factor?: number; configs?: { name: string; value: string }[] }): Promise<KafkaTopic> {
    return this.client.request<KafkaTopic>(`/clusters/${this.client.getClusterId()}/topics`, { method: 'POST', body: { topic_name: name, partitions_count: options?.partitions_count, replication_factor: options?.replication_factor, configs: options?.configs } as Record<string, unknown> });
  }
  async deleteTopic(topicName: string): Promise<void> { await this.client.request(`/clusters/${this.client.getClusterId()}/topics/${topicName}`, { method: 'DELETE' }); }

  async listPartitions(topicName: string): Promise<{ data: KafkaPartition[] }> {
    return this.client.request(`/clusters/${this.client.getClusterId()}/topics/${topicName}/partitions`);
  }

  async produce(topicName: string, records: { key?: unknown; value: unknown; partition?: number }[]): Promise<KafkaProduceResult> {
    return this.client.request<KafkaProduceResult>(`/clusters/${this.client.getClusterId()}/topics/${topicName}/records`, { method: 'POST', body: { data: records } as Record<string, unknown> });
  }

  async listConsumerGroups(): Promise<{ data: KafkaConsumerGroup[] }> {
    return this.client.request(`/clusters/${this.client.getClusterId()}/consumer-groups`);
  }
  async getConsumerGroup(groupId: string): Promise<KafkaConsumerGroup> {
    return this.client.request<KafkaConsumerGroup>(`/clusters/${this.client.getClusterId()}/consumer-groups/${groupId}`);
  }

  getClient(): KafkaClient { return this.client; }
}
