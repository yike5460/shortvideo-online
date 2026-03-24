import { apiRequest } from './client';

export async function fetchConnectors(): Promise<any[]> {
  return apiRequest('/connectors/s3');
}

export async function createConnector(data: { name: string; roleArn: string }): Promise<any> {
  return apiRequest('/connectors/s3', {
    method: 'POST',
    body: data,
  });
}

export async function fetchBuckets(connectorId: string): Promise<any> {
  return apiRequest(`/connectors/s3/${connectorId}/buckets`);
}

export async function fetchFiles(connectorId: string, bucket: string, params: string): Promise<any> {
  return apiRequest(`/connectors/s3/${connectorId}/buckets/${bucket}?${params}`);
}

export async function importS3Files(data: {
  connectorId: string;
  files: { bucket: string; key: string }[];
  indexId: string;
}): Promise<any> {
  return apiRequest('/videos/import/s3', {
    method: 'POST',
    body: data,
  });
}
