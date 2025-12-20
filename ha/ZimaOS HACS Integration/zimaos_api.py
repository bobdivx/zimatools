"""ZimaOS API Client with enhanced error handling."""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import paramiko
from homeassistant.exceptions import ConfigEntryNotReady

_LOGGER = logging.getLogger(__name__)


class ZimaOSAPI:
    """ZimaOS API Client with auto-reconnection support."""

    def __init__(
        self,
        host: str,
        username: str | None = None,
        password: str | None = None,
        ssh_port: int = 22,
    ) -> None:
        """Initialize the API client."""
        self.host = host
        self.username = username or "zimaos"
        self.password = password
        self.ssh_port = ssh_port
        self._ssh_client: paramiko.SSHClient | None = None
        self._docker_available = None  # Cache Docker availability

    async def connect(self) -> bool:
        """Connect to ZimaOS via SSH with retry logic."""
        try:
            # Close existing connection if any
            if self._ssh_client:
                try:
                    self._ssh_client.close()
                except:
                    pass
            
            self._ssh_client = paramiko.SSHClient()
            self._ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            _LOGGER.info("Attempting SSH connection to %s:%s with user %s", 
                        self.host, self.ssh_port, self.username)
            
            # Use executor for blocking SSH operations
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                self._ssh_connect_with_options,
            )
            
            # Test connection and detect Docker
            await self._detect_docker_availability()
            
            _LOGGER.info("SSH connection successful to ZimaOS (Docker: %s)", 
                        "Available" if self._docker_available else "Not Available")
            return True
            
        except paramiko.AuthenticationException as err:
            _LOGGER.error("Authentication failed for ZimaOS %s: %s", self.host, err)
            return False
        except Exception as err:
            _LOGGER.error("Failed to connect to ZimaOS %s:%s - Error: %s", 
                         self.host, self.ssh_port, str(err))
            return False

    def _ssh_connect_with_options(self):
        """SSH connection with enhanced options."""
        self._ssh_client.connect(
            hostname=self.host,
            port=self.ssh_port,
            username=self.username,
            password=self.password,
            timeout=20,
            allow_agent=False,
            look_for_keys=False,
            auth_timeout=15,
            banner_timeout=15,
            gss_auth=False,
            gss_kex=False,
        )

    async def close(self) -> None:
        """Close SSH connection."""
        if self._ssh_client:
            try:
                self._ssh_client.close()
            except:
                pass
            self._ssh_client = None

    async def _execute_command(self, command: str, timeout: int = 10) -> str:
        """Execute SSH command with timeout."""
        if not self._ssh_client or not self._ssh_client.get_transport():
            if not await self.connect():
                raise ConfigEntryNotReady("Could not connect to ZimaOS")

        try:
            # Use executor for blocking operations
            loop = asyncio.get_event_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, self._execute_ssh_command, command),
                timeout=timeout
            )
            return result
        except asyncio.TimeoutError:
            _LOGGER.error("Command timeout: %s", command)
            return ""
        except Exception as err:
            _LOGGER.error("Failed to execute command '%s': %s", command, err)
            # Don't raise here, return empty string to allow graceful degradation
            return ""

    def _execute_ssh_command(self, command: str) -> str:
        """Execute SSH command (blocking)."""
        try:
            stdin, stdout, stderr = self._ssh_client.exec_command(command, timeout=10)
            result = stdout.read().decode().strip()
            error = stderr.read().decode().strip()
            
            if error and "command not found" not in error.lower():
                _LOGGER.debug("Command '%s' stderr: %s", command, error)
            
            return result
        except Exception as err:
            _LOGGER.error("SSH command error: %s", err)
            return ""

    async def _detect_docker_availability(self):
        """Detect if Docker is available on the system."""
        try:
            # Try multiple methods to detect Docker
            docker_checks = [
                "which docker",
                "docker --version 2>/dev/null",
                "sudo -n docker --version 2>/dev/null",
                "systemctl is-active docker 2>/dev/null",
                "pgrep -x dockerd >/dev/null && echo 'running'"
            ]
            
            for check in docker_checks:
                result = await self._execute_command(check, timeout=5)
                if result and ("docker" in result.lower() or "running" in result or "active" in result):
                    self._docker_available = True
                    _LOGGER.debug("Docker detected using: %s", check)
                    return
            
            self._docker_available = False
            _LOGGER.debug("Docker not available on ZimaOS system")
            
        except Exception as err:
            _LOGGER.debug("Error detecting Docker: %s", err)
            self._docker_available = False

    async def get_system_info(self) -> dict[str, Any]:
        """Get comprehensive system information."""
        data = {}

        try:
            # Basic system info
            await self._get_basic_system_info(data)
            
            # Performance info
            await self._get_performance_info(data)
            
            # Network info
            await self._get_network_info(data)
            
            # Docker info (only if available)
            if self._docker_available:
                await self._get_docker_info(data)
            
            # Disk I/O info
            await self._get_disk_io_info(data)
            
            # Services info
            await self._get_services_info(data)

        except Exception as err:
            _LOGGER.error("Error getting system info: %s", err)
            # Return partial data instead of raising
            return data

        return data

    async def _get_basic_system_info(self, data: dict) -> None:
        """Get basic system information."""
        try:
            # CPU Usage - Multiple methods
            cpu_methods = [
                "top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1",
                "top -bn1 | grep '%Cpu' | awk '{print $2}'",
                "mpstat 1 1 | tail -1 | awk '{print 100-$NF}'",
                "grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$3+$4+$5)} END {print usage}'"
            ]
            
            for method in cpu_methods:
                cpu_info = await self._execute_command(method)
                if cpu_info and cpu_info.replace('.', '').replace('-', '').isdigit():
                    data["cpu_usage"] = round(float(cpu_info), 1)
                    break

            # Memory Info
            mem_info = await self._execute_command("free -m")
            if mem_info:
                lines = mem_info.split('\n')
                for line in lines:
                    if line.startswith('Mem:'):
                        parts = line.split()
                        if len(parts) >= 4:
                            total_mb = float(parts[1])
                            used_mb = float(parts[2])
                            
                            # Handle both old and new free formats
                            if len(parts) >= 7:
                                available_mb = float(parts[6])
                            else:
                                available_mb = float(parts[3])
                            
                            data["memory_total"] = round(total_mb / 1024, 2)
                            data["memory_used"] = round(used_mb / 1024, 2)
                            data["memory_available"] = round(available_mb / 1024, 2)
                            if total_mb > 0:
                                data["memory_usage"] = round((used_mb / total_mb) * 100, 2)
                        break
                
                # Swap Info
                for line in lines:
                    if line.startswith('Swap:'):
                        parts = line.split()
                        if len(parts) >= 4:
                            swap_total_mb = float(parts[1])
                            swap_used_mb = float(parts[2])
                            
                            data["swap_used"] = round(swap_used_mb / 1024, 2)
                            if swap_total_mb > 0:
                                data["swap_usage"] = round((swap_used_mb / swap_total_mb) * 100, 2)
                        break

            # Disk Usage
            await self._get_disk_usage_info(data)

            # Temperature
            await self._get_temperature_info(data)

            # Uptime
            uptime_info = await self._execute_command("uptime -p 2>/dev/null || uptime")
            if uptime_info:
                data["uptime"] = self._parse_uptime(uptime_info)

        except Exception as err:
            _LOGGER.debug("Error in basic system info: %s", err)

    async def _get_performance_info(self, data: dict) -> None:
        """Get system performance information."""
        try:
            # Load Average
            load_avg = await self._execute_command("uptime | awk -F'load average:' '{print $2}'")
            if load_avg:
                loads = load_avg.split(',')
                if len(loads) >= 3:
                    try:
                        data["load_average_1"] = round(float(loads[0].strip()), 2)
                        data["load_average_5"] = round(float(loads[1].strip()), 2)
                        data["load_average_15"] = round(float(loads[2].strip()), 2)
                    except ValueError:
                        pass

            # Process Count
            process_count = await self._execute_command("ps aux | wc -l")
            if process_count and process_count.isdigit():
                data["process_count"] = int(process_count) - 1

            # CPU Cores
            cpu_cores = await self._execute_command("nproc 2>/dev/null || grep -c processor /proc/cpuinfo")
            if cpu_cores and cpu_cores.isdigit():
                data["cpu_cores"] = int(cpu_cores)

            # Logged in users
            users_count = await self._execute_command("who | wc -l")
            if users_count and users_count.isdigit():
                data["users_logged_in"] = int(users_count)

            # Boot time
            boot_time = await self._execute_command("stat -c %Y /proc/1 2>/dev/null")
            if boot_time and boot_time.isdigit():
                data["system_boot_time"] = int(boot_time)

        except Exception as err:
            _LOGGER.debug("Error in performance info: %s", err)

    async def _get_network_info(self, data: dict) -> None:
        """Get network information."""
        try:
            # Network interface statistics
            net_info = await self._execute_command("cat /proc/net/dev")
            if net_info:
                lines = net_info.split('\n')[2:]
                total_rx_bytes = 0
                total_tx_bytes = 0
                
                for line in lines:
                    if ':' in line and any(iface in line for iface in ['eth', 'enp', 'wlan', 'eno']):
                        parts = line.split()
                        if len(parts) >= 10:
                            try:
                                rx_bytes = int(parts[1])
                                tx_bytes = int(parts[9])
                                total_rx_bytes += rx_bytes
                                total_tx_bytes += tx_bytes
                            except (ValueError, IndexError):
                                continue
                
                data["network_rx_total"] = round(total_rx_bytes / (1024 * 1024), 2)
                data["network_tx_total"] = round(total_tx_bytes / (1024 * 1024), 2)

            # Network connections
            connections = await self._execute_command("ss -t | grep ESTAB | wc -l")
            if not connections or not connections.isdigit():
                connections = await self._execute_command("netstat -tn 2>/dev/null | grep ESTABLISHED | wc -l")
            
            if connections and connections.isdigit():
                data["network_connections"] = int(connections)

            # SSH connections
            ssh_connections = await self._execute_command("ss -tn | grep ':22 ' | grep ESTAB | wc -l")
            if ssh_connections and ssh_connections.isdigit():
                data["ssh_connections"] = int(ssh_connections)

        except Exception as err:
            _LOGGER.debug("Error in network info: %s", err)

    async def _get_docker_info(self, data: dict) -> None:
        """Get Docker information if available."""
        if not self._docker_available:
            return
            
        try:
            # Try with and without sudo
            docker_cmd = "docker" if await self._execute_command("docker ps 2>/dev/null") else "sudo -n docker"
            
            # Running containers
            running = await self._execute_command(f"{docker_cmd} ps -q 2>/dev/null | wc -l")
            if running and running.isdigit():
                data["docker_containers_running"] = int(running)

            # Total containers
            total = await self._execute_command(f"{docker_cmd} ps -a -q 2>/dev/null | wc -l")
            if total and total.isdigit():
                data["docker_containers_total"] = int(total)

            # Images count
            images = await self._execute_command(f"{docker_cmd} images -q 2>/dev/null | sort -u | wc -l")
            if images and images.isdigit():
                data["docker_images_count"] = int(images)

        except Exception as err:
            _LOGGER.debug("Error getting Docker info: %s", err)

    async def _get_disk_io_info(self, data: dict) -> None:
        """Get disk I/O information."""
        try:
            # Try iostat first
            io_info = await self._execute_command("iostat -d 1 2 2>/dev/null | tail -n +4 | head -1")
            if io_info and len(io_info.split()) >= 3:
                parts = io_info.split()
                try:
                    # Values might be in different columns depending on iostat version
                    for i, part in enumerate(parts):
                        if '.' in part and i > 0:  # Find numeric values
                            read_speed = float(part) / 1024
                            if i + 1 < len(parts):
                                write_speed = float(parts[i + 1]) / 1024
                                data["disk_io_read"] = round(read_speed, 2)
                                data["disk_io_write"] = round(write_speed, 2)
                                break
                except (ValueError, IndexError):
                    pass
            
            # Fallback to /proc/diskstats
            if "disk_io_read" not in data:
                disk_stats = await self._execute_command("cat /proc/diskstats | grep -E ' (sda|nvme0n1|vda) ' | head -1")
                if disk_stats:
                    parts = disk_stats.split()
                    if len(parts) >= 14:
                        try:
                            # Very rough approximation
                            read_sectors = int(parts[5])
                            write_sectors = int(parts[9])
                            data["disk_io_read"] = round((read_sectors * 512) / (1024 * 1024 * 100), 2)
                            data["disk_io_write"] = round((write_sectors * 512) / (1024 * 1024 * 100), 2)
                        except (ValueError, IndexError):
                            pass

        except Exception as err:
            _LOGGER.debug("Error in disk I/O info: %s", err)

    async def _get_disk_usage_info(self, data: dict) -> None:
        """Get disk usage information for both root and DATA partitions."""
        try:
            disk_info = await self._execute_command("df -h 2>/dev/null")
            if disk_info:
                lines = disk_info.split('\n')
                
                for line in lines[1:]:
                    parts = line.split()
                    if len(parts) >= 6:
                        mount_point = parts[5]
                        
                        # DATA partition
                        if mount_point == '/DATA':
                            total = self._parse_size(parts[1])
                            used = self._parse_size(parts[2])
                            usage_percent = parts[4].rstrip('%')
                            
                            if total > 0:
                                data["disk_total_data"] = total
                                data["disk_used_data"] = used
                                data["disk_usage_data"] = float(usage_percent)
                        
                        # Root partition
                        elif mount_point == '/':
                            total = self._parse_size(parts[1])
                            used = self._parse_size(parts[2])
                            usage_percent = parts[4].rstrip('%')
                            
                            if total > 0:
                                data["disk_total_root"] = total
                                data["disk_used_root"] = used
                                data["disk_usage_root"] = float(usage_percent)

        except Exception as err:
            _LOGGER.debug("Error in disk usage info: %s", err)

    async def _get_temperature_info(self, data: dict) -> None:
        """Get CPU temperature from various sensors."""
        try:
            # Try multiple sensor locations
            temp_commands = [
                "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -1",
                "cat /sys/devices/platform/coretemp.*/hwmon/hwmon*/temp*_input 2>/dev/null | head -1",
                "sensors 2>/dev/null | grep -E 'Core 0|CPU' | head -1 | grep -oE '[0-9]+\\.?[0-9]*°C' | head -1 | tr -d '°C'"
            ]
            
            for cmd in temp_commands:
                temp_info = await self._execute_command(cmd)
                if temp_info and temp_info.replace('.', '').isdigit():
                    # Convert from millidegrees if necessary
                    temp_value = float(temp_info)
                    if temp_value > 1000:  # Likely in millidegrees
                        temp_value = temp_value / 1000
                    
                    if 20 < temp_value < 100:  # Sanity check
                        data["temperature"] = round(temp_value, 1)
                        break

        except Exception as err:
            _LOGGER.debug("Error in temperature info: %s", err)

    async def _get_services_info(self, data: dict) -> None:
        """Get services information."""
        # SSH connections already handled in network info
        pass

    def _parse_size(self, size_str: str) -> float:
        """Parse size string like '1.5G' to GB float."""
        if not size_str:
            return 0.0
        
        try:
            size_str = size_str.upper().strip()
            if size_str.endswith('K'):
                return round(float(size_str[:-1]) / 1024 / 1024, 2)
            elif size_str.endswith('M'):
                return round(float(size_str[:-1]) / 1024, 2)
            elif size_str.endswith('G'):
                return round(float(size_str[:-1]), 2)
            elif size_str.endswith('T'):
                return round(float(size_str[:-1]) * 1024, 2)
            else:
                # Assume bytes
                return round(float(size_str) / 1024 / 1024 / 1024, 2)
        except (ValueError, AttributeError):
            return 0.0

    def _parse_uptime(self, uptime_str: str) -> float:
        """Parse uptime string to days."""
        try:
            days = 0.0
            
            # Handle "uptime -p" format
            if "up" in uptime_str:
                # Extract days
                day_match = re.search(r'(\d+)\s+days?', uptime_str)
                if day_match:
                    days += int(day_match.group(1))
                
                # Extract hours
                hour_match = re.search(r'(\d+)\s+hours?', uptime_str)
                if hour_match:
                    days += int(hour_match.group(1)) / 24
                
                # Extract minutes
                minute_match = re.search(r'(\d+)\s+minutes?', uptime_str)
                if minute_match:
                    days += int(minute_match.group(1)) / 24 / 60
            
            # Handle standard uptime format (e.g., "10:30:45 up 5 days")
            else:
                day_match = re.search(r'(\d+)\s+days?', uptime_str)
                if day_match:
                    days = int(day_match.group(1))
                
                # Try to extract time if no days found
                if days == 0:
                    time_match = re.search(r'up\s+(\d+):(\d+)', uptime_str)
                    if time_match:
                        hours = int(time_match.group(1))
                        minutes = int(time_match.group(2))
                        days = hours / 24 + minutes / 24 / 60
            
            return round(days, 2)
        except Exception:
            return 0.0