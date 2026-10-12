// Browser file picker and camera shim for react-native-image-picker
export type Asset = {
  uri: string;
  fileName?: string;
  fileSize?: number;
  type?: string;
  width?: number;
  height?: number;
  originalPath?: string;
};

export type ImagePickerResponse = {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: Asset[];
};

export type OptionsCommon = {
  mediaType: 'photo' | 'video' | 'mixed';
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  videoQuality?: 'low' | 'medium' | 'high';
  includeBase64?: boolean;
  includeExtra?: boolean;
  formatAs?: 'unchanged' | 'jpeg' | 'png';
  presentationStyle?:
    | 'currentContext'
    | 'pageSheet'
    | 'fullScreen'
    | 'formSheet'
    | 'popover'
    | 'overFullScreen'
    | 'overCurrentContext';
  assetRepresentationMode?: 'auto' | 'current' | 'compatible';
};

export type ImageLibraryOptions = OptionsCommon & {
  selectionLimit?: number;
};

export type CameraOptions = OptionsCommon & {
  durationLimit?: number;
  saveToPhotos?: boolean;
  cameraType?: 'back' | 'front';
};

function selectFileWeb(isCamera: boolean): Promise<ImagePickerResponse> {
  return new Promise(resolve => {
    if (typeof document === 'undefined') {
      resolve({didCancel: true});
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/*';
    if (isCamera) {
      input.setAttribute('capture', 'environment');
    }
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);

    let resolved = false;

    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    input.onchange = (event: any) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      const file: File | undefined = event.target?.files?.[0];
      if (!file) {
        resolve({didCancel: true});
        return;
      }

      const url = URL.createObjectURL(file);
      resolve({
        assets: [
          {
            uri: url,
            fileName: file.name,
            fileSize: file.size,
            type: file.type || 'image/jpeg',
            width: 1280,
            height: 960,
          },
        ],
      });
    };

    // Modern cancel event supported in Chrome 113+, Edge, Safari 16.4+
    input.addEventListener('cancel', () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({didCancel: true});
      }
    });

    input.click();
  });
}

/**
 * Capture photo via HTML5 getUserMedia in browser if webcam/camera is available
 */
async function captureWebCamera(): Promise<ImagePickerResponse> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    return selectFileWeb(true);
  }

  return new Promise(resolve => {
    let stream: MediaStream | null = null;
    let resolved = false;

    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.maxWidth = '600px';
    container.style.width = '90%';
    container.style.backgroundColor = '#1B1B18';
    container.style.borderRadius = '16px';
    container.style.overflow = 'hidden';
    container.style.padding = '16px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';

    const title = document.createElement('div');
    title.innerText = 'Take Claim Photo';
    title.style.color = '#FFFFFF';
    title.style.fontSize = '16px';
    title.style.fontWeight = '700';
    title.style.marginBottom = '12px';
    container.appendChild(title);

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.style.width = '100%';
    video.style.maxHeight = '380px';
    video.style.borderRadius = '8px';
    video.style.backgroundColor = '#000000';
    video.style.objectFit = 'cover';
    container.appendChild(video);

    const canvas = document.createElement('canvas');
    canvas.style.display = 'none';
    canvas.style.width = '100%';
    canvas.style.maxHeight = '380px';
    canvas.style.borderRadius = '8px';
    canvas.style.objectFit = 'cover';
    container.appendChild(canvas);

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '12px';
    controls.style.marginTop = '16px';
    controls.style.width = '100%';
    controls.style.justifyContent = 'center';
    container.appendChild(controls);

    const captureBtn = document.createElement('button');
    captureBtn.innerText = 'Capture Photo';
    captureBtn.style.backgroundColor = '#1F5849';
    captureBtn.style.color = '#FFFFFF';
    captureBtn.style.border = 'none';
    captureBtn.style.borderRadius = '8px';
    captureBtn.style.padding = '10px 20px';
    captureBtn.style.fontSize = '14px';
    captureBtn.style.fontWeight = '700';
    captureBtn.style.cursor = 'pointer';

    const cancelBtn = document.createElement('button');
    cancelBtn.innerText = 'Cancel';
    cancelBtn.style.backgroundColor = 'transparent';
    cancelBtn.style.color = '#E2DED6';
    cancelBtn.style.border = '1px solid #656159';
    cancelBtn.style.borderRadius = '8px';
    cancelBtn.style.padding = '10px 18px';
    cancelBtn.style.fontSize = '14px';
    cancelBtn.style.fontWeight = '600';
    cancelBtn.style.cursor = 'pointer';

    const retakeBtn = document.createElement('button');
    retakeBtn.innerText = 'Retake';
    retakeBtn.style.display = 'none';
    retakeBtn.style.backgroundColor = 'transparent';
    retakeBtn.style.color = '#E2DED6';
    retakeBtn.style.border = '1px solid #656159';
    retakeBtn.style.borderRadius = '8px';
    retakeBtn.style.padding = '10px 18px';
    retakeBtn.style.fontSize = '14px';
    retakeBtn.style.fontWeight = '600';
    retakeBtn.style.cursor = 'pointer';

    const useBtn = document.createElement('button');
    useBtn.innerText = 'Use Photo';
    useBtn.style.display = 'none';
    useBtn.style.backgroundColor = '#1F5849';
    useBtn.style.color = '#FFFFFF';
    useBtn.style.border = 'none';
    useBtn.style.borderRadius = '8px';
    useBtn.style.padding = '10px 20px';
    useBtn.style.fontSize = '14px';
    useBtn.style.fontWeight = '700';
    useBtn.style.cursor = 'pointer';

    controls.appendChild(cancelBtn);
    controls.appendChild(retakeBtn);
    controls.appendChild(captureBtn);
    controls.appendChild(useBtn);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    const cleanup = () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    };

    cancelBtn.onclick = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve({didCancel: true});
      }
    };

    captureBtn.onclick = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      video.style.display = 'none';
      canvas.style.display = 'block';
      captureBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      retakeBtn.style.display = 'inline-block';
      useBtn.style.display = 'inline-block';
    };

    retakeBtn.onclick = () => {
      canvas.style.display = 'none';
      video.style.display = 'block';
      captureBtn.style.display = 'inline-block';
      cancelBtn.style.display = 'inline-block';
      retakeBtn.style.display = 'none';
      useBtn.style.display = 'none';
    };

    useBtn.onclick = () => {
      if (resolved) return;
      resolved = true;
      canvas.toBlob(
        blob => {
          cleanup();
          if (!blob) {
            resolve({didCancel: true});
            return;
          }
          const url = URL.createObjectURL(blob);
          resolve({
            assets: [
              {
                uri: url,
                fileName: `claim-camera-${Date.now()}.webp`,
                fileSize: blob.size,
                type: 'image/webp',
                width: canvas.width,
                height: canvas.height,
              },
            ],
          });
        },
        'image/webp',
        0.8,
      );
    };

    // Request camera access
    navigator.mediaDevices
      .getUserMedia({
        video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 960}},
      })
      .then(s => {
        stream = s;
        video.srcObject = s;
      })
      .catch(err => {
        cleanup();
        // If camera denied or unavailable, fall back to file picker
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          resolve({
            errorCode: 'permission',
            errorMessage: 'Camera permission was denied. Please allow camera access in your browser.',
          });
        } else {
          selectFileWeb(true).then(resolve);
        }
      });
  });
}

export async function launchCamera(_options: CameraOptions): Promise<ImagePickerResponse> {
  return captureWebCamera();
}

export async function launchImageLibrary(
  _options: ImageLibraryOptions,
): Promise<ImagePickerResponse> {
  return selectFileWeb(false);
}

export default {
  launchCamera,
  launchImageLibrary,
};
