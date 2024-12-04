import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  GetObjectCommandOutput
} from '@aws-sdk/client-s3';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message
} from '@aws-sdk/client-sqs';
import {
  RekognitionClient,
  DetectLabelsCommand,
  Label
} from '@aws-sdk/client-rekognition';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  TranscriptionJob
} from '@aws-sdk/client-transcribe';

// Environment variables interface
interface EnvConfig {
  RAW_VIDEOS_BUCKET: string;
  PROCESSED_VIDEOS_BUCKET: string;
  PROCESSING_QUEUE_URL: string;
}

// Video processing result interface
interface ProcessingResult {
  videoId: string;
  labels: Label[];
  transcriptionJobName?: string;
  timestamp: string;
}

// Initialize AWS clients
const s3Client = new S3Client({});
const sqsClient = new SQSClient({});
const rekognitionClient = new RekognitionClient({});
const transcribeClient = new TranscribeClient({});

// Validate environment variables
const getEnvConfig = (): EnvConfig => {
  const requiredEnvVars = [
    'RAW_VIDEOS_BUCKET',
    'PROCESSED_VIDEOS_BUCKET',
    'PROCESSING_QUEUE_URL'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  return {
    RAW_VIDEOS_BUCKET: process.env.RAW_VIDEOS_BUCKET!,
    PROCESSED_VIDEOS_BUCKET: process.env.PROCESSED_VIDEOS_BUCKET!,
    PROCESSING_QUEUE_URL: process.env.PROCESSING_QUEUE_URL!
  };
};

// Receive message from SQS
async function receiveMessage(): Promise<Message | null> {
  const command = new ReceiveMessageCommand({
    QueueUrl: getEnvConfig().PROCESSING_QUEUE_URL,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 20
  });

  const response = await sqsClient.send(command);
  return response.Messages?.[0] || null;
}

// Delete message from SQS
async function deleteMessage(receiptHandle: string): Promise<void> {
  const command = new DeleteMessageCommand({
    QueueUrl: getEnvConfig().PROCESSING_QUEUE_URL,
    ReceiptHandle: receiptHandle
  });

  await sqsClient.send(command);
}

// Process video using Rekognition
async function detectLabels(videoId: string): Promise<Label[]> {
  const command = new DetectLabelsCommand({
    Video: {
      S3Object: {
        Bucket: getEnvConfig().RAW_VIDEOS_BUCKET,
        Name: videoId
      }
    },
    MinConfidence: 70
  });

  const response = await rekognitionClient.send(command);
  return response.Labels || [];
}

// Start transcription job
async function startTranscription(videoId: string): Promise<string> {
  const jobName = `${videoId}-${Date.now()}`;
  const command = new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    Media: {
      MediaFileUri: `s3://${getEnvConfig().RAW_VIDEOS_BUCKET}/${videoId}`
    },
    LanguageCode: 'en-US'
  });

  await transcribeClient.send(command);
  return jobName;
}

// Save processing results
async function saveResults(result: ProcessingResult): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: getEnvConfig().PROCESSED_VIDEOS_BUCKET,
    Key: `results/${result.videoId}.json`,
    Body: JSON.stringify(result),
    ContentType: 'application/json'
  });

  await s3Client.send(command);
}

// Main video processing function
async function processVideo(): Promise<void> {
  console.log('Starting video processing...');
  
  const message = await receiveMessage();
  if (!message || !message.Body) {
    return;
  }

  try {
    const videoId = JSON.parse(message.Body).videoId;
    console.log(`Processing video: ${videoId}`);

    // Detect labels using Rekognition
    const labels = await detectLabels(videoId);
    console.log(`Detected ${labels.length} labels`);

    // Start transcription job
    const transcriptionJobName = await startTranscription(videoId);
    console.log(`Started transcription job: ${transcriptionJobName}`);

    // Save processing results
    const result: ProcessingResult = {
      videoId,
      labels,
      transcriptionJobName,
      timestamp: new Date().toISOString()
    };
    await saveResults(result);

    // Delete message from queue
    await deleteMessage(message.ReceiptHandle!);
    console.log('Video processing completed successfully');
  } catch (error) {
    console.error('Error processing video:', error);
    throw error;
  }
}

// Main loop
async function main(): Promise<never> {
  while (true) {
    try {
      await processVideo();
      // Add delay to prevent tight loop
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Error in main loop:', error);
      // Add delay before retry
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// Start the application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 