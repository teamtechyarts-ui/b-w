import {launchCamera, launchImageLibrary, type Asset} from 'react-native-image-picker';
import {apiRequest} from './api';
import {DEV_IOS_STORAGE_ORIGIN} from '../config/environment';
import {compressClaimPhoto, MAX_CLAIM_PHOTO_BYTES} from '../utils/imageCompression';

export type ClaimType = 'damage' | 'missing_item' | 'quality' | 'delivery' | 'other';
export const CLAIM_TYPES: ReadonlyArray<{value: ClaimType; label: string}> = [
  {value: 'damage', label: 'Damaged'},
  {value: 'missing_item', label: 'Missing item'},
  {value: 'quality', label: 'Wrong item or quality'},
  {value: 'delivery', label: 'Delivery issue'},
  {value: 'other', label: 'Other'},
];

export type CustomerClaimPhotoRecord = {
  id: string;
  claim_id: string;
  storage_path: string;
  signedUrl?: string;
  created_at: string;
  uploaded_by?: string;
};

export type CustomerClaim = {
  id: string;
  status: string;
  claim_type: ClaimType;
  description: string;
  created_at: string;
  customer_claim_photos?: CustomerClaimPhotoRecord[];
};

export type ClaimPhoto = {
  uri: string;
  name: string;
  type: string;
  size?: number;
  blob?: Blob;
};

export function canRaiseClaim(status: string, deadline?: string | null) {
  return (
    status === 'claim_period_active' &&
    Boolean(deadline && Date.parse(deadline) > Date.now())
  );
}

export async function getOrderClaims(token: string, orderId: string) {
  const claims = await apiRequest<CustomerClaim[]>(`/orders/${orderId}/claims`, {
    accessToken: token,
  });
  if (!Array.isArray(claims)) throw new Error('Unable to load claims.');
  return claims;
}

function newRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, digit => {
    const random = Math.floor(Math.random() * 16);
    return (digit === 'x' ? random : (random % 4) + 8).toString(16);
  });
}

export async function createClaim(
  token: string,
  orderId: string,
  claimType: ClaimType,
  description: string,
  clientRequestId = newRequestId(),
) {
  const trimmed = description.trim();
  if (!CLAIM_TYPES.some(option => option.value === claimType)) {
    throw new Error('Select a claim reason.');
  }
  if (trimmed.length < 10 || trimmed.length > 4000) {
    throw new Error('Describe the issue in 10 to 4000 characters.');
  }
  return apiRequest<CustomerClaim>(`/orders/${orderId}/claims`, {
    method: 'POST',
    accessToken: token,
    body: {clientRequestId, claimType, description: trimmed},
  });
}

export async function chooseClaimPhotos(
  source: 'library' | 'camera' = 'library',
  maxSelection = 5,
): Promise<ClaimPhoto[]> {
  const options = {
    mediaType: 'photo' as const,
    maxWidth: 1280,
    maxHeight: 1280,
    quality: 0.8 as const,
    assetRepresentationMode: 'compatible' as const,
    includeBase64: true,
  };

  const result =
    source === 'camera'
      ? await launchCamera(options)
      : await launchImageLibrary({...options, selectionLimit: maxSelection});

  if (result.didCancel || !result.assets || result.assets.length === 0) return [];

  if (result.errorCode === 'camera_unavailable') {
    throw new Error('Camera access is required to take a claim photo.');
  }
  if (result.errorCode === 'permission') {
    throw new Error(
      source === 'camera'
        ? 'Camera access is required to take a claim photo.'
        : 'Photo library permission was denied. Please allow photo access in Settings.',
    );
  }
  if (result.errorCode) {
    throw new Error(result.errorMessage || 'Unable to capture or select photograph.');
  }

  const photos: ClaimPhoto[] = [];
  for (const asset of result.assets) {
    if (!asset.uri) continue;

    console.log('[CLAIM_UPLOAD_TRACE] PICKER_SELECTED', {
      name: asset.fileName || (source === 'camera' ? 'camera-photo.jpg' : 'gallery-photo.jpg'),
      type: asset.type || 'image/jpeg',
      size: asset.fileSize || 0,
    });

    const rawName = asset.fileName || (source === 'camera' ? `claim-camera-${Date.now()}` : `claim-${Date.now()}`);
    const baseName = rawName.replace(/\.[^.]+$/, '');
    const type = asset.type === 'image/jpg' ? 'image/jpeg' : asset.type;
    if (type && !['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      throw new Error('Select a JPG, PNG, or WEBP photograph.');
    }

    console.log('[CLAIM_UPLOAD_TRACE] COMPRESSION_START', {
      originalSize: asset.fileSize || 0,
      originalType: asset.type || 'image/jpeg',
    });

    // Compress & convert to WebP ensuring size < 80 KB
    const compressed = await compressClaimPhoto(asset.uri, `${baseName}.webp`, asset.fileSize);

    photos.push({
      uri: compressed.uri,
      name: compressed.name,
      type: 'image/webp',
      size: compressed.size,
      blob: compressed.blob,
    });
  }

  return photos;
}

export async function chooseClaimPhoto(
  source: 'library' | 'camera' = 'library',
): Promise<ClaimPhoto | null> {
  const photos = await chooseClaimPhotos(source, 1);
  return photos[0] || null;
}

export async function uploadClaimPhoto(
  token: string,
  claimId: string,
  photo: ClaimPhoto,
) {
  // Ensure WebP name format
  const fileName = photo.name.toLowerCase().endsWith('.webp')
    ? photo.name
    : `${photo.name.replace(/\.[^.]+$/, '')}.webp`;

  console.log('[CLAIM_UPLOAD_TRACE] REQUEST_UPLOAD_URL_START', {claimId, fileName});

  let upload: {path: string; signedUrl: string};
  try {
    upload = await apiRequest<{path: string; signedUrl: string}>(
      `/claims/${claimId}/photos/upload-url`,
      {
        method: 'POST',
        accessToken: token,
        body: {fileName},
      },
    );
  } catch (err: any) {
    console.error('[CLAIM_UPLOAD_TRACE] ERROR', {
      stage: 'REQUEST_UPLOAD_URL',
      name: err?.name,
      message: err?.message,
    });
    throw new Error(err?.message || 'Unable to prepare your photo upload. Please try again.');
  }

  if (!upload?.path || !upload?.signedUrl) {
    throw new Error('Unable to prepare your photo upload. Please try again.');
  }

  console.log('[CLAIM_UPLOAD_TRACE] REQUEST_UPLOAD_URL_RESULT', {
    httpStatus: 200,
    success: true,
    storagePath: upload.path,
  });

  let blob: Blob;
  if (photo.blob instanceof Blob) {
    blob = photo.blob;
  } else {
    try {
      const localFile = await fetch(photo.uri);
      blob = await localFile.blob();
    } catch {
      throw new Error('Unable to read the selected photograph.');
    }
  }

  if (blob.size === 0) {
    throw new Error('Selected photograph is empty (0 bytes).');
  }

  if (blob.size > MAX_CLAIM_PHOTO_BYTES) {
    throw new Error('This photo could not be compressed below 80 KB. Please choose another photo.');
  }

  console.log('[CLAIM_UPLOAD_TRACE] STORAGE_PUT_START', {
    bytes: blob.size,
    contentType: 'image/webp',
    storagePath: upload.path,
  });

  let response: Response;
  try {
    response = await fetch(deviceReachableUploadUrl(upload.signedUrl), {
      method: 'PUT',
      headers: {'Content-Type': 'image/webp'},
      body: blob,
    });
  } catch (err: any) {
    console.error('[CLAIM_UPLOAD_TRACE] ERROR', {
      stage: 'STORAGE_PUT',
      name: err?.name,
      message: err?.message,
    });
    throw new Error('Photograph upload failed. Please retry.');
  }

  console.log('[CLAIM_UPLOAD_TRACE] STORAGE_PUT_RESULT', {
    httpStatus: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    console.error('[CLAIM_UPLOAD_TRACE] ERROR', {
      stage: 'STORAGE_PUT',
      httpStatus: response.status,
      message: response.statusText,
    });
    throw new Error('Photograph upload failed. Please retry.');
  }

  console.log('[CLAIM_UPLOAD_TRACE] ATTACH_START', {storagePath: upload.path});

  let attachResult: any;
  try {
    attachResult = await apiRequest(`/claims/${claimId}/photos`, {
      method: 'POST',
      accessToken: token,
      body: {photoPath: upload.path},
    });
  } catch (err: any) {
    console.error('[CLAIM_UPLOAD_TRACE] ERROR', {
      stage: 'ATTACH',
      name: err?.name,
      message: err?.message,
    });
    throw new Error('Unable to attach claim photograph. Please try again.');
  }

  console.log('[CLAIM_UPLOAD_TRACE] ATTACH_RESULT', {
    httpStatus: 200,
    success: true,
  });

  return attachResult;
}

export function deviceReachableUploadUrl(
  signedUrl: string,
  localOrigin = DEV_IOS_STORAGE_ORIGIN,
) {
  if (!localOrigin || !signedUrl) return signedUrl;
  return signedUrl.replace(
    /^http:\/\/(?:127\.0\.0\.1|localhost):54321(?=\/)/,
    localOrigin,
  );
}
