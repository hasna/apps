"""Finite reviewed overlay identities. No user paths or arbitrary recipes."""
from pathlib import Path

SEARCH = "search-capacity"
DELIVERY = "delivery-headers"
NAMES = (SEARCH, DELIVERY)
SEARCH_PATHS = tuple("app/src/server/self-hosted/" + name + ".ts" for name in ("search-admission", "store", "serve"))
DELIVERY_PATHS = ("app/src/lib/email-address.ts", "app/src/server/self-hosted/service.ts", "app/src/providers/ses.ts")
ROOT = Path(__file__).resolve().parent


def select(name=SEARCH):
    if name == SEARCH:
        return {"name": name, "file": "recipe.json", "patch": "search-capacity.patch",
                "schema": "emails.source-overlay-recipe.v1", "preparedSchema": "emails.promotion-prepared.v1",
                "base": "sha256:a4f4ee450413ed60eed62b76551d647fc848633a6095e23a14a5369d4d34c268",
                "config": "sha256:4500f0fcd28d26d89bf161387a2566d2f851b5c216bc068c8f24e4ab3ddd5ca1",
                "paths": SEARCH_PATHS, "metadata": {p: (0, 0, 0o644) for p in SEARCH_PATHS},
                "artifact": "emails-search", "history": "search"}
    if name == DELIVERY:
        return {"name": name, "file": "delivery-recipe.json", "patch": "delivery-headers.patch",
                "schema": "emails.delivery-overlay-recipe.v1", "preparedSchema": "emails.delivery-prepared.v1",
                "base": "sha256:10403087ae6cc7fac75b4b4c544f3615ad0c9d9d99dd9d33ef291f1c8f3caed2",
                "config": "sha256:961400f176ef78689353a060e658ce72b7748a395a6f5713959f7dc2d74ce36c",
                "paths": DELIVERY_PATHS,
                "metadata": {p: ((0, 0, 0o664) if p.endswith("/service.ts") else (1000, 1000, 0o664)) for p in DELIVERY_PATHS},
                "artifact": "emails-delivery", "history": "delivery headers"}
    raise ValueError("UNKNOWN_RECIPE")
