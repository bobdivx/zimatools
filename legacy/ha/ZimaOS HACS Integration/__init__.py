"""ZimaOS Monitor Integration."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryNotReady
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, SCAN_INTERVAL, RECONNECT_INTERVAL
from .zimaos_api import ZimaOSAPI

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.SENSOR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up ZimaOS from a config entry."""
    
    api = ZimaOSAPI(
        host=entry.data["host"],
        username=entry.data.get("username"),
        password=entry.data.get("password"),
        ssh_port=entry.data.get("ssh_port", 22),
    )

    coordinator = ZimaOSDataUpdateCoordinator(hass, api, entry)

    try:
        await coordinator.async_config_entry_first_refresh()
    except ConfigEntryNotReady:
        await api.close()
        raise

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        coordinator = hass.data[DOMAIN].pop(entry.entry_id)
        await coordinator.api.close()

    return unload_ok


class ZimaOSDataUpdateCoordinator(DataUpdateCoordinator):
    """Class to manage fetching ZimaOS data with auto-reconnection."""

    def __init__(self, hass: HomeAssistant, api: ZimaOSAPI, entry: ConfigEntry) -> None:
        """Initialize with reconnection support."""
        self.api = api
        self.entry = entry
        self._reconnect_task = None
        self._connection_failed = False
        self._last_successful_update = None
        
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=SCAN_INTERVAL),
        )

    async def _async_update_data(self):
        """Update data via library with timeout and reconnection."""
        try:
            # Add timeout protection (30 seconds max)
            async with asyncio.timeout(30):
                data = await self._ensure_connection()
                
                # Calculate health score based on metrics
                if data:
                    data["health_score"] = self._calculate_health_score(data)
                    self._last_successful_update = datetime.now()
                    self._connection_failed = False
                
                return data
                
        except asyncio.TimeoutError:
            _LOGGER.error("Timeout while updating ZimaOS data")
            self._handle_connection_failure()
            raise UpdateFailed("Connection timeout")
        except Exception as exception:
            _LOGGER.error("Error updating ZimaOS data: %s", exception)
            self._handle_connection_failure()
            raise UpdateFailed(f"Error communicating with API: {exception}")

    async def _ensure_connection(self):
        """Ensure connection is active and reconnect if needed."""
        # Check if SSH client is still connected
        if not self.api._ssh_client or not self.api._ssh_client.get_transport():
            _LOGGER.info("SSH connection lost, attempting to reconnect...")
            connected = await self.api.connect()
            
            if not connected:
                # Schedule reconnection attempt
                if not self._reconnect_task:
                    self._reconnect_task = self.hass.async_create_task(
                        self._reconnect_loop()
                    )
                raise UpdateFailed("Failed to reconnect to ZimaOS")
        
        # Get system info
        return await self.api.get_system_info()

    async def _reconnect_loop(self):
        """Background task to attempt reconnection."""
        while self._connection_failed:
            await asyncio.sleep(RECONNECT_INTERVAL)
            
            _LOGGER.info("Attempting automatic reconnection to ZimaOS...")
            try:
                connected = await self.api.connect()
                if connected:
                    _LOGGER.info("Successfully reconnected to ZimaOS")
                    self._connection_failed = False
                    self._reconnect_task = None
                    # Force an update after reconnection
                    await self.async_request_refresh()
                    break
            except Exception as err:
                _LOGGER.debug("Reconnection attempt failed: %s", err)
                continue

    def _handle_connection_failure(self):
        """Handle connection failure and schedule reconnection."""
        self._connection_failed = True
        if not self._reconnect_task:
            self._reconnect_task = self.hass.async_create_task(
                self._reconnect_loop()
            )

    def _calculate_health_score(self, data: dict) -> int:
        """Calculate system health score (0-100)."""
        score = 100
        
        # CPU usage impact
        cpu_usage = data.get("cpu_usage", 0)
        if cpu_usage > 90:
            score -= 30
        elif cpu_usage > 75:
            score -= 20
        elif cpu_usage > 60:
            score -= 10
        
        # Memory usage impact
        memory_usage = data.get("memory_usage", 0)
        if memory_usage > 90:
            score -= 25
        elif memory_usage > 80:
            score -= 15
        elif memory_usage > 70:
            score -= 8
        
        # Disk usage impact (root)
        disk_usage = data.get("disk_usage_root", 0)
        if disk_usage > 90:
            score -= 20
        elif disk_usage > 80:
            score -= 10
        elif disk_usage > 70:
            score -= 5
        
        # Temperature impact
        temperature = data.get("temperature", 0)
        if temperature > 80:
            score -= 20
        elif temperature > 70:
            score -= 10
        elif temperature > 60:
            score -= 5
        
        # Load average impact
        load_avg = data.get("load_average_1", 0)
        cpu_cores = data.get("cpu_cores", 4)
        if cpu_cores > 0 and load_avg > cpu_cores * 2:
            score -= 15
        elif cpu_cores > 0 and load_avg > cpu_cores:
            score -= 8
        
        return max(0, score)  # Ensure score doesn't go below 0

    async def async_shutdown(self):
        """Clean shutdown of coordinator."""
        if self._reconnect_task:
            self._reconnect_task.cancel()
        await self.api.close()