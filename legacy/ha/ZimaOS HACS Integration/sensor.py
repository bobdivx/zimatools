"""ZimaOS sensors with health monitoring."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import ZimaOSDataUpdateCoordinator
from .const import DOMAIN, SENSOR_TYPES

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ZimaOS sensors from a config entry."""
    coordinator = hass.data[DOMAIN][config_entry.entry_id]

    entities = []
    for sensor_type in SENSOR_TYPES:
        entities.append(ZimaOSSensor(coordinator, config_entry, sensor_type))

    async_add_entities(entities)


class ZimaOSSensor(CoordinatorEntity, SensorEntity):
    """ZimaOS sensor with enhanced attributes."""

    def __init__(
        self,
        coordinator: ZimaOSDataUpdateCoordinator,
        config_entry: ConfigEntry,
        sensor_type: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._sensor_type = sensor_type
        self._config_entry = config_entry
        self._attr_unique_id = f"{config_entry.entry_id}_{sensor_type}"
        self._attr_name = f"ZimaOS {SENSOR_TYPES[sensor_type]['name']}"
        self._attr_icon = SENSOR_TYPES[sensor_type]['icon']
        self._attr_native_unit_of_measurement = SENSOR_TYPES[sensor_type]['unit']
        
        # Set device class if specified
        device_class = SENSOR_TYPES[sensor_type]['device_class']
        if device_class:
            if device_class == "temperature":
                self._attr_device_class = SensorDeviceClass.TEMPERATURE
            elif device_class == "timestamp":
                self._attr_device_class = SensorDeviceClass.TIMESTAMP
            else:
                self._attr_device_class = getattr(SensorDeviceClass, device_class.upper(), None)

        # Set state class for numeric sensors
        if sensor_type in ['cpu_usage', 'memory_usage', 'disk_usage_root', 'disk_usage_data',
                          'disk_io_read', 'disk_io_write', 'swap_usage', 'health_score']:
            self._attr_state_class = SensorStateClass.MEASUREMENT
        elif sensor_type in ['memory_used', 'memory_total', 'memory_available',
                           'disk_used_root', 'disk_total_root', 'disk_used_data', 
                           'disk_total_data', 'swap_used', 'network_rx_total', 'network_tx_total']:
            self._attr_state_class = SensorStateClass.TOTAL_INCREASING

    @property
    def device_info(self) -> dict[str, Any]:
        """Return device information with ZIMA branding."""
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": f"ZimaOS ({self._config_entry.data[CONF_HOST]})",
            "manufacturer": "ZIMA",
            "model": "ZimaOS NAS",
            "sw_version": self._get_software_version(),
            "configuration_url": f"http://{self._config_entry.data[CONF_HOST]}",
        }

    def _get_software_version(self) -> str:
        """Get software version from coordinator data."""
        if self.coordinator.data:
            # Try to extract version from uptime or other data
            uptime = self.coordinator.data.get("uptime", 0)
            if uptime > 0:
                return f"v2.0 (Up {uptime:.1f} days)"
        return "v2.0"

    @property
    def native_value(self) -> float | int | str | None:
        """Return the state of the sensor."""
        if self.coordinator.data is None:
            return None
        
        value = self.coordinator.data.get(self._sensor_type)
        
        # Format certain values for better display
        if value is not None:
            if self._sensor_type == "health_score":
                # Add grade to health score
                return value
            elif self._sensor_type in ["uptime", "load_average_1", "load_average_5", "load_average_15"]:
                # Round to 2 decimal places
                return round(value, 2) if isinstance(value, (int, float)) else value
        
        return value

    @property
    def available(self) -> bool:
        """Return True if entity is available."""
        # Always show health score even if it's 0
        if self._sensor_type == "health_score":
            return self.coordinator.last_update_success
        
        return self.coordinator.last_update_success and self.native_value is not None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        """Return additional state attributes."""
        if self.coordinator.data is None:
            return None

        attrs = {}
        
        # Health score attributes
        if self._sensor_type == "health_score" and self.coordinator.data:
            score = self.coordinator.data.get("health_score", 0)
            attrs["grade"] = self._calculate_grade(score)
            attrs["status"] = self._get_health_status(score)
            attrs["cpu_impact"] = self._get_impact_level(self.coordinator.data.get("cpu_usage", 0))
            attrs["memory_impact"] = self._get_impact_level(self.coordinator.data.get("memory_usage", 0))
            attrs["disk_impact"] = self._get_impact_level(self.coordinator.data.get("disk_usage_root", 0))
            if self.coordinator.data.get("temperature"):
                attrs["temperature_impact"] = self._get_temp_impact(self.coordinator.data.get("temperature", 0))
        
        # Memory attributes
        elif self._sensor_type == "memory_usage" and self.coordinator.data:
            attrs["memory_used_gb"] = self.coordinator.data.get("memory_used")
            attrs["memory_total_gb"] = self.coordinator.data.get("memory_total")
            attrs["memory_available_gb"] = self.coordinator.data.get("memory_available")
        
        # Disk attributes
        elif self._sensor_type == "disk_usage_root" and self.coordinator.data:
            attrs["disk_used_gb"] = self.coordinator.data.get("disk_used_root")
            attrs["disk_total_gb"] = self.coordinator.data.get("disk_total_root")
            free = (self.coordinator.data.get("disk_total_root", 0) - 
                   self.coordinator.data.get("disk_used_root", 0))
            attrs["disk_free_gb"] = round(free, 2)
        
        elif self._sensor_type == "disk_usage_data" and self.coordinator.data:
            attrs["disk_used_gb"] = self.coordinator.data.get("disk_used_data")
            attrs["disk_total_gb"] = self.coordinator.data.get("disk_total_data")
            free = (self.coordinator.data.get("disk_total_data", 0) - 
                   self.coordinator.data.get("disk_used_data", 0))
            attrs["disk_free_gb"] = round(free, 2)
        
        # Uptime attributes
        elif self._sensor_type == "uptime" and self.coordinator.data:
            uptime_days = self.coordinator.data.get("uptime", 0)
            if uptime_days:
                total_hours = uptime_days * 24
                days = int(uptime_days)
                hours = int((uptime_days % 1) * 24)
                minutes = int(((uptime_days * 24) % 1) * 60)
                
                attrs["uptime_formatted"] = f"{days}d {hours}h {minutes}m"
                attrs["total_hours"] = round(total_hours, 1)
        
        # Docker attributes
        elif self._sensor_type == "docker_containers_running" and self.coordinator.data:
            total = self.coordinator.data.get("docker_containers_total", 0)
            running = self.coordinator.data.get("docker_containers_running", 0)
            attrs["containers_stopped"] = total - running
            attrs["containers_total"] = total
        
        # Network attributes
        elif self._sensor_type == "network_rx_total" and self.coordinator.data:
            attrs["unit"] = "MB total received"
        elif self._sensor_type == "network_tx_total" and self.coordinator.data:
            attrs["unit"] = "MB total transmitted"
        
        # Temperature attributes
        elif self._sensor_type == "temperature" and self.coordinator.data:
            temp = self.coordinator.data.get("temperature", 0)
            attrs["status"] = self._get_temp_status(temp)
            attrs["fahrenheit"] = round((temp * 9/5) + 32, 1) if temp else None

        return attrs if attrs else None

    def _calculate_grade(self, score: int) -> str:
        """Calculate letter grade from health score."""
        if score >= 95:
            return "A+"
        elif score >= 90:
            return "A"
        elif score >= 85:
            return "A-"
        elif score >= 80:
            return "B+"
        elif score >= 75:
            return "B"
        elif score >= 70:
            return "B-"
        elif score >= 65:
            return "C+"
        elif score >= 60:
            return "C"
        elif score >= 55:
            return "C-"
        elif score >= 50:
            return "D"
        else:
            return "F"

    def _get_health_status(self, score: int) -> str:
        """Get health status description."""
        if score >= 90:
            return "Excellent"
        elif score >= 80:
            return "Good"
        elif score >= 70:
            return "Fair"
        elif score >= 60:
            return "Poor"
        else:
            return "Critical"

    def _get_impact_level(self, usage: float) -> str:
        """Get impact level based on usage percentage."""
        if usage > 90:
            return "Critical"
        elif usage > 75:
            return "High"
        elif usage > 60:
            return "Moderate"
        elif usage > 40:
            return "Low"
        else:
            return "Minimal"

    def _get_temp_impact(self, temp: float) -> str:
        """Get temperature impact level."""
        if temp > 80:
            return "Critical"
        elif temp > 70:
            return "High"
        elif temp > 60:
            return "Moderate"
        elif temp > 50:
            return "Low"
        else:
            return "Minimal"

    def _get_temp_status(self, temp: float) -> str:
        """Get temperature status."""
        if temp > 80:
            return "Hot"
        elif temp > 70:
            return "Warm"
        elif temp > 60:
            return "Normal"
        elif temp > 40:
            return "Cool"
        else:
            return "Cold"