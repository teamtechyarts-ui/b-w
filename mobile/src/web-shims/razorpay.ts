// Browser checkout shim for react-native-razorpay using checkout.js
export type RazorpayFailure = {
  code: number;
  description: string;
  error?: {
    code?: string;
    description?: string;
  };
};

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay checkout script'));
    document.body.appendChild(script);
  });
}

export const RazorpayCheckout = {
  async open(options: any): Promise<{
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }> {
    if (!options?.key) {
      throw new Error('Razorpay key is not configured.');
    }

    await loadRazorpayScript();

    return new Promise((resolve, reject) => {
      let isDismissed = true;

      const webOptions = {
        ...options,
        handler: (response: any) => {
          isDismissed = false;
          resolve({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });
        },
        modal: {
          ondismiss: () => {
            if (isDismissed) {
              reject({
                code: 0,
                description: 'Payment was cancelled by user',
              });
            }
          },
        },
      };

      const rzp = new (window as any).Razorpay(webOptions);
      rzp.on('payment.failed', (response: any) => {
        reject({
          code: 1,
          description: response.error?.description || 'Payment Failed',
          error: response.error,
        });
      });

      rzp.open();
    });
  },
};

export default RazorpayCheckout;
