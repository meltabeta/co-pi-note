self.addEventListener('install', (event) => {
    self.skipWaiting();
    // Add cache storage for offline functionality
    event.waitUntil(
        caches.open('location-cache').then((cache) => {
            return cache.addAll([
                '/',
                '/index.html',
                '/firebase-config.js'
            ]);
        })
    );
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

// Add better error handling and retry logic
async function updateLocationInBackground() {
    const MAX_RETRIES = 3;
    let retries = 0;

    while (retries < MAX_RETRIES) {
        try {
            const userData = JSON.parse(localStorage.getItem('tracking_user'));
            if (!userData) return;

            const position = await getCurrentPositionWithTimeout(10000); // 10s timeout
            const locationData = {
                username: userData.displayName || 'Anonymous',
                email: userData.email,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                lastActive: new Date().toLocaleString(),
                accuracy: position.coords.accuracy,
                timestamp: Date.now(),
                fromBackground: true,
                retryCount: retries
            };

            // Use Firebase REST API for background updates
            const response = await fetch(`${firebaseConfig.databaseURL}/user-locations/${userData.uid}.json`, {
                method: 'PUT',
                body: JSON.stringify(locationData)
            });

            if (!response.ok) throw new Error('Network response was not ok');
            break; // Success, exit loop

        } catch (error) {
            retries++;
            await new Promise(resolve => setTimeout(resolve, 1000 * retries));
            console.error(`Background location update failed (attempt ${retries}):`, error);
        }
    }
}

// Add timeout promise for geolocation
function getCurrentPositionWithTimeout(timeout) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Geolocation timeout'));
        }, timeout);

        navigator.geolocation.getCurrentPosition(
            (position) => {
                clearTimeout(timeoutId);
                resolve(position);
            },
            (error) => {
                clearTimeout(timeoutId);
                reject(error);
            },
            { enableHighAccuracy: true, timeout, maximumAge: 0 }
        );
    });
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
