export interface KafkaConfig { url: string; username?: string; password?: string; clusterId?: string; }

export interface KafkaTopic { topic_name: string; is_internal: boolean; replication_factor: number; partitions_count: number; configs: Record<string, string>; }
export interface KafkaTopicList { data: { topic_name: string; is_internal: boolean }[]; }
export interface KafkaPartition { partition_id: number; leader: { broker_id: number }; replicas: { broker_id: number }[]; }
export interface KafkaConsumerGroup { consumer_group_id: string; is_simple: boolean; state: string; }
export interface KafkaProduceResult { offsets: { partition: number; offset: number; error_code: number | null }[]; }
export interface KafkaMessage { topic: string; key: string | null; value: unknown; partition: number; offset: number; timestamp: string; }

export class KafkaApiError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) { super(message); this.name = 'KafkaApiError'; this.statusCode = statusCode; }
}
