"""
Monitoring and alerting module for Strands Agent
Tracks performance metrics, errors, and conversation health
"""

import time
import logging
import json
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from functools import wraps
from collections import defaultdict, deque

logger = logging.getLogger(__name__)

class AgentMonitor:
    """Monitor agent performance and detect issues"""
    
    def __init__(self):
        self.metrics = defaultdict(int)
        self.error_history = deque(maxlen=100)  # Keep last 100 errors
        self.conversation_issues = deque(maxlen=50)  # Track conversation problems
        self.api_response_times = defaultdict(list)
        self.job_processing_times = []
        self.bedrock_errors = defaultdict(int)
        
    def track_job_processing(self, func):
        """Decorator to track job processing performance"""
        @wraps(func)
        async def wrapper(*args, **kwargs):
            start_time = time.time()
            job_id = kwargs.get('job_message', {}).get('jobId', 'unknown') if kwargs else 'unknown'
            
            try:
                result = await func(*args, **kwargs)
                
                # Track successful processing
                processing_time = time.time() - start_time
                self.job_processing_times.append(processing_time)
                self.metrics['jobs_completed'] += 1
                
                logger.info(f"Job {job_id} completed in {processing_time:.2f}s")
                
                return result
                
            except Exception as e:
                # Track errors
                processing_time = time.time() - start_time
                error_info = {
                    'job_id': job_id,
                    'error': str(e),
                    'error_type': type(e).__name__,
                    'processing_time': processing_time,
                    'timestamp': datetime.now().isoformat()
                }
                
                self.error_history.append(error_info)
                self.metrics['jobs_failed'] += 1
                
                # Track specific Bedrock errors
                if 'ValidationException' in str(e):
                    self.bedrock_errors['validation_exception'] += 1
                    self.conversation_issues.append({
                        'job_id': job_id,
                        'issue': 'validation_exception',
                        'timestamp': datetime.now().isoformat()
                    })
                elif 'ThrottlingException' in str(e):
                    self.bedrock_errors['throttling_exception'] += 1
                elif 'ServiceException' in str(e):
                    self.bedrock_errors['service_exception'] += 1
                
                logger.error(f"Job {job_id} failed after {processing_time:.2f}s: {str(e)}")
                raise
                
        return wrapper
    
    def track_api_call(self, api_name: str):
        """Decorator to track API call performance"""
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                start_time = time.time()
                
                try:
                    result = func(*args, **kwargs)
                    
                    # Track successful API call
                    response_time = time.time() - start_time
                    self.api_response_times[api_name].append(response_time)
                    self.metrics[f'{api_name}_success'] += 1
                    
                    return result
                    
                except Exception as e:
                    # Track API errors
                    response_time = time.time() - start_time
                    self.metrics[f'{api_name}_error'] += 1
                    
                    error_info = {
                        'api': api_name,
                        'error': str(e),
                        'response_time': response_time,
                        'timestamp': datetime.now().isoformat()
                    }
                    self.error_history.append(error_info)
                    
                    logger.error(f"API {api_name} failed after {response_time:.2f}s: {str(e)}")
                    raise
                    
            return wrapper
        return decorator
    
    def track_conversation_issue(self, agent, issue_type: str, job_id: str = None):
        """Track conversation-related issues"""
        try:
            conversation_length = 0
            if hasattr(agent, 'conversation') and agent.conversation:
                conversation_length = len(agent.conversation.messages)
            
            issue_info = {
                'job_id': job_id or 'unknown',
                'issue_type': issue_type,
                'conversation_length': conversation_length,
                'timestamp': datetime.now().isoformat()
            }
            
            self.conversation_issues.append(issue_info)
            self.metrics[f'conversation_{issue_type}'] += 1
            
            logger.warning(f"Conversation issue detected: {issue_type} (length: {conversation_length})")
            
        except Exception as e:
            logger.error(f"Failed to track conversation issue: {str(e)}")
    
    def get_health_metrics(self) -> Dict[str, Any]:
        """Get current health metrics"""
        now = datetime.now()
        
        # Calculate average processing times
        avg_job_time = 0
        if self.job_processing_times:
            avg_job_time = sum(self.job_processing_times[-10:]) / min(len(self.job_processing_times), 10)
        
        # Calculate error rates
        total_jobs = self.metrics['jobs_completed'] + self.metrics['jobs_failed']
        error_rate = (self.metrics['jobs_failed'] / total_jobs * 100) if total_jobs > 0 else 0
        
        # Recent errors (last 10 minutes)
        recent_errors = [
            err for err in self.error_history 
            if datetime.fromisoformat(err['timestamp']) > now - timedelta(minutes=10)
        ]
        
        # Conversation issues (last hour)
        recent_conversation_issues = [
            issue for issue in self.conversation_issues
            if datetime.fromisoformat(issue['timestamp']) > now - timedelta(hours=1)
        ]
        
        return {
            'timestamp': now.isoformat(),
            'job_metrics': {
                'total_completed': self.metrics['jobs_completed'],
                'total_failed': self.metrics['jobs_failed'],
                'error_rate_percent': round(error_rate, 2),
                'avg_processing_time_seconds': round(avg_job_time, 2)
            },
            'api_metrics': {
                'video_search_success': self.metrics['video_search_success'],
                'video_search_error': self.metrics['video_search_error'],
                'video_merge_success': self.metrics['video_merge_success'],
                'video_merge_error': self.metrics['video_merge_error']
            },
            'bedrock_errors': dict(self.bedrock_errors),
            'recent_errors_count': len(recent_errors),
            'conversation_issues_last_hour': len(recent_conversation_issues),
            'alerts': self.generate_alerts()
        }
    
    def generate_alerts(self) -> list:
        """Generate alerts based on current metrics"""
        alerts = []
        
        # High error rate alert
        total_jobs = self.metrics['jobs_completed'] + self.metrics['jobs_failed']
        if total_jobs > 5:  # Only alert if we have enough data
            error_rate = (self.metrics['jobs_failed'] / total_jobs * 100)
            if error_rate > 20:  # More than 20% error rate
                alerts.append({
                    'level': 'critical',
                    'message': f'High error rate: {error_rate:.1f}%',
                    'recommendation': 'Check logs for recurring errors and consider scaling down traffic'
                })
        
        # Bedrock validation errors alert
        if self.bedrock_errors['validation_exception'] > 3:
            alerts.append({
                'level': 'critical',
                'message': f'Multiple Bedrock validation exceptions: {self.bedrock_errors["validation_exception"]}',
                'recommendation': 'Conversation corruption detected - implement conversation reset'
            })
        
        # Throttling alert
        if self.bedrock_errors['throttling_exception'] > 2:
            alerts.append({
                'level': 'warning',
                'message': f'Bedrock throttling detected: {self.bedrock_errors["throttling_exception"]} times',
                'recommendation': 'Implement exponential backoff and reduce request rate'
            })
        
        # Long processing times alert
        if self.job_processing_times:
            recent_avg = sum(self.job_processing_times[-5:]) / min(len(self.job_processing_times), 5)
            if recent_avg > 120:  # More than 2 minutes average
                alerts.append({
                    'level': 'warning',
                    'message': f'Slow processing detected: {recent_avg:.1f}s average',
                    'recommendation': 'Check API endpoint performance and enable fast mode'
                })
        
        return alerts
    
    def reset_metrics(self):
        """Reset metrics (useful for periodic cleanup)"""
        self.metrics.clear()
        self.error_history.clear()
        self.conversation_issues.clear()
        self.api_response_times.clear()
        self.job_processing_times.clear()
        self.bedrock_errors.clear()
        logger.info("Agent monitoring metrics reset")

# Global monitor instance
monitor = AgentMonitor() 