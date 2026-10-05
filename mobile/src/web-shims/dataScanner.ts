// Browser QR scanner shim for react-native-data-scanner
export const DataScanner = {
  async scanBarcode(_options?: any): Promise<{ value: string; format: string }> {
    const input = window.prompt('Scan / Enter B&W Order Code (e.g. BW1:00000000-0000-0000-0000-000000000000):');
    if (!input) {
      throw new Error('Cancelled');
    }
    return {
      value: input.trim(),
      format: 'qr',
    };
  },
};

export default { DataScanner };
