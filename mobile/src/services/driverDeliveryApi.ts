import {
  launchCamera,
  launchImageLibrary,
  type Asset,
} from 'react-native-image-picker';
import {apiRequest} from './api';
import {deviceReachableUploadUrl} from './claimsApi';

export type DeliveryPhoto = {uri: string; name: string; type: string};

export async function chooseDeliveryPhoto(
  source: 'camera' | 'library',
): Promise<DeliveryPhoto | null> {
  const options = {
    mediaType: 'photo' as const,
    quality: 0.8 as const,
    assetRepresentationMode: 'compatible' as const,
  };
  const result =
    source === 'camera'
      ? await launchCamera(options)
      : await launchImageLibrary({...options, selectionLimit: 1});
  if (result.didCancel) return null;
  if (result.errorCode === 'camera_unavailable') {
    throw new Error(
      'Camera is unavailable on this device. Choose a photo from your phone instead.',
    );
  }
  if (result.errorCode === 'permission') {
    throw new Error(
      source === 'camera'
        ? 'Allow camera access in Settings, then try again.'
        : 'Allow photo library access in Settings, then try again.',
    );
  }
  if (result.errorCode) {
    throw new Error(
      result.errorMessage ||
        (source === 'camera'
          ? 'Unable to take delivery photograph.'
          : 'Unable to choose delivery photograph.'),
    );
  }
  const asset: Asset | undefined = result.assets?.[0];
  if (!asset?.uri) throw new Error('Select a delivery photograph.');
  if (source === 'camera') {
    const baseName = (asset.fileName || `delivery-${Date.now()}`).replace(
      /\.[^.]+$/,
      '',
    );
    return {uri: asset.uri, name: `${baseName}.jpg`, type: 'image/jpeg'};
  }
  const type = asset.type === 'image/jpg' ? 'image/jpeg' : asset.type;
  if (
    !asset.fileName ||
    !type ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(type)
  ) {
    throw new Error('Choose a JPG, PNG, or WEBP delivery photograph.');
  }
  return {uri: asset.uri, name: asset.fileName, type};
}

export const captureDeliveryPhoto = () => chooseDeliveryPhoto('camera');

export async function uploadDeliveryPhoto(token: string, orderId: string, photo: DeliveryPhoto) {
  if (!photo.uri || !photo.name || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) {
    throw new Error('Choose a JPG, PNG, or WEBP delivery photograph.');
  }
  const upload = await apiRequest<{path: string; signedUrl: string}>(
    `/orders/${encodeURIComponent(orderId)}/delivery-proof/upload-url`,
    {method: 'POST', accessToken: token, body: {fileName: photo.name}},
  );
  if (!upload.path?.startsWith(`${orderId}/`) || !upload.signedUrl) throw new Error('Unable to prepare delivery proof upload.');
  const localFile = await fetch(photo.uri);
  if (!localFile.ok) throw new Error('Unable to read the delivery photograph.');
  const response = await fetch(deviceReachableUploadUrl(upload.signedUrl), {
    method: 'PUT', headers: {'Content-Type': photo.type}, body: await localFile.blob(),
  });
  if (!response.ok) throw new Error('Delivery photograph upload failed. Please retry.');
  return upload.path;
}

export function completeDriverDelivery(token: string, orderId: string, otp: string, photoPath?: string) {
  const code = otp.trim();
  if (!code || !/^\d{6}$/.test(code)) return Promise.reject(new Error('Enter the delivery OTP.'));
  return apiRequest<{delivered: boolean; orderStatus: string}>(
    `/orders/${encodeURIComponent(orderId)}/complete-delivery`,
    {method: 'POST', accessToken: token, body: {otp: code, ...(photoPath ? { photoPath } : {})}},
  );
}
