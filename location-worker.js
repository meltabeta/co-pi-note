const APP_VERSION = '1.0.0';
const CACHE_NAME = `note-app-cache-v${APP_VERSION}`;

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => {
            return caches.open(CACHE_NAME).then((cache) => {
                return cache.addAll([
                    '/',
                    '/index.html',
                    '/firebase-config.js'
                ]);
            });
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            clients.claim(),
            caches.keys().then(keys => {
                return Promise.all(
                    keys.map(key => {
                        if (key !== CACHE_NAME) {
                            return caches.delete(key);
                        }
                    })
                );
            })
        ])
    );
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

// More frequent background sync
const BACKGROUND_SYNC_INTERVAL = 1000; // 1 second

// Add continuous background updates
let backgroundUpdateInterval;

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
    if (event.data.type === 'START_TRACKING') {
        // Clear existing interval if any
        if (backgroundUpdateInterval) {
            clearInterval(backgroundUpdateInterval);
        }

        // Start continuous background updates
        backgroundUpdateInterval = setInterval(() => {
            updateLocationInBackground();
        }, BACKGROUND_SYNC_INTERVAL);

        // Register for periodic sync if supported
        if ('periodicSync' in registration) {
            registration.periodicSync.register('location-sync', {
                minInterval: BACKGROUND_SYNC_INTERVAL
            });
        }
    } else if (event.data.type === 'STOP_TRACKING') {
        if (backgroundUpdateInterval) {
            clearInterval(backgroundUpdateInterval);
        }
    }
});
