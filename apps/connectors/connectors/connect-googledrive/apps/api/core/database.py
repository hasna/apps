from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from apps.api.core.config import Settings, get_settings
from apps.api.database.base import Base

_engines: dict[str, AsyncEngine] = {}
_session_factories: dict[str, async_sessionmaker[AsyncSession]] = {}


def _get_engine(settings: Settings) -> AsyncEngine:
    key = settings.connector_database_url
    engine = _engines.get(key)
    if engine is None:
        engine = create_async_engine(
            key,
            pool_pre_ping=True,
        )
        _engines[key] = engine
    return engine


def _get_session_factory(settings: Settings) -> async_sessionmaker[AsyncSession]:
    key = settings.connector_database_url
    session_factory = _session_factories.get(key)
    if session_factory is None:
        session_factory = async_sessionmaker(
            _get_engine(settings),
            expire_on_commit=False,
        )
        _session_factories[key] = session_factory
    return session_factory


def get_session_factory(
    settings: Optional[Settings] = None,
) -> async_sessionmaker[AsyncSession]:
    cfg = settings or get_settings()
    return _get_session_factory(cfg)


async def get_session(
    settings: Optional[Settings] = None,
) -> AsyncGenerator[AsyncSession, None]:
    cfg = settings or get_settings()
    session_factory = _get_session_factory(cfg)
    async with session_factory() as session:
        yield session


async def init_database(settings: Optional[Settings] = None) -> None:
    cfg = settings or get_settings()
    engine = _get_engine(cfg)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
