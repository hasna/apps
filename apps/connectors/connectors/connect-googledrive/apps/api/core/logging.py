import logging
from typing import Any

import sentry_sdk
import structlog

from apps.api.core.config import Settings


def setup_logging(settings: Settings) -> None:
    """Configure structlog, standard logging, and optional error tracking."""
    log_level = settings.connector_log_level
    timestamper = structlog.processors.TimeStamper(fmt="iso")

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            timestamper,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(log_level)),
        cache_logger_on_first_use=True,
    )

    logging.basicConfig(
        level=log_level,
        format="%(message)s",
    )

    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            traces_sample_rate=0.1,
            enable_tracing=True,
        )


def get_logger(name: str, **bind_kwargs: Any) -> structlog.stdlib.BoundLogger:
    logger = structlog.get_logger(name)
    if bind_kwargs:
        return logger.bind(**bind_kwargs)
    return logger
