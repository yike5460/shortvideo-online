import { apiRequest } from './client';

export async function fetchVideos(queryParams: string): Promise<any> {
  return apiRequest(`/videos${queryParams}`);
}

export async function deleteVideo(indexId: string, videoId: string): Promise<void> {
  await apiRequest(`/videos?index=${indexId}&videoId=${videoId}`, {
    method: 'DELETE',
  });
}

export async function getVideoStatus(indexId: string, videoIds?: string): Promise<any> {
  let url = `/videos/status?index=${indexId}`;
  if (videoIds) {
    url += `&videoIds=${videoIds}`;
  }
  return apiRequest(url);
}

export async function getVideoSegmentation(videoId: string, indexId: string): Promise<any> {
  return apiRequest(`/videos/segmentation/${videoId}/${indexId}`);
}
