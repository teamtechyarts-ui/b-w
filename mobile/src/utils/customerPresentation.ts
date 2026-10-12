export function customerStatus(value?: string | null) {
  if (!value?.trim()) return 'Not available';
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatPaymentMethod(value?: string | null) {
  if (value === 'cash_on_delivery') return 'Cash on Delivery';
  if (value === 'razorpay') return 'Online Payment';
  return value ? customerStatus(value) : 'Not recorded';
}

export function customerTimelineReason(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === 'Order created' || trimmed.toLowerCase() === 'order created') {
    return null;
  }
  if (trimmed.startsWith('Provider payment captured (')) {
    return 'Payment received';
  }
  if (/Delivery OTP (and mandatory photograph |and photograph )?verified/i.test(trimmed)) {
    return 'Delivery completed';
  }
  if (/Pickup OTP verified/i.test(trimmed)) {
    return 'Pickup OTP verified';
  }
  if (/Seven-day delivery claim period started/i.test(trimmed)) {
    return '7-day claim period started';
  }
  // Strip any internal assignment/order UUIDs e.g. (assignment 12345678-...)
  const sanitized = trimmed
    .replace(/\s*\((assignment|order)\s+[0-9a-f-]+\)/gi, '')
    .replace(/\s*\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi, '')
    .trim();

  return sanitized || null;
}
