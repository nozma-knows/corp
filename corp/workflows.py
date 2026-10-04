"""Pure scripted stages, kept distinct from treasury authority and model calls."""

from .treasury import DomainError


def prepare_delivery(product: dict) -> dict:
    return {"product_id": product["id"], "title": product["title"], "price_minor": product["price_minor"],
            "cost_minor": product["delivery_cost_minor"], "simulation_only": True, "real_asset_created": False}


def check_delivery(specification: dict) -> dict:
    if specification.get("simulation_only") is not True or specification.get("real_asset_created") is not False:
        raise DomainError("A scripted workflow cannot certify a real asset.", 422)
    for field in ("price_minor", "cost_minor"):
        if type(specification.get(field)) is not int or specification[field] <= 0:
            raise DomainError("Invalid scenario price or cost.", 422)
    if not specification.get("product_id") or not specification.get("title"):
        raise DomainError("Missing scenario delivery metadata.", 422)
    return {**specification, "metadata_validated": True}
