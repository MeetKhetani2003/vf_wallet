import React, { useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useShareIntentListener } from '../../hooks/useShareIntentListener';
import { navigationRef } from '../../navigation/navigationRef';

export const GlobalShareIntentHandler: React.FC = () => {
  const { user, role, isLoading } = useAuth();
  const { sharedImage, clearSharedImage } = useShareIntentListener();
  const pendingImageUri = useRef<string | null>(null);

  const handleNavigation = (uri: string) => {
    if (!navigationRef.isReady()) {
      // Retry if navigation container is not mounted yet
      setTimeout(() => handleNavigation(uri), 150);
      return;
    }

    if (role === 'admin') {
      navigationRef.navigate('ClientOcrDeposit', {
        imageUri: uri,
        initialMode: 'ocr',
        source: 'gallery',
        sharedAt: Date.now(),
      });
    } else {
      navigationRef.navigate('OcrProcessing', {
        imageUri: uri,
        source: 'gallery',
      });
    }
  };

  // If a shared image arrives
  useEffect(() => {
    if (sharedImage && sharedImage.uri) {
      const uri = sharedImage.uri;
      clearSharedImage();

      if (!user || isLoading) {
        // User not logged in yet: save until user logs in
        pendingImageUri.current = uri;
        return;
      }

      // User logged in: navigate immediately to deposit OCR scan
      handleNavigation(uri);
    }
  }, [sharedImage, user, isLoading]);

  // When user logs in, check for pending shared image
  useEffect(() => {
    if (user && !isLoading && pendingImageUri.current) {
      const uri = pendingImageUri.current;
      pendingImageUri.current = null;
      handleNavigation(uri);
    }
  }, [user, isLoading, role]);

  return null;
};
