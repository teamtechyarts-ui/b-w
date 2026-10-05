import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  CartItem,
  ServiceItem,
} from '../types/service';

import {
  clearCartStorage,
  loadCartStorage,
  readWebCartStorage,
  saveCartStorage,
} from '../services/cartStorage';

export type CartState = Record<string, number>;

type UseCartOptions = {
  onQuoteItem?: (
    service: ServiceItem,
  ) => void;
};

export function useCart(
  services: ServiceItem[],
  options: UseCartOptions = {},
) {
  const {
    onQuoteItem,
  } = options;

  const [
    cart,
    setCart,
  ] = useState<CartState>(() => {
    return readWebCartStorage() ?? {};
  });

  const hydratedRef = useRef(false);

  // Asynchronously hydrate from persistent storage
  useEffect(() => {
    let active = true;
    async function hydrate() {
      try {
        const stored = await loadCartStorage();
        if (active && stored && Object.keys(stored).length > 0) {
          setCart(current => {
            if (Object.keys(current).length > 0) {
              return current;
            }
            return stored;
          });
        }
      } catch {
        // Safe fallback
      } finally {
        hydratedRef.current = true;
      }
    }
    hydrate();
    return () => {
      active = false;
    };
  }, []);

  const cartItems = useMemo<CartItem[]>(() => {
    if (!services || services.length === 0) {
      return [];
    }
    return services
      .filter(service => (cart[service.id] ?? 0) > 0)
      .map(service => ({
        ...service,
        quantity: cart[service.id] ?? 0,
      }));
  }, [services, cart]);

  const cartItemCount = useMemo(() => {
    return Object.values(cart).reduce(
      (total, quantity) => total + quantity,
      0,
    );
  }, [cart]);

  const cartSubtotal = useMemo(() => {
    return cartItems.reduce((total, item) => {
      if (item.price === null) {
        return total;
      }
      return total + item.price * item.quantity;
    }, 0);
  }, [cartItems]);

  const getQuantity = useCallback(
    (serviceId: string) => {
      return cart[serviceId] ?? 0;
    },
    [cart],
  );

  const updateQuantity = useCallback(
    (service: ServiceItem, change: number) => {
      if (service.price === null) {
        onQuoteItem?.(service);
        return;
      }

      setCart(current => {
        const existing = current[service.id] ?? 0;
        const next = existing + change;
        let updated: CartState;

        if (next <= 0) {
          updated = {
            ...current,
          };
          delete updated[service.id];
        } else {
          updated = {
            ...current,
            [service.id]: Math.min(next, 99),
          };
        }
        saveCartStorage(updated);
        return updated;
      });
    },
    [onQuoteItem],
  );

  const resetCart = useCallback(() => {
    setCart({});
    clearCartStorage();
  }, []);

  return {
    cart,
    cartItems,
    cartItemCount,
    cartSubtotal,

    getQuantity,
    updateQuantity,
    resetCart,
  };
}