import React from 'react';

interface TimelineDisplayProps {
  content: string;
}

// Function to detect if a message contains timeline content
export function isTimelineResponse(content: string): boolean {
  // Check if the content contains the word "timeline" and timestamps
  const hasTimeline = content.toLowerCase().includes('timeline');
  const hasTimestamps = (content.match(/\[\d{2}:\d{2}(?::\d{2})?\s*-\s*\d{2}:\d{2}(?::\d{2})?\]/gi)?.length ?? 0) >= 1;
  
  return hasTimeline && hasTimestamps;
}

// Function to parse timeline content
function parseTimelineItems(content: string): { timestamp: string; description: string }[] {
  const items: { timestamp: string; description: string }[] = [];
  
  // Regular expression to match timestamp and description
  const regex = /\[(\d{2}:\d{2}(?::\d{2})?)\s*-\s*(\d{2}:\d{2}(?::\d{2})?)\]\s*(.*?)(?=\[\d{2}:\d{2}|\s*$)/g;
  
  let match;
  while ((match = regex.exec(content)) !== null) {
    const startTime = match[1];
    const endTime = match[2];
    const description = match[3].trim();
    
    items.push({
      timestamp: `[${startTime} - ${endTime}]`,
      description
    });
  }
  
  return items;
}

const TimelineDisplay: React.FC<TimelineDisplayProps> = ({ content }) => {
  const timelineItems = parseTimelineItems(content);
  
  if (timelineItems.length === 0) {
    return <div className="message-text">{content}</div>;
  }
  
  return (
    <div className="timeline-display">
      <h3 className="timeline-title">The video can be broken down into main events and timestamps as follows:</h3>
      <ul className="timeline-list">
        {timelineItems.map((item, index) => (
          <li key={index} className="timeline-item">
            <span className="timeline-timestamp">
              <span className="timestamp-start">{item.timestamp.split(' - ')[0].replace('[', '')}</span>
              <span className="timestamp-separator">~</span>
              <span className="timestamp-end">{item.timestamp.split(' - ')[1].replace(']', '')}</span>
            </span>
            <span className="timeline-description">{item.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TimelineDisplay;