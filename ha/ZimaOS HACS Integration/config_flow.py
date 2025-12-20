"""Config flow for ZimaOS integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_HOST, CONF_PASSWORD, CONF_PORT, CONF_USERNAME
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_SSH_PORT,
    DEFAULT_SSH_PORT,
    DEFAULT_USERNAME,
    DOMAIN,
    ERROR_AUTH,
    ERROR_CONNECT,
    ERROR_TIMEOUT,
    ERROR_UNKNOWN,
)
from .zimaos_api import ZimaOSAPI

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_HOST): str,
        vol.Optional(CONF_USERNAME, default=DEFAULT_USERNAME): str,
        vol.Optional(CONF_PASSWORD): str,
        vol.Optional(CONF_SSH_PORT, default=DEFAULT_SSH_PORT): int,
    }
)


class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for ZimaOS."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        if user_input is None:
            return self.async_show_form(
                step_id="user", data_schema=STEP_USER_DATA_SCHEMA
            )

        errors = {}

        try:
            info = await validate_input(self.hass, user_input)
        except CannotConnect:
            errors["base"] = ERROR_CONNECT
        except InvalidAuth:
            errors["base"] = ERROR_AUTH
        except TimeoutError:
            errors["base"] = ERROR_TIMEOUT
        except Exception:  # pylint: disable=broad-except
            _LOGGER.exception("Unexpected exception")
            errors["base"] = ERROR_UNKNOWN
        else:
            # Check if already configured
            await self.async_set_unique_id(f"zimaos_{user_input[CONF_HOST]}")
            self._abort_if_unique_id_configured()
            
            return self.async_create_entry(title=info["title"], data=user_input)

        return self.async_show_form(
            step_id="user", data_schema=STEP_USER_DATA_SCHEMA, errors=errors
        )


class CannotConnect(Exception):
    """Error to indicate we cannot connect."""


class InvalidAuth(Exception):
    """Error to indicate there is invalid auth."""


async def validate_input(hass, data: dict[str, Any]) -> dict[str, Any]:
    """Validate the user input allows us to connect.

    Data has the keys from STEP_USER_DATA_SCHEMA with values provided by the user.
    """
    api = ZimaOSAPI(
        host=data[CONF_HOST],
        username=data.get(CONF_USERNAME),
        password=data.get(CONF_PASSWORD),
        ssh_port=data.get(CONF_SSH_PORT, DEFAULT_SSH_PORT),
    )

    try:
        # Test connection
        if not await api.connect():
            raise CannotConnect

        # Test getting system info to verify connection works
        info = await api.get_system_info()
        
        if not info:
            _LOGGER.error("Failed to get system info from ZimaOS")
            raise CannotConnect
            
    except Exception as err:
        _LOGGER.error("Error connecting to ZimaOS: %s", err)
        if "authentication" in str(err).lower() or "permission" in str(err).lower():
            raise InvalidAuth
        elif "timeout" in str(err).lower():
            raise TimeoutError
        raise CannotConnect
    finally:
        await api.close()

    # Return info that you want to store in the config entry.
    return {"title": f"ZimaOS ({data[CONF_HOST]})"}