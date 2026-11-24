import { useEffect, useState } from 'react';
import { useShareIntent } from 'expo-share-intent';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

const isExpoGo =
  Constants.appOwnership === 'expo' ||
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export interface SharedImagePayload {
  uri: string;
  mimeType?: string;
  fileName?: string;
}

export function useShareIntentListener() {
  const [sharedImage, setSharedImage] = useState<SharedImagePayload | null>(null);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    disabled: isExpoGo,
    resetOnBackground: false,
  });

  useEffect(() => {
    if (!isExpoGo && hasShareIntent && shareIntent) {
      if (shareIntent.files && shareIntent.files.length > 0) {
        const file = shareIntent.files[0];
        const rawUri =
          file.path ||
          (file as any).filePath ||
          (file as any).contentUri ||
          null;

        if (rawUri) {
          (async () => {
            let safeUri = rawUri;
            if (rawUri.startsWith('content://')) {
              try {
                const ext = file.fileName ? file.fileName.split('.').pop() : 'jpg';
                const dest = `${FileSystem.cacheDirectory}shared_screenshot_${Date.now()}.${ext || 'jpg'}`;
                await FileSystem.copyAsync({ from: rawUri, to: dest });
                safeUri = dest;
              } catch (copyErr) {
                console.warn('Error caching shared intent content URI:', copyErr);
              }
            }

            setSharedImage({
              uri: safeUri,
              mimeType: file.mimeType,
              fileName: file.fileName,
            });
            resetShareIntent();
          })();
        }
      }
    }
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  const clearSharedImage = () => {
    setSharedImage(null);
  };

  return {
    sharedImage,
    clearSharedImage,
  };
}
