#!/bin/bash

# Script to run performance benchmark and check if vem-service-v7 is available
# Created for cron job to run every 2 hours

# Set up logging
LOG_DIR="/home/ec2-user/shortvideo-online/logs"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
LOG_FILE="${LOG_DIR}/performance_check_${TIMESTAMP}.log"

# Create logs directory if it doesn't exist
mkdir -p $LOG_DIR

# Function to check if Docker container is running
check_docker_service() {
    if docker ps | grep -q "vem-service-v7"; then
        echo "[$(date)] vem-service-v7 is running." | tee -a $LOG_FILE
        return 0
    else
        echo "[$(date)] ERROR: vem-service-v7 is not running!" | tee -a $LOG_FILE
        return 1
    fi
}

# Function to restart Docker service if needed
restart_docker_service() {
    echo "[$(date)] Attempting to restart vem-service-v7..." | tee -a $LOG_FILE
    
    # Add your docker restart command here
    # For example: docker restart vem-service-v7
    docker restart vem-service-v7
    
    sleep 10  # Wait for service to start
    
    # Check if restart was successful
    if docker ps | grep -q "vem-service-v7"; then
        echo "[$(date)] Successfully restarted vem-service-v7." | tee -a $LOG_FILE
        return 0
    else
        echo "[$(date)] CRITICAL: Failed to restart vem-service-v7!" | tee -a $LOG_FILE
        return 1
    fi
}

# Run performance benchmark
echo "[$(date)] Starting performance benchmark..." | tee -a $LOG_FILE

# Change to script directory
cd /home/ec2-user/shortvideo-online/src/scripts/

# Save output to a temporary log file
python performance_benchmark.py 2>&1 | tee -a $LOG_FILE

# Check exit status of performance script
if [ $? -eq 0 ]; then
    echo "[$(date)] Performance benchmark completed successfully." | tee -a $LOG_FILE
else
    echo "[$(date)] Performance benchmark failed." | tee -a $LOG_FILE
    
    # Check if service is running
    if ! check_docker_service; then
        # Try to restart the service
        restart_docker_service
    fi
fi

# Check service status regardless of benchmark result
check_docker_service

# Store only the last 10 log files to avoid filling up disk space
cd $LOG_DIR
ls -1t performance_check_*.log | tail -n +11 | xargs -r rm

echo "[$(date)] Check completed." | tee -a $LOG_FILE