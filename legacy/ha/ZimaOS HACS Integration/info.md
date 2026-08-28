# ZimaOS Monitor Integration

[![Version](https://img.shields.io/badge/Version-2.0.0-blue.svg)](https://github.com/chicohaager/zimaos-hass-integration)
[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)

Monitor your ZimaOS NAS system directly from Home Assistant with enterprise-grade features!

## 🎯 Key Features

- **🔄 Auto-Reconnection** - Maintains persistent connection with automatic recovery
- **📊 30+ Sensors** - Comprehensive system monitoring
- **🏥 Health Score** - Intelligent A+ to F grading system
- **🐳 Docker Support** - Container and image monitoring
- **🌡️ Temperature Tracking** - CPU thermal monitoring
- **📈 Performance Metrics** - Load averages, I/O stats, network traffic
- **⚡ Real-time Updates** - 30-second refresh interval

## 📋 Monitored Metrics

### System Health
- Overall health score with letter grading
- CPU usage and temperature
- Memory usage and availability
- Disk usage (root and DATA partitions)
- System uptime

### Performance
- Load averages (1, 5, 15 minutes)
- Process count
- CPU cores
- Disk I/O read/write speeds
- Swap usage

### Network
- Total data received/transmitted
- Active network connections
- SSH connections
- Logged-in users

### Docker (if available)
- Running containers
- Total containers
- Docker images count

## 🔧 Requirements

- ZimaOS system with SSH access enabled
- SSH user credentials (username/password)
- Network connectivity between Home Assistant and ZimaOS
- Home Assistant 2023.1.0 or newer

## ⚡ Quick Setup

1. **Enable SSH on ZimaOS**
   - Access ZimaOS web interface
   - Go to Settings → System → SSH
   - Enable SSH service

2. **Install via HACS**
   - Add this repository as custom repository
   - Install "ZimaOS Monitor"
   - Restart Home Assistant

3. **Configure Integration**
   - Go to Settings → Integrations
   - Add "ZimaOS Monitor"
   - Enter your ZimaOS IP and SSH credentials

4. **Enjoy Monitoring**
   - View 30+ sensors in your dashboard
   - Create automations based on system health
   - Track performance over time

## 🎨 Dashboard Example

```yaml
type: gauge
entity: sensor.zimaos_health_score
name: ZimaOS Health
max: 100
severity:
  green: 80
  yellow: 60
  red: 0
```

## 🏥 Health Score Grading

| Score | Grade | Status |
|-------|-------|--------|
| 95-100 | A+ | Excellent |
| 90-94 | A | Excellent |
| 85-89 | A- | Good |
| 80-84 | B+ | Good |
| 75-79 | B | Fair |
| 70-74 | B- | Fair |
| <70 | C-F | Poor/Critical |

## 🔒 Security

This integration uses secure SSH connections to communicate with your ZimaOS system. No data is transmitted to external servers. All monitoring is done locally within your network.

## 📬 Support

- **Issues**: [GitHub Issues](https://github.com/chicohaager/zimaos-hass-integration/issues)
- **Documentation**: [GitHub Wiki](https://github.com/chicohaager/zimaos-hass-integration/wiki)
- **Community**: Home Assistant Forums

## 🙏 Credits

Developed for the Home Assistant community with ❤️