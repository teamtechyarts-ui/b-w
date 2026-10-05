// Browser file picker shim for react-native-image-picker
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
  presentationStyle?: 'currentContext' | 'pageSheet' | 'fullScreen' | 'formSheet' | 'popover' | 'overFullScreen' | 'overCurrentContext';
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
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/*';
    if (isCamera) {
      input.capture = 'environment';
    }

    let resolved = false;

    input.onchange = (event: any) => {
      resolved = true;
      const file = event.target?.files?.[0];
      if (!file) {
        resolve({ didCancel: true });
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
            width: 800,
            height: 600,
          },
        ],
      });
    };

    // Fallback if user closes the picker dialog
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!resolved) {
            resolve({ didCancel: true });
          }
        }, 800);
      },
      { once: true }
    );

    input.click();
  });
}

export async function launchCamera(_options: CameraOptions): Promise<ImagePickerResponse> {
  return selectFileWeb(true);
}

export async function launchImageLibrary(_options: ImageLibraryOptions): Promise<ImagePickerResponse> {
  return selectFileWeb(false);
}

export default {
  launchCamera,
  launchImageLibrary,
};
