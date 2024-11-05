self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

// Background sync for location updates
self.addEventListener('sync', (event) => {
    if (event.tag === 'location-update') {
        event.waitUntil(updateLocationInBackground());
    }
});

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'location-sync') {
        event.waitUntil(updateLocationInBackground());
    }
});

async function updateLocationInBackground() {
    try {
        // Get user data from localStorage
        const userData = JSON.parse(localStorage.getItem('tracking_user'));
        if (!userData) return;

        // Get current position
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });

        // Update location in Firebase
        const locationData = {
            username: userData.displayName || 'Anonymous',
            email: userData.email,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            lastActive: new Date().toLocaleString(),
            accuracy: position.coords.accuracy,
            timestamp: Date.now(),
            fromBackground: true
        };

        // Send to Firebase (you'll need to implement this part)
        await fetch('/update-location', {
            method: 'POST',
            body: JSON.stringify(locationData)
        });
    } catch (error) {
        console.error('Background location update failed:', error);
    }
}

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
    if (event.data.type === 'START_TRACKING') {
        // Register for periodic sync if supported
        if ('periodicSync' in registration) {
            registration.periodicSync.register('location-sync', {
                minInterval: 15 * 60 * 1000 // 15 minutes
            });
        }
    }
});
