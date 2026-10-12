import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClaimsService } from './claims.service';

function fluentResult(data: any, error: any = null) {
  const query: any = {};
  for (const method of ['select', 'eq', 'order']) {
    query[method] = jest.fn(() => query);
  }
  query.maybeSingle = jest.fn().mockResolvedValue({ data, error });
  return query;
}

describe('ClaimsService Security & Isolation Matrix', () => {
  it('submits a customer claim through the atomic claim-window RPC', async () => {
    const claim = {
      id: 'claim-1',
      order_id: 'order-1',
      claim_type: 'damage',
      duplicate: false,
    };
    const rpc = jest.fn().mockResolvedValue({ data: claim, error: null });
    const service = new ClaimsService({ admin: { rpc } } as any);

    await expect(
      service.create('profile-1', 'order-1', {
        clientRequestId: '00000000-0000-4000-8000-000000000001',
        claimType: 'damage',
        description: 'A shirt was returned with a visible tear.',
      }),
    ).resolves.toEqual(claim);
    expect(rpc).toHaveBeenCalledWith('create_customer_order_claim_atomic', {
      p_order_id: 'order-1',
      p_profile_id: 'profile-1',
      p_claim_type: 'damage',
      p_description: 'A shirt was returned with a visible tear.',
      p_order_item_id: null,
      p_client_request_id: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('Customer A claim -> Customer B tries to read: must fail with NotFoundException', async () => {
    const customers = fluentResult({ id: 'customer-b' });
    const claims = fluentResult(null); // Customer B does not own claim A
    const service = new ClaimsService({
      admin: {
        from: jest.fn((table: string) =>
          table === 'customers' ? customers : claims,
        ),
      },
    } as any);

    await expect(
      service.getOne('customer-b-profile', 'claim-a-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Customer A claim -> Customer B tries to upload: must fail with NotFoundException', async () => {
    const customers = fluentResult({ id: 'customer-b' });
    const claims = fluentResult(null);
    const service = new ClaimsService({
      admin: {
        from: jest.fn((table: string) =>
          table === 'customers' ? customers : claims,
        ),
      },
    } as any);

    await expect(
      service.createPhotoUpload('customer-b-profile', 'claim-a-id', 'photo.webp'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Customer B claim -> Customer A tries to attach photo: must fail with ForbiddenException', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Claim is not owned by this customer',
      },
    });
    const service = new ClaimsService({ admin: { rpc } } as any);

    await expect(
      service.attachPhoto('customer-a-profile', 'claim-b-id', 'customer-a-profile/claim-b-id/photo.webp'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Modified claimId -> must fail when claim does not exist', async () => {
    const customers = fluentResult({ id: 'customer-a' });
    const claims = fluentResult(null);
    const service = new ClaimsService({
      admin: {
        from: jest.fn((table: string) =>
          table === 'customers' ? customers : claims,
        ),
      },
    } as any);

    await expect(
      service.getOne('customer-a-profile', '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Modified storage path -> must fail with BadRequestException or Forbidden', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '22023',
        message: 'Invalid claim photo path',
      },
    });
    const service = new ClaimsService({ admin: { rpc } } as any);

    await expect(
      service.attachPhoto('profile-1', 'claim-1', 'malicious/other-user/photo.webp'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Non-WebP upload -> must reject unauthorized file types (exe, pdf, zip)', async () => {
    const customers = fluentResult({ id: 'customer-1' });
    const claims = fluentResult({
      id: 'claim-1',
      customer_id: 'customer-1',
      status: 'submitted',
    });
    const storageFrom = jest.fn();
    const service = new ClaimsService({
      admin: {
        from: jest.fn((table: string) =>
          table === 'customers' ? customers : claims,
        ),
        storage: { from: storageFrom },
      },
    } as any);

    await expect(
      service.createPhotoUpload('profile-1', 'claim-1', 'evidence.pdf'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPhotoUpload('profile-1', 'claim-1', 'exploit.exe'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPhotoUpload('profile-1', 'claim-1', 'archive.zip'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it('Expired claim window -> must fail with ConflictException', async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: 'The order claim period has expired',
      },
    });
    const service = new ClaimsService({ admin: { rpc } } as any);

    await expect(
      service.create('profile-1', 'order-1', {
        clientRequestId: '00000000-0000-4000-8000-000000000001',
        claimType: 'quality',
        description: 'The cleaning quality does not match the order.',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates an owner-scoped private photo upload path for WebP photos', async () => {
    const customers = fluentResult({ id: 'customer-1' });
    const claims = fluentResult({
      id: 'claim-1',
      customer_id: 'customer-1',
      status: 'submitted',
      customer_claim_photos: [],
    });
    const createSignedUploadUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl: 'signed-development-url',
        token: 'signed-development-token',
      },
      error: null,
    });
    const bucket = jest.fn(() => ({ createSignedUploadUrl }));
    const service = new ClaimsService({
      admin: {
        from: jest.fn((table: string) =>
          table === 'customers' ? customers : claims,
        ),
        storage: { from: bucket },
      },
    } as any);

    const result = await service.createPhotoUpload(
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000020',
      'damage.webp',
    );

    expect(result.path).toMatch(
      /^00000000-0000-4000-8000-000000000010\/00000000-0000-4000-8000-000000000020\/[0-9a-f-]+[.]webp$/,
    );
    expect(bucket).toHaveBeenCalledWith('customer-claim-photos');
    expect(createSignedUploadUrl).toHaveBeenCalledWith(result.path);
  });

  it('attaches signed URLs to claim photos when retrieving claims', async () => {
    const customers = fluentResult({ id: 'customer-1' });
    const claims = fluentResult({
      id: 'claim-1',
      customer_id: 'customer-1',
      status: 'submitted',
      customer_claim_photos: [
        { id: 'photo-1', storage_path: 'profile-1/claim-1/photo.webp' },
      ],
    });
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/photo.webp?signed=1' },
      error: null,
    });
    const bucket = jest.fn(() => ({ createSignedUrl }));
    const service = new ClaimsService({
      admin: {
        from: jest.fn((table: string) =>
          table === 'customers' ? customers : claims,
        ),
        storage: { from: bucket },
      },
    } as any);

    const result = await service.getOne('profile-1', 'claim-1');
    expect(result.customer_claim_photos[0].signedUrl).toBe(
      'https://storage.example.com/photo.webp?signed=1',
    );
  });
});
