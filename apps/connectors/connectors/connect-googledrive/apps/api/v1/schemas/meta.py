from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, ConfigDict


class RouteExample(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    curl: str
    httpie: str


class RouteDescriptor(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    method: str
    path: str
    operation_id: Optional[str] = Field(default=None, alias="operationId")
    summary: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    request_schema_ref: Optional[str] = Field(default=None, alias="requestSchemaRef")
    response_schema_ref: Optional[str] = Field(default=None, alias="responseSchemaRef")
    examples: RouteExample
