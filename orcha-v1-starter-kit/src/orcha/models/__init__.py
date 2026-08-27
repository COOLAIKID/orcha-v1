"""Server-side model access; credentials are never accepted from the browser."""

from .gateway import EnvironmentModelGateway

__all__ = ["EnvironmentModelGateway"]
