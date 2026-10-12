import type {
  CreateOrderInput,
  CustomerOrder,
  OrderStatusHistoryItem,
} from '../types/order';

import {apiRequest} from './api';

export type CreateOrderResponse = CustomerOrder & {
  [key: string]: unknown;
};

export type ServiceabilityResponse = {
  serviceable: boolean;
  facilityId?: string;
  facilityName?: string;
  facilityAddress?: string | null;
  pincode?: string;
  distanceMeters?: number;
  serviceRadiusMeters?: number;
  reason?: 'INVALID_PINCODE' | 'MISSING_PINCODE' | 'OUTSIDE_SERVICE_AREA' | 'NO_ACTIVE_FACILITIES';
  message?: string;
};

export async function checkOrderServiceability(
  accessToken: string,
  pickupAddressId: string,
): Promise<ServiceabilityResponse> {
  return apiRequest<ServiceabilityResponse>(
    `/orders/serviceability?pickupAddressId=${encodeURIComponent(pickupAddressId)}`,
    {
      accessToken,
    },
  );
}

// A retry key is a deduplication identifier, never an authorization credential.
export function newOrderAttemptKey(): string {
  const hex = '0123456789abcdef';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += hex[Math.floor(Math.random() * 16)];
  }
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20)}`;
}

export async function createOrder(
  accessToken: string,
  input: CreateOrderInput,
): Promise<CreateOrderResponse> {
  if (input.items.length === 0) {
    throw new Error(
      'Your cart is empty.',
    );
  }

  const response =
    await apiRequest<CreateOrderResponse>(
      '/orders',
      {
        method: 'POST',
        accessToken,
        body: input,
      },
    );

  if (!response.id) {
    throw new Error(
      'Order was created but no order ID was returned.',
    );
  }

  invalidateOrdersCache();
  return response;
}

interface OrdersCacheEntry {
  token: string;
  data: CustomerOrder[];
  timestamp: number;
}

let cachedOrders: OrdersCacheEntry | null = null;
const ORDERS_CACHE_TTL_MS = 30_000;

interface InFlightOrdersRequest {
  key: string;
  promise: Promise<CustomerOrder[]>;
}

let inFlightGetOrders: InFlightOrdersRequest | null = null;

export function invalidateOrdersCache(): void {
  cachedOrders = null;
  inFlightGetOrders = null;
}

export type GetOrdersOptions = {
  forceRefresh?: boolean;
  limit?: number;
  offset?: number;
};

export async function getOrders(
  accessToken: string,
  options: GetOrdersOptions = {},
): Promise<CustomerOrder[]> {
  const { forceRefresh = false, limit, offset } = options;
  const now = Date.now();

  if (
    !forceRefresh &&
    limit === undefined &&
    offset === undefined &&
    cachedOrders &&
    cachedOrders.token === accessToken &&
    now - cachedOrders.timestamp < ORDERS_CACHE_TTL_MS
  ) {
    return cachedOrders.data;
  }

  const requestKey = `${accessToken}:${limit ?? ''}:${offset ?? ''}`;
  if (!forceRefresh && inFlightGetOrders && inFlightGetOrders.key === requestKey) {
    return inFlightGetOrders.promise;
  }

  const queryParams: string[] = [];
  if (limit !== undefined) queryParams.push(`limit=${limit}`);
  if (offset !== undefined) queryParams.push(`offset=${offset}`);
  const queryStr = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

  const fetchPromise = (async () => {
    try {
      const orders =
        await apiRequest<CustomerOrder[]>(
          `/orders${queryStr}`,
          {
            accessToken,
          },
        );

      if (!Array.isArray(orders)) {
        throw new Error(
          'Invalid orders response',
        );
      }

      if (limit === undefined && offset === undefined) {
        cachedOrders = {
          token: accessToken,
          data: orders,
          timestamp: Date.now(),
        };
      }

      return orders;
    } finally {
      if (inFlightGetOrders?.key === requestKey) {
        inFlightGetOrders = null;
      }
    }
  })();

  if (!forceRefresh) {
    inFlightGetOrders = {
      key: requestKey,
      promise: fetchPromise,
    };
  }

  return fetchPromise;
}

export async function getOrder(
  accessToken: string,
  orderId: string,
): Promise<CustomerOrder> {
  return apiRequest<CustomerOrder>(
    `/orders/${orderId}`,
    {
      accessToken,
    },
  );
}

const CANCELLABLE_STATUSES = new Set([
  'draft', 'pending_payment', 'confirmed', 'pickup_assigned',
  'pickup_accepted', 'en_route_pickup', 'pickup_otp_pending', 'pickup_failed',
]);

export function canCancelOrder(status: string) {
  return CANCELLABLE_STATUSES.has(status);
}

export async function cancelOrder(accessToken: string, orderId: string, reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw new Error('Enter a cancellation reason between 3 and 500 characters.');
  }
  const result = await apiRequest(`/orders/${orderId}/cancel`, {
    method: 'POST', accessToken, body: {reason: trimmed},
  });
  invalidateOrdersCache();
  return result;
}

export async function getOrderStatusHistory(
  accessToken: string,
  orderId: string,
): Promise<OrderStatusHistoryItem[]> {
  const history =
    await apiRequest<
      OrderStatusHistoryItem[]
    >(
      `/orders/${orderId}/status-history`,
      {
        accessToken,
      },
    );

  if (!Array.isArray(history)) {
    throw new Error(
      'Invalid order status history response',
    );
  }

  return history;
}
