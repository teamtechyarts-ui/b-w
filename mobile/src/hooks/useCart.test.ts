import {act, renderHook, waitFor} from '@testing-library/react-native';
import {useCart} from './useCart';
import {
  clearCartStorage,
  loadCartStorage,
  parseCartState,
  saveCartStorage,
} from '../services/cartStorage';
import type {ServiceItem} from '../types/service';

const mockServices: ServiceItem[] = [
  {
    id: 'service-a',
    name: 'Wash & Fold',
    categoryId: 'cat-1',
    categoryName: 'Wash',
    description: 'Everyday wash and fold',
    pricingUnit: 'per_kg',
    price: 50,
    facilityId: 'fac-1',
  },
  {
    id: 'service-b',
    name: 'Dry Cleaning',
    categoryId: 'cat-2',
    categoryName: 'Dry Clean',
    description: 'Suits and coats',
    pricingUnit: 'per_piece',
    price: 200,
    facilityId: 'fac-1',
  },
];

describe('useCart & cartStorage', () => {
  beforeEach(async () => {
    await clearCartStorage();
  });

  test('adds items and calculates item count and subtotal correctly', async () => {
    const view = await renderHook(() => useCart(mockServices));

    await act(async () => {
      view.result.current.updateQuantity(mockServices[0], 1);
      view.result.current.updateQuantity(mockServices[1], 2);
    });

    expect(view.result.current.cart['service-a']).toBe(1);
    expect(view.result.current.cart['service-b']).toBe(2);
    expect(view.result.current.cartItemCount).toBe(3);
    expect(view.result.current.cartSubtotal).toBe(50 * 1 + 200 * 2);
    expect(view.result.current.cartItems).toHaveLength(2);
  });

  test('cart remains intact after simulated remount', async () => {
    // 1. First render: add 2 services
    const view1 = await renderHook(() => useCart(mockServices));
    await act(async () => {
      view1.result.current.updateQuantity(mockServices[0], 1);
      view1.result.current.updateQuantity(mockServices[1], 1);
    });

    expect(view1.result.current.cartItemCount).toBe(2);

    // 2. Second render: simulate component remount
    const view2 = await renderHook(() => useCart(mockServices));
    await waitFor(() => {
      expect(view2.result.current.cartItemCount).toBe(2);
    });

    expect(view2.result.current.getQuantity('service-a')).toBe(1);
    expect(view2.result.current.getQuantity('service-b')).toBe(1);
    expect(view2.result.current.cartSubtotal).toBe(250);
  });

  test('empty services array during catalogue reload does NOT clear stored quantities', async () => {
    // Save existing cart
    await saveCartStorage({'service-a': 2, 'service-b': 1});

    // Render with empty services array (e.g. while getServices() is in flight)
    const view = await renderHook(
      ({services}: {services: ServiceItem[]}) => useCart(services),
      {initialProps: {services: [] as ServiceItem[]}},
    );

    await waitFor(() => {
      expect(view.result.current.getQuantity('service-a')).toBe(2);
    });

    // Stored quantities in cart state must be preserved
    expect(view.result.current.getQuantity('service-a')).toBe(2);
    expect(view.result.current.getQuantity('service-b')).toBe(1);
    expect(view.result.current.cartItemCount).toBe(3);
    expect(view.result.current.cartItems).toEqual([]);

    // Catalogue finishes loading
    await view.rerender({services: mockServices});

    expect(view.result.current.cartItems).toHaveLength(2);
    expect(view.result.current.cartSubtotal).toBe(50 * 2 + 200 * 1);
  });

  test('explicit remove item reduces quantity and removes at 0', async () => {
    const view = await renderHook(() => useCart(mockServices));

    await act(async () => {
      view.result.current.updateQuantity(mockServices[0], 2);
    });
    expect(view.result.current.getQuantity('service-a')).toBe(2);

    await act(async () => {
      view.result.current.updateQuantity(mockServices[0], -1);
    });
    expect(view.result.current.getQuantity('service-a')).toBe(1);

    await act(async () => {
      view.result.current.updateQuantity(mockServices[0], -1);
    });
    expect(view.result.current.getQuantity('service-a')).toBe(0);
    expect(view.result.current.cart['service-a']).toBeUndefined();
    expect(view.result.current.cartItemCount).toBe(0);
  });

  test('explicit resetCart clears both in-memory and persistent storage', async () => {
    const view = await renderHook(() => useCart(mockServices));

    await act(async () => {
      view.result.current.updateQuantity(mockServices[0], 3);
    });
    expect(view.result.current.cartItemCount).toBe(3);

    await act(async () => {
      view.result.current.resetCart();
    });

    expect(view.result.current.cart).toEqual({});
    expect(view.result.current.cartItemCount).toBe(0);
    expect(view.result.current.cartSubtotal).toBe(0);

    const stored = await loadCartStorage();
    expect(stored).toEqual({});
  });

  test('parseCartState handles malformed or corrupt payloads gracefully', () => {
    expect(parseCartState(null)).toEqual({});
    expect(parseCartState(undefined)).toEqual({});
    expect(parseCartState('invalid string')).toEqual({});
    expect(parseCartState([1, 2, 3])).toEqual({});
    expect(
      parseCartState({
        'valid-service': 2,
        'negative-val': -5,
        'nan-val': NaN,
        'zero-val': 0,
        'overflow-val': 500,
        '': 1,
      }),
    ).toEqual({
      'valid-service': 2,
      'overflow-val': 99,
    });
  });
});
