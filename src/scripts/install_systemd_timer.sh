#!/bin/bash

# Script to install the systemd timer for performance checks

# Copy service and timer files to systemd directory
sudo cp /home/ec2-user/shortvideo-online/src/scripts/performance-check.service /etc/systemd/system/
sudo cp /home/ec2-user/shortvideo-online/src/scripts/performance-check.timer /etc/systemd/system/

# Reload systemd to recognize new files
sudo systemctl daemon-reload

# Enable and start the timer
sudo systemctl enable performance-check.timer
sudo systemctl start performance-check.timer

# Check status
echo "Timer status:"
sudo systemctl status performance-check.timer

# List all timers to confirm
echo -e "\nAll timers:"
sudo systemctl list-timers --all