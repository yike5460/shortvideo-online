import { apiRequest } from './client';

export async function searchText(body: any): Promise<any> {
  return apiRequest('/search', {
    method: 'POST',
    body,
  });
}

export async function searchMedia(endpoint: 'image' | 'audio' | 'video', formData: FormData): Promise<any> {
  return apiRequest(`/search/${endpoint}`, {
    method: 'POST',
    body: formData,
    rawBody: true,
  });
}
