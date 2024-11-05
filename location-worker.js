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

// Initialize IndexedDB
const dbName = 'locationDB';
const storeName = 'trackingPrefs';

// Open IndexedDB
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'email' });
            }
        };
    });
}

// Handle background sync
self.addEventListener('sync', (event) => {
    if (event.tag === 'updateLocation') {
        event.waitUntil(syncLocations());
    }
});

// Handle periodic background sync
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'location-update') {
        event.waitUntil(syncLocations());
    }
});

async function syncLocations() {
    const db = await openDB();
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const users = await store.getAll();

    for (const user of users) {
        if (!user.stopTracking) {
            try {
                const position = await getCurrentPosition();
                await updateUserLocation(user.email, position);
            } catch (error) {
                console.error('Error updating location:', error);
            }
        }
    }
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 0
        });
    });
}

// Handle messages from main thread
self.addEventListener('message', async (event) => {
    if (event.data.type === 'UPDATE_TRACKING_PREF') {
        const db = await openDB();
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        
        await store.put({
            email: event.data.email,
            stopTracking: event.data.stopTracking
        });
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
