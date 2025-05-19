import React from 'react';
import styles from './TimelineDisplay.module.css';

interface TimelineDisplayProps {
  content: string;
}

// Function to detect if a message contains timeline content
export function isTimelineResponse(content: string): boolean {
  // Detect if content matches timeline format (contains timestamp patterns like [00:00 - 00:00])
  // and the standard intro phrase used in the timeline prompt
  return content.includes('can be broken down into main events and timestamps as follows') && 
         /\[\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\]/.test(content);
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

export default function TimelineDisplay({ content }: TimelineDisplayProps) {
  // Extract the introduction and event entries
  const introMatch = content.match(/(.+?)(?=•|\[)/);
  const intro = introMatch ? introMatch[0].trim() : '';
  
  // Extract all timeline entries - look for patterns like [00:00 - 00:00] Description
  const timelineRegex = /•?\s*\[(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\]\s*(.+?)(?=•?\s*\[|$)/g;
  
  const timelineEntries: { startTime: string; endTime: string; description: string }[] = [];
  let match;
  
  while ((match = timelineRegex.exec(content)) !== null) {
    timelineEntries.push({
      startTime: match[1],
      endTime: match[2],
      description: match[3].trim()
    });
  }
  
  // If regex didn't find properly formatted entries, try an alternative approach
  if (timelineEntries.length === 0) {
    // Handle bullet points without the bullet character
    const alternativeRegex = /\[(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\]\s*(.+?)(?=\[|$)/g;
    
    while ((match = alternativeRegex.exec(content)) !== null) {
      timelineEntries.push({
        startTime: match[1],
        endTime: match[2],
        description: match[3].trim()
      });
    }
  }

  return (
    <div className={styles.timelineContainer}>
      {intro && <p className={styles.timelineIntro}>{intro}</p>}
      
      <ul className={styles.timelineList}>
        {timelineEntries.map((entry, index) => (
          <li key={index} className={styles.timelineItem}>
            <span className={styles.timelineTimestamp}>
              [{entry.startTime} - {entry.endTime}]
            </span>
            <span className={styles.timelineDescription}>
              {entry.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}