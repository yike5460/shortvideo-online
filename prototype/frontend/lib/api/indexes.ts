import { apiRequest } from './client';
import { Index } from '@/types';

export async function fetchIndexes(): Promise<Index[]> {
  const data = await apiRequest<any>('/indexes');
  if (Array.isArray(data)) {
    return data.map((idx: any) => ({
      id: idx.indexId || idx.id,
      name: idx.indexName || idx.name || idx.indexId || idx.id,
      description: idx.description || '',
      videoCount: idx.videoCount || 0,
      createdAt: idx.createdAt || idx.created_at,
    }));
  }
  return [];
}

export async function deleteIndex(indexId: string): Promise<void> {
  await apiRequest(`/indexes/${indexId}`, { method: 'DELETE' });
}
