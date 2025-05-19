import React from 'react';

interface HashtagsAndTopicsProps {
  content: string;
}

// Function to detect if content is a hashtags response
export function isHashtagsResponse(content: string): boolean {
  return content.includes('## Hashtags') && content.includes('## Topics');
}

// Function to parse hashtags and topics
function parseHashtagsAndTopics(content: string): { hashtags: string[], topics: string } {
  const hashtags: string[] = [];
  let topics = '';
  
  // Extract hashtags section
  const hashtagsMatch = content.match(/## Hashtags\s*\n([\s\S]*?)(?=##|$)/);
  if (hashtagsMatch && hashtagsMatch[1]) {
    // Extract all hashtags (words starting with #)
    const hashtagMatches = hashtagsMatch[1].match(/#\w+/g);
    if (hashtagMatches) {
      hashtags.push(...hashtagMatches);
    }
  }
  
  // Extract topics section
  const topicsMatch = content.match(/## Topics\s*\n([\s\S]*?)(?=##|$)/);
  if (topicsMatch && topicsMatch[1]) {
    topics = topicsMatch[1].trim();
  }
  
  return { hashtags, topics };
}

const HashtagsAndTopics: React.FC<HashtagsAndTopicsProps> = ({ content }) => {
  const [parsedContent, setParsedContent] = React.useState<{ hashtags: string[], topics: string }>({ hashtags: [], topics: '' });
  
  React.useEffect(() => {
    if (content) {
      try {
        const parsed = parseHashtagsAndTopics(content);
        setParsedContent(parsed);
      } catch (error) {
        console.error("Error parsing hashtags and topics:", error);
      }
    }
  }, [content]);
  
  // If no hashtags or topics were parsed, return the original content
  if (parsedContent.hashtags.length === 0 && !parsedContent.topics) {
    return <div className="original-content">{content}</div>;
  }
  
  return (
    <div className="hashtags-and-topics">
      {parsedContent.hashtags.length > 0 && (
        <div className="hashtags-section">
          <h3 className="section-title">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 inline-block mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
            <span>Hashtags</span>
          </h3>
          <div className="hashtags-container">
            {parsedContent.hashtags.map((hashtag, index) => (
              <span key={index} className="hashtag-pill">
                {hashtag}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {parsedContent.topics && (
        <div className="topics-section">
          <h3 className="section-title">Topics</h3>
          <p className="topics-content">{parsedContent.topics}</p>
        </div>
      )}
    </div>
  );
};

export default HashtagsAndTopics;