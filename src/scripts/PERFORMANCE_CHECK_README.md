# Performance Check Automation

This directory contains scripts to automate the performance checks for the vem-service-v7 Docker container.

## Configuration

The performance check is configured to run every 2 hours using systemd timer.

### Systemd Timer (Installed)

The systemd timer has been installed and is currently active. The performance check will run every 2 hours automatically.

If you need to reinstall or modify the timer, you can use:
```
sudo ./install_systemd_timer.sh
```

This will:
- Install a systemd service and timer
- Enable and start the timer to run every 2 hours
- Show the status of the timer

### Checking Timer Status

To check if the timer is running properly:
```
sudo systemctl status performance-check.timer
```

To see when the next check will run:
```
sudo systemctl list-timers | grep performance
```

## Log Files

All methods will create log files in:
```
/home/ec2-user/shortvideo-online/logs/
```

## Manual Execution

To run the performance check script manually:

```
./run_performance_check.sh
```