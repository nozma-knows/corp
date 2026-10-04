import { DomainError } from './errors.js';
import type { Product } from '../shared/contracts.js';
export function prepareDelivery(product: Product) {
  return {
    product_id: product.id,
    title: product.title,
    price_minor: product.price_minor,
    cost_minor: product.delivery_cost_minor,
    simulation_only: true,
    real_asset_created: false,
  };
}
export function checkDelivery(specification: ReturnType<typeof prepareDelivery>) {
  if (specification.simulation_only !== true || specification.real_asset_created !== false)
    throw new DomainError('A scripted workflow cannot certify a real asset.', 422);
  if (
    ![specification.price_minor, specification.cost_minor].every(
      (v) => Number.isSafeInteger(v) && v > 0,
    )
  )
    throw new DomainError('Invalid scenario price or cost.', 422);
  if (!specification.product_id || !specification.title)
    throw new DomainError('Missing scenario delivery metadata.', 422);
  return { ...specification, metadata_validated: true };
}
