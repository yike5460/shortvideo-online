// Re-export everything from the centralized API module
export {
  createAutoCreateJob,
  getJobStatus,
  getJobHistory,
  cancelJob,
  subscribeToJobUpdates,
} from '@/lib/api/auto-create';
