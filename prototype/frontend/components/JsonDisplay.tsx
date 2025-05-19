import React from 'react';

interface JsonDisplayProps {
  content: string;
}

// Function to detect if a message contains JSON
export function isJsonResponse(content: string): boolean {
  try {
    // Try to find a JSON object in the content
    const jsonRegex = /\{[\s\S]*\}/g;
    const match = content.match(jsonRegex);
    
    if (!match) return false;
    
    // Try to parse the matched content as JSON
    const jsonContent = match[0];
    JSON.parse(jsonContent);
    
    // If we get here, it's valid JSON
    return true;
  } catch (error) {
    return false;
  }
}

// Function to extract JSON from content
function extractJson(content: string): any {
  try {
    const jsonRegex = /\{[\s\S]*\}/g;
    const match = content.match(jsonRegex);
    
    if (!match) return null;
    
    return JSON.parse(match[0]);
  } catch (error) {
    console.error('Error extracting JSON:', error);
    return null;
  }
}

const JsonDisplay: React.FC<JsonDisplayProps> = ({ content }) => {
  const jsonData = extractJson(content);
  
  if (!jsonData) {
    return <div className="text-red-500">Invalid JSON format</div>;
  }
  
  // For category display (based on the screenshot)
  if (jsonData.category) {
    return (
      <div className="json-display">
        <div className="json-content">
          <div className="flex items-start">
            <span className="text-gray-500 mr-2">&#123;</span>
          </div>
          <div className="ml-4 flex items-center">
            <span className="text-purple-600 mr-2">"category"</span>
            <span className="text-gray-500 mr-2">:</span>
            <span className="text-green-600">"{jsonData.category}"</span>
          </div>
          <div>
            <span className="text-gray-500">&#125;</span>
          </div>
        </div>
        <div className="mt-4 text-gray-500 text-sm">
          {jsonData.tokens ? `${jsonData.tokens} tokens used` : ''}
        </div>
      </div>
    );
  }
  
  // For other JSON formats
  return (
    <div className="json-display">
      <pre className="bg-gray-50 p-4 rounded-md overflow-auto">
        <code>{JSON.stringify(jsonData, null, 2)}</code>
      </pre>
    </div>
  );
};

export default JsonDisplay;