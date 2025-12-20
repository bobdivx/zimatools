"""Constants for ZimaOS integration."""

DOMAIN = "zimaos"
CONF_HOST = "host"
CONF_PORT = "port"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_SSH_PORT = "ssh_port"

DEFAULT_PORT = 80
DEFAULT_SSH_PORT = 22
DEFAULT_USERNAME = "zimaos"

# Update intervals
SCAN_INTERVAL = 30  # seconds
RECONNECT_INTERVAL = 60  # seconds for reconnection attempts

# Sensor types - Extended version with fixed encoding
SENSOR_TYPES = {
    # === BASIC SENSORS ===
    "cpu_usage": {
        "name": "CPU Usage",
        "icon": "mdi:cpu-64-bit",
        "unit": "%",
        "device_class": None,
    },
    "memory_usage": {
        "name": "Memory Usage",
        "icon": "mdi:memory",
        "unit": "%",
        "device_class": None,
    },
    "memory_used": {
        "name": "Memory Used",
        "icon": "mdi:memory",
        "unit": "GB",
        "device_class": None,
    },
    "memory_total": {
        "name": "Memory Total",
        "icon": "mdi:memory",
        "unit": "GB",
        "device_class": None,
    },
    "disk_usage_root": {
        "name": "Disk Usage Root",
        "icon": "mdi:harddisk",
        "unit": "%",
        "device_class": None,
    },
    "disk_used_root": {
        "name": "Disk Used Root",
        "icon": "mdi:harddisk",
        "unit": "GB",
        "device_class": None,
    },
    "disk_total_root": {
        "name": "Disk Total Root",
        "icon": "mdi:harddisk",
        "unit": "GB",
        "device_class": None,
    },
    "disk_usage_data": {
        "name": "Disk Usage DATA",
        "icon": "mdi:database",
        "unit": "%",
        "device_class": None,
    },
    "disk_used_data": {
        "name": "Disk Used DATA",
        "icon": "mdi:database",
        "unit": "GB",
        "device_class": None,
    },
    "disk_total_data": {
        "name": "Disk Total DATA",
        "icon": "mdi:database",
        "unit": "GB",
        "device_class": None,
    },
    "temperature": {
        "name": "CPU Temperature",
        "icon": "mdi:thermometer",
        "unit": "°C",  # Fixed encoding
        "device_class": "temperature",
    },
    "uptime": {
        "name": "Uptime",
        "icon": "mdi:clock-outline",
        "unit": "days",
        "device_class": None,
    },
    
    # === SYSTEM PERFORMANCE ===
    "load_average_1": {
        "name": "Load Average 1min",
        "icon": "mdi:chart-line",
        "unit": None,
        "device_class": None,
    },
    "load_average_5": {
        "name": "Load Average 5min",
        "icon": "mdi:chart-line",
        "unit": None,
        "device_class": None,
    },
    "load_average_15": {
        "name": "Load Average 15min",
        "icon": "mdi:chart-line",
        "unit": None,
        "device_class": None,
    },
    "process_count": {
        "name": "Process Count",
        "icon": "mdi:format-list-numbered",
        "unit": None,
        "device_class": None,
    },
    "users_logged_in": {
        "name": "Users Logged In",
        "icon": "mdi:account-multiple",
        "unit": None,
        "device_class": None,
    },
    
    # === NETWORK SENSORS ===
    "network_rx_total": {
        "name": "Network RX Total",
        "icon": "mdi:download-network",
        "unit": "MB",
        "device_class": None,
    },
    "network_tx_total": {
        "name": "Network TX Total",
        "icon": "mdi:upload-network",
        "unit": "MB",
        "device_class": None,
    },
    "network_connections": {
        "name": "Network Connections",
        "icon": "mdi:lan-connect",
        "unit": None,
        "device_class": None,
    },
    
    # === DOCKER/CONTAINER ===
    "docker_containers_running": {
        "name": "Docker Containers Running",
        "icon": "mdi:docker",
        "unit": None,
        "device_class": None,
    },
    "docker_containers_total": {
        "name": "Docker Containers Total",
        "icon": "mdi:docker",
        "unit": None,
        "device_class": None,
    },
    "docker_images_count": {
        "name": "Docker Images Count",
        "icon": "mdi:docker",
        "unit": None,
        "device_class": None,
    },
    
    # === DISK I/O ===
    "disk_io_read": {
        "name": "Disk IO Read",
        "icon": "mdi:harddisk-plus",
        "unit": "MB/s",
        "device_class": None,
    },
    "disk_io_write": {
        "name": "Disk IO Write",
        "icon": "mdi:harddisk-plus",
        "unit": "MB/s",
        "device_class": None,
    },
    
    # === HARDWARE EXTENDED ===
    "cpu_cores": {
        "name": "CPU Cores",
        "icon": "mdi:cpu-64-bit",
        "unit": None,
        "device_class": None,
    },
    "memory_available": {
        "name": "Memory Available",
        "icon": "mdi:memory",
        "unit": "GB",
        "device_class": None,
    },
    "swap_usage": {
        "name": "Swap Usage",
        "icon": "mdi:harddisk-remove",
        "unit": "%",
        "device_class": None,
    },
    "swap_used": {
        "name": "Swap Used",
        "icon": "mdi:harddisk-remove",
        "unit": "GB",
        "device_class": None,
    },
    
    # === SERVICES ===
    "ssh_connections": {
        "name": "SSH Connections",
        "icon": "mdi:console-network",
        "unit": None,
        "device_class": None,
    },
    "system_boot_time": {
        "name": "Last Boot Time",
        "icon": "mdi:restart",
        "unit": None,
        "device_class": "timestamp",
    },
    
    # === HEALTH SCORE ===
    "health_score": {
        "name": "Health Score",
        "icon": "mdi:heart-pulse",
        "unit": "%",
        "device_class": None,
    },
}

# Error messages
ERROR_AUTH = "authentication_failed"
ERROR_CONNECT = "connection_failed"
ERROR_TIMEOUT = "timeout"
ERROR_UNKNOWN = "unknown_error"