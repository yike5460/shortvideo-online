import { NovaClient } from '../utils/nova-client';
import path from 'path';

async function main() {
  try {
    // Path to your local video file
    const videoPath = path.resolve(__dirname, '../../media/sample-video.mp4');
    
    // Create a new Nova client
    // Use Nova Pro or Premier for better bounding box detection
    const novaClient = new NovaClient('amazon.nova-pro-v1:0');
    
    // Define system messages for the model
    const systemMessages = [
      {
        text: 'You are an expert in computer vision and object detection. When given a video, detect objects with their bounding box coordinates and track their movement.',
      },
    ];
    
    // Define the object category to detect
    const objectCategory = 'person'; // Change to detect other objects like 'car', 'dog', 'chair', etc.
    
    // Define the prompt using the bounding box template from the AWS documentation
    const prompt = `Detect bounding box of objects in the video, only detect ${objectCategory} category objects with high confidence, output in a list of bounding box format.
Output example:
[
    {"${objectCategory}": [x1, y1, x2, y2]},
    ...
]

Result:`;
    
    // Process the video with recommended inference parameters for object detection
    const inferenceConfig = {
      maxTokens: 1000,
      temperature: 0, // Keeping temperature=0 for more precise detection
      topP: 0.1,
      topK: 1, // Keeping topK=1 for more precise detection
    };
    
    console.log(`Detecting ${objectCategory}s in video with bounding boxes...`);
    const response = await novaClient.processLocalVideo(
      videoPath,
      prompt,
      systemMessages,
      inferenceConfig
    );
    
    // Extract and print the text response
    const textResponse = novaClient.extractTextFromResponse(response);
    console.log('\nDetection Results:');
    console.log(textResponse);
    
    // Parse and process the bounding boxes if the response is in the expected format
    try {
      // Try to extract and parse JSON from the response
      const jsonMatch = textResponse.match(/\[\s*\{.*\}\s*\]/s);
      if (jsonMatch) {
        const boundingBoxes = JSON.parse(jsonMatch[0]);
        console.log('\nProcessed Bounding Boxes:');
        
        // Post-process the bounding boxes (scale from [0, 1000) to actual image dimensions)
        // In a real application, you would use the actual video dimensions
        const videoWidth = 1280; // Example width
        const videoHeight = 720; // Example height
        
        const scaledBoxes = boundingBoxes.map((box: any) => {
          const category = Object.keys(box)[0];
          const [x1, y1, x2, y2] = box[category];
          
          return {
            [category]: [
              Math.round(x1 * videoWidth / 1000),
              Math.round(y1 * videoHeight / 1000),
              Math.round(x2 * videoWidth / 1000),
              Math.round(y2 * videoHeight / 1000)
            ]
          };
        });
        
        console.log('Scaled to video dimensions:');
        console.log(JSON.stringify(scaledBoxes, null, 2));
      } else {
        console.log('No valid bounding box data found in the response.');
      }
    } catch (error) {
      console.error('Error processing bounding boxes:', error);
      console.log('Raw response might not contain valid bounding box data.');
    }
    
    // Print usage information
    console.log('\nToken Usage:');
    console.log(`Input Tokens: ${response.usage.inputTokens}`);
    console.log(`Output Tokens: ${response.usage.outputTokens}`);
    console.log(`Total Tokens: ${response.usage.totalTokens}`);
  } catch (error) {
    console.error('Error in bounding box detection example:', error);
  }
}

// Run the example
main(); 