# 🏠 ZimaOS Monitor - Enterprise Home Assistant Integration

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)
[![Version](https://img.shields.io/badge/Version-2.0.0-blue.svg)](https://github.com/chicohaager/zimaos-hass-integration)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/chicohaager/zimaos-hass-integration/graphs/commit-activity)

Enterprise-grade Home Assistant integration for ZimaOS NAS monitoring with automatic reconnection, 30+ sensors, and health scoring system.

## ✨ Features

### Core Capabilities
- 🔄 **Automatic Reconnection** - Maintains persistent connection with retry logic
- 📊 **30+ Comprehensive Sensors** - Complete system monitoring suite
- 🏥 **Health Score System** - A+ to F grading with detailed metrics
- 🐳 **Docker Monitoring** - Container and image tracking
- 🌡️ **Temperature Monitoring** - CPU thermal management
- 📈 **Performance Metrics** - Load averages, I/O stats, network traffic
- ⚡ **Real-time Updates** - 30-second refresh interval
- 🔒 **Secure SSH Connection** - Password-protected access

## 📸 Screenshots

<details>
<summary>Click to view screenshots</summary>

### HACS Integration
![HACS Integration](screenshots/01-hacs-list.png)
*ZimaOS Monitor in HACS repository list with official ZIMA branding*

### Integration Dashboard
![Integration Dashboard](screenshots/02-integration-card.png)
*Main integration card showing system status and health score*

### Device Information
![Device Info](screenshots/03-device-info.png)
*Detailed device page with all sensors and ZIMA logo*

### Health Dashboard
![Health Dashboard](screenshots/04-health-dashboard.png)
*System health score with grade and impact analysis*

### Sensor List
![Sensors](screenshots/05-entities.png)
*Complete list of 30+ sensors with real-time data*

</details>

## 🚀 Installation

### Prerequisites
- Home Assistant 2023.1.0 or newer
- ZimaOS system with SSH enabled
- Network connectivity between Home Assistant and ZimaOS

### Method 1: HACS (Recommended)

1. Open HACS in your Home Assistant
2. Click on "Integrations"
3. Click the three dots menu and select "Custom repositories"
4. Add repository: `https://github.com/chicohaager/zimaos-hass-integration`
5. Select category: "Integration"
6. Click "ADD"
7. Search for "ZimaOS Monitor" and install
8. Restart Home Assistant
9. Go to Settings → Integrations → Add Integration → Search "ZimaOS"
10. Configure with your ZimaOS credentials

### Method 2: Manual Installation

1. Download the latest release from [GitHub Releases](https://github.com/chicohaager/zimaos-hass-integration/releases)
2. Extract the `zimaos` folder to your `custom_components` directory:
   ```
   custom_components/
   └── zimaos/
       ├── __init__.py
       ├── manifest.json
       ├── sensor.py
       ├── zimaos_api.py
       ├── config_flow.py
       ├── const.py
       ├── strings.json
       ├── hacs.json
       └── icon.png
   ```
3. Restart Home Assistant
4. Add integration via UI (Settings → Integrations → Add → ZimaOS)

## ⚙️ Configuration

### Enable SSH on ZimaOS

1. Access your ZimaOS web interface
2. Navigate to Settings → System → SSH
3. Enable SSH service
4. Note your username (usually `zimaos`) and password

### Add Integration in Home Assistant

1. Go to **Settings** → **Integrations**
2. Click **+ ADD INTEGRATION**
3. Search for **"ZimaOS Monitor"**
4. Enter your configuration:
   - **Host**: Your ZimaOS IP address (e.g., `192.168.1.100`)
   - **Username**: SSH username (default: `zimaos`)
   - **Password**: SSH password
   - **Port**: SSH port (default: `22`)

## 📊 Available Sensors

### System Metrics
| Sensor | Description | Unit |
|--------|-------------|------|
| `health_score` | Overall system health (0-100) with A-F grading | % |
| `cpu_usage` | Current CPU utilization | % |
| `memory_usage` | RAM usage percentage | % |
| `memory_used` | Used memory | GB |
| `memory_total` | Total available memory | GB |
| `memory_available` | Free memory | GB |
| `cpu_temperature` | CPU temperature | °C |
| `uptime` | System uptime | days |

### Storage Metrics
| Sensor | Description | Unit |
|--------|-------------|------|
| `disk_usage_root` | Root partition usage | % |
| `disk_used_root` | Root partition used space | GB |
| `disk_total_root` | Root partition total space | GB |
| `disk_usage_data` | DATA partition usage | % |
| `disk_used_data` | DATA partition used space | GB |
| `disk_total_data` | DATA partition total space | GB |
| `disk_io_read` | Disk read speed | MB/s |
| `disk_io_write` | Disk write speed | MB/s |

### Performance Metrics
| Sensor | Description | Unit |
|--------|-------------|------|
| `load_average_1` | 1-minute load average | - |
| `load_average_5` | 5-minute load average | - |
| `load_average_15` | 15-minute load average | - |
| `process_count` | Number of running processes | - |
| `cpu_cores` | Number of CPU cores | - |
| `swap_usage` | Swap memory usage | % |
| `swap_used` | Used swap space | GB |

### Network Metrics
| Sensor | Description | Unit |
|--------|-------------|------|
| `network_rx_total` | Total data received | MB |
| `network_tx_total` | Total data transmitted | MB |
| `network_connections` | Active network connections | - |
| `ssh_connections` | Active SSH sessions | - |
| `users_logged_in` | Number of logged-in users | - |

### Docker Metrics
| Sensor | Description | Unit |
|--------|-------------|------|
| `docker_containers_running` | Running Docker containers | - |
| `docker_containers_total` | Total Docker containers | - |
| `docker_images_count` | Number of Docker images | - |

### System Info
| Sensor | Description | Unit |
|--------|-------------|------|
| `system_boot_time` | Last system boot timestamp | timestamp |

## 🏥 Health Score System

The integration includes an intelligent health scoring system that evaluates your ZimaOS performance:

### Scoring Criteria
- **CPU Usage Impact**: -30 points if >90%, -20 if >75%, -10 if >60%
- **Memory Usage Impact**: -25 points if >90%, -15 if >80%, -8 if >70%
- **Disk Usage Impact**: -20 points if >90%, -10 if >80%, -5 if >70%
- **Temperature Impact**: -20 points if >80°C, -10 if >70°C, -5 if >60°C
- **Load Average Impact**: -15 points if load > 2×cores, -8 if > cores

### Grade Scale
| Score | Grade | Status |
|-------|-------|--------|
| 95-100 | A+ | Excellent |
| 90-94 | A | Excellent |
| 85-89 | A- | Good |
| 80-84 | B+ | Good |
| 75-79 | B | Fair |
| 70-74 | B- | Fair |
| 65-69 | C+ | Poor |
| 60-64 | C | Poor |
| 55-59 | C- | Critical |
| 50-54 | D | Critical |
| <50 | F | Critical |

## 🎨 Dashboard Examples

### Basic Status Card
```yaml
type: entities
title: ZimaOS Status
entities:
  - entity: sensor.zimaos_health_score
    name: Health Score
  - entity: sensor.zimaos_cpu_usage
    name: CPU Usage
  - entity: sensor.zimaos_memory_usage
    name: Memory Usage
  - entity: sensor.zimaos_disk_usage_root
    name: Disk Usage
  - entity: sensor.zimaos_cpu_temperature
    name: Temperature
```

### Gauge Cards
```yaml
type: horizontal-stack
cards:
  - type: gauge
    entity: sensor.zimaos_cpu_usage
    name: CPU
    max: 100
    severity:
      green: 0
      yellow: 60
      red: 80
  - type: gauge
    entity: sensor.zimaos_memory_usage
    name: Memory
    max: 100
    severity:
      green: 0
      yellow: 70
      red: 90
  - type: gauge
    entity: sensor.zimaos_health_score
    name: Health
    max: 100
    severity:
      green: 80
      yellow: 60
      red: 0
```

## 🔧 Troubleshooting

### Connection Issues
1. **Verify SSH access**: `ssh zimaos@YOUR_IP`
2. **Check firewall**: Ensure port 22 is open
3. **Verify credentials**: Username and password are correct
4. **Check logs**: `grep zimaos /config/home-assistant.log`

### Missing Sensors
- Some sensors (Docker, DATA partition) only appear if available on your system
- Temperature sensor requires thermal zones support
- Network stats require `/proc/net/dev` access

### Performance Issues
- Increase update interval in const.py if needed (default: 30s)
- Check SSH connection stability
- Monitor Home Assistant CPU usage

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [ZIMA](https://www.zimaboard.com/) for creating ZimaOS
- [Home Assistant](https://www.home-assistant.io/) community
- [HACS](https://hacs.xyz/) for the amazing custom component store

## 📬 Support

- **Issues**: [GitHub Issues](https://github.com/chicohaager/zimaos-hass-integration/issues)
- **Discussions**: [GitHub Discussions](https://github.com/chicohaager/zimaos-hass-integration/discussions)
- **Wiki**: [Documentation Wiki](https://github.com/chicohaager/zimaos-hass-integration/wiki)

---

**Made with ❤️ for the Home Assistant community**