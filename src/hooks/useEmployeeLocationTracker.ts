import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { adminApi } from '../services/api';

/**
 * Hook to automatically track and sync employee/staff GPS coordinates to the backend.
 * Required for all staff (EMPLOYEE & SUPER_ADMIN) so Super Admin can monitor employee locations.
 */
export const useEmployeeLocationTracker = () => {
  const { user } = useAuth();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isTrackingRef = useRef<boolean>(false);

  useEffect(() => {
    // Only track if logged in as staff (role === 'admin')
    if (!user || user.role !== 'admin') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const sendLocationUpdate = async () => {
      if (isTrackingRef.current) return;
      isTrackingRef.current = true;

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('[LocationTracker] Location permission not granted by staff member.');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (location && location.coords) {
          const { latitude, longitude, accuracy } = location.coords;

          // Optional reverse geocode for a human-readable address
          let address = '';
          try {
            const geocoded = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (geocoded && geocoded.length > 0) {
              const place = geocoded[0];
              const parts = [
                place.name,
                place.street,
                place.district,
                place.city,
                place.region,
                place.postalCode,
              ].filter(Boolean);
              address = parts.join(', ');
            }
          } catch (geoErr) {
            // Reverse geocode failed or offline, ignore and send raw coords
          }

          await adminApi.updateEmployeeLocation({
            latitude,
            longitude,
            accuracy: accuracy ?? undefined,
            address: address || undefined,
          });
          console.log(`[LocationTracker] Updated location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        }
      } catch (err: any) {
        console.warn('[LocationTracker] Failed to update location:', err.message || err);
      } finally {
        isTrackingRef.current = false;
      }
    };

    // Initial update on mount / login
    sendLocationUpdate();

    // Schedule regular updates every 1 minute (60,000 ms)
    intervalRef.current = setInterval(sendLocationUpdate, 1 * 60 * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [user?.id, user?.role]);
};
