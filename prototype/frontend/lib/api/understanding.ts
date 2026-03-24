import { apiRequest, getFullUrl } from './client';

export async function initAskSession(data: {
  videoId: string;
  indexId: string;
  question: string;
  model: string;
}): Promise<{ sessionId: string }> {
  return apiRequest('/videos/ask/init', {
    method: 'POST',
    body: data,
  });
}

export async function getAskStatus(sessionId: string): Promise<any> {
  return apiRequest(`/videos/ask/status/${sessionId}`);
}

export function getStreamUrl(sessionId: string): string {
  return getFullUrl(`/videos/ask/stream/${sessionId}`);
}
