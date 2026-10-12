import {apiRequest} from './api';
import {
  canRaiseClaim,
  chooseClaimPhoto,
  createClaim,
  deviceReachableUploadUrl,
  getOrderClaims,
  uploadClaimPhoto,
} from './claimsApi';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';

jest.mock('./api', () => ({apiRequest: jest.fn()}));
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
const request = apiRequest as jest.MockedFunction<typeof apiRequest>;
const picker = launchImageLibrary as jest.MockedFunction<typeof launchImageLibrary>;
const camera = launchCamera as jest.MockedFunction<typeof launchCamera>;

describe('customer claim integration and security matrix', () => {
  beforeEach(() => jest.clearAllMocks());

  it('limits the claim form to an active seven day window', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const past = new Date(Date.now() - 60000).toISOString();
    expect(canRaiseClaim('claim_period_active', future)).toBe(true);
    expect(canRaiseClaim('claim_period_active', past)).toBe(false);
    expect(canRaiseClaim('delivered', future)).toBe(false);
  });

  it('validates description and submits the allowed type through the existing endpoint', async () => {
    await expect(createClaim('token', 'order-1', 'damage', 'short')).rejects.toThrow('10 to 4000');
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({id: 'claim-1'});
    await createClaim('token', 'order-1', 'missing_item', 'One shirt is missing', 'request-1');
    expect(request).toHaveBeenCalledWith(
      '/orders/order-1/claims',
      expect.objectContaining({
        method: 'POST',
        body: {
          clientRequestId: 'request-1',
          claimType: 'missing_item',
          description: 'One shirt is missing',
        },
      }),
    );
  });

  it('loads status history and handles an invalid response', async () => {
    request.mockResolvedValueOnce([{id: 'claim-1', status: 'under_review'}]);
    await expect(getOrderClaims('token', 'order-1')).resolves.toMatchObject([
      {status: 'under_review'},
    ]);
    request.mockResolvedValueOnce({});
    await expect(getOrderClaims('token', 'order-1')).rejects.toThrow('Unable to load claims');
  });

  it('uses the signed upload and attaches its path only after upload succeeds', async () => {
    picker.mockResolvedValueOnce({
      assets: [
        {
          uri: 'file:///photo.jpg',
          fileName: 'photo.jpg',
          type: 'image/jpeg',
          fileSize: 60000,
        },
      ],
    });
    const photo = await chooseClaimPhoto();
    expect(photo).toMatchObject({name: 'photo.webp', type: 'image/webp'});
    request.mockResolvedValueOnce({
      path: 'private/photo.webp',
      signedUrl: 'https://local.test/upload',
    });
    request.mockResolvedValueOnce({id: 'photo-1'});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => ({size: 55000, type: 'image/webp'}),
      })
      .mockResolvedValueOnce({ok: true}) as any;
    try {
      await uploadClaimPhoto('token', 'claim-1', photo!);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://local.test/upload',
        expect.objectContaining({
          method: 'PUT',
          headers: {'Content-Type': 'image/webp'},
        }),
      );
      expect(request).toHaveBeenLastCalledWith(
        '/claims/claim-1/photos',
        expect.objectContaining({body: {photoPath: 'private/photo.webp'}}),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('accepts a camera photo and converts to WebP for upload flow', async () => {
    camera.mockResolvedValueOnce({
      assets: [
        {
          uri: 'file:///camera.jpg',
          fileName: 'camera.jpg',
          type: 'image/jpeg',
          fileSize: 65000,
        },
      ],
    });
    const result = await chooseClaimPhoto('camera');
    expect(result).toMatchObject({
      name: 'camera.webp',
      type: 'image/webp',
    });
    expect(camera).toHaveBeenCalledWith(
      expect.objectContaining({mediaType: 'photo'}),
    );
  });

  it('returns null on cancel without throwing', async () => {
    camera.mockResolvedValueOnce({didCancel: true});
    await expect(chooseClaimPhoto('camera')).resolves.toBeNull();
  });

  it('rewrites only local signed Storage URLs for a physical iPhone', () => {
    const local = 'http://127.0.0.1:54321/storage/v1/upload?token=test';
    expect(
      deviceReachableUploadUrl(local, 'http://192.168.29.103:54321'),
    ).toBe('http://192.168.29.103:54321/storage/v1/upload?token=test');
    expect(
      deviceReachableUploadUrl(
        'https://storage.example/upload?token=test',
        'http://192.168.29.103:54321',
      ),
    ).toBe('https://storage.example/upload?token=test');
  });

  it('80 KB+ final file: rejects photos exceeding 80 KB limit', async () => {
    request.mockResolvedValueOnce({
      path: 'private/photo.webp',
      signedUrl: 'https://local.test/upload',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      blob: async () => ({size: 90000, type: 'image/webp'}),
    }) as any;
    try {
      await expect(
        uploadClaimPhoto('token', 'claim-1', {
          uri: 'file:///photo.webp',
          name: 'photo.webp',
          type: 'image/webp',
        }),
      ).rejects.toThrow('80 KB');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Expired signed URL: fails and prevents attachment when storage PUT returns 403/400', async () => {
    request.mockResolvedValueOnce({
      path: 'private/photo.webp',
      signedUrl: 'https://local.test/upload?token=expired',
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => ({size: 50000, type: 'image/webp'}),
      })
      .mockResolvedValueOnce({ok: false, status: 403}) as any; // expired signed URL
    try {
      await expect(
        uploadClaimPhoto('token', 'claim-1', {
          uri: 'file:///photo.webp',
          name: 'photo.webp',
          type: 'image/webp',
        }),
      ).rejects.toThrow('Photograph upload failed. Please retry.');
      expect(request).toHaveBeenCalledTimes(1); // /upload-url was called, but /photos attach was blocked!
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('Unauthenticated upload: fails when apiRequest rejects with unauthorized', async () => {
    request.mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(
      uploadClaimPhoto('', 'claim-1', {
        uri: 'file:///photo.webp',
        name: 'photo.webp',
        type: 'image/webp',
      }),
    ).rejects.toThrow('Unauthorized');
  });
});
