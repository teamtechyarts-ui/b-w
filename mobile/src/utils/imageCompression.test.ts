import {
  compressClaimPhoto,
  MAX_CLAIM_PHOTO_BYTES,
  MAX_PHOTO_DIMENSION,
} from './imageCompression';

describe('imageCompression utility', () => {
  it('enforces maximum allowed size constant of 80 KB (81,920 bytes)', () => {
    expect(MAX_CLAIM_PHOTO_BYTES).toBe(81920);
    expect(MAX_PHOTO_DIMENSION).toBe(1280);
  });

  it('rejects empty or missing URI', async () => {
    await expect(compressClaimPhoto('')).rejects.toThrow('No image URI provided');
  });

  it('converts JPEG filename to WebP format', async () => {
    const result = await compressClaimPhoto('file:///sample.jpg', 'damage_photo.jpg', 60000);
    expect(result.type).toBe('image/webp');
    expect(result.name).toBe('damage_photo.webp');
    expect(result.size).toBeLessThanOrEqual(MAX_CLAIM_PHOTO_BYTES);
  });

  it('converts PNG filename to WebP format', async () => {
    const result = await compressClaimPhoto('file:///sample.png', 'receipt_snapshot.PNG', 75000);
    expect(result.type).toBe('image/webp');
    expect(result.name).toBe('receipt_snapshot.webp');
    expect(result.size).toBeLessThanOrEqual(MAX_CLAIM_PHOTO_BYTES);
  });

  it('cleans special characters from output file name and converts to webp', async () => {
    const result = await compressClaimPhoto('file:///photo.jpg', 'my photo (1)! @test.jpeg', 50000);
    expect(result.name).toBe('my_photo__1____test.webp');
    expect(result.type).toBe('image/webp');
  });
});
