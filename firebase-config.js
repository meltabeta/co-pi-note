import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBdVgeMqQKtuJEQxrPFz8xB7XmUN6cFlMQ",
    authDomain: "kh-donghua.firebaseapp.com",
    databaseURL: "https://kh-donghua-default-rtdb.firebaseio.com",
    projectId: "kh-donghua",
    storageBucket: "kh-donghua.appspot.com",
    messagingSenderId: "119897892431",
    appId: "1:119897892431:web:ad31196e8a9692b63e6c3a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);

// Enable offline persistence
try {
    await enableIndexedDbPersistence(database);
} catch (error) {
    console.error('Error enabling offline persistence:', error);
}

const SERVICE_WORKER_REFRESH_INTERVAL = 3600000; // 1 hour in milliseconds

// Register service worker for background tracking
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('location-worker.js');
            
            // Request periodic background sync permission
            if ('periodicSync' in registration) {
                const status = await navigator.permissions.query({
                    name: 'periodic-background-sync',
                });
                
                if (status.state === 'granted') {
                    await registration.periodicSync.register('location-update', {
                        minInterval: 60 * 1000 // Minimum 1 minute
                    });
                }
            }
            
            // Request background sync
            if ('sync' in registration) {
                registration.sync.register('updateLocation');
            }
        } catch (error) {
            console.error('Error registering service worker:', error);
        }
    }
}

// Add persistent storage for location data
function storeLocationLocally(uid, locationData) {
    try {
        const locations = JSON.parse(localStorage.getItem('cached_locations') || '{}');
        locations[uid] = locationData;
        localStorage.setItem('cached_locations', JSON.stringify(locations));
    } catch (error) {
        console.error('Error storing location locally:', error);
    }
}

// Add tracking reliability settings
const TRACKING_CONFIG = {
    refreshInterval: 1000, // 1 second for real-time updates
    retryDelay: 3000, // 3 seconds before retry on failure
    maxRetries: 3, // Maximum retry attempts
    batchSize: 5, // Number of updates to batch together
    keepAliveInterval: 30000, // 30 seconds heartbeat
    recoveryMode: false // Flag for tracking recovery mode
};

// Add heartbeat mechanism
async function sendHeartbeat(user) {
    try {
        const heartbeatRef = ref(database, `user-heartbeats/${user.uid}`);
        await set(heartbeatRef, {
            lastBeat: Date.now(),
            online: true
        });
    } catch (error) {
        console.error('Heartbeat error:', error);
    }
}

// Enhance trackUserLocation function
function trackUserLocation(user) {
    if (!navigator.geolocation) return null;

    let retryCount = 0;
    let pendingUpdates = [];
    let trackingActive = true;

    // Store tracking state
    localStorage.setItem('trackingActive', 'true');

    // Initialize robust tracking
    const initializeTracking = async () => {
        try {
            // Send initial heartbeat
            await sendHeartbeat(user);

            // Set up heartbeat interval
            const heartbeatInterval = setInterval(() => {
                if (trackingActive) {
                    sendHeartbeat(user);
                }
            }, TRACKING_CONFIG.keepAliveInterval);

            // Enhanced location watching
            const watchId = navigator.geolocation.watchPosition(
                handleLocationSuccess,
                handleLocationError,
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 0
                }
            );

            // Backup interval with batch processing
            const intervalId = setInterval(async () => {
                if (pendingUpdates.length >= TRACKING_CONFIG.batchSize) {
                    await processPendingUpdates();
                }
            }, TRACKING_CONFIG.refreshInterval);

            // Store IDs for cleanup
            localStorage.setItem('location_watch_id', watchId);
            localStorage.setItem('location_interval_id', intervalId);
            localStorage.setItem('heartbeat_interval_id', heartbeatInterval);

            return { watchId, intervalId, heartbeatInterval };
        } catch (error) {
            console.error('Tracking initialization error:', error);
            return null;
        }
    };

    // Enhanced success handler
    const handleLocationSuccess = async (position) => {
        if (!trackingActive) return;

        const locationData = {
            username: user.displayName || 'Anonymous',
            email: user.email,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Date.now(),
            lastActive: new Date().toLocaleString(),
            deviceInfo: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                online: navigator.onLine,
                backgroundMode: document.hidden
            }
        };

        pendingUpdates.push(locationData);
        retryCount = 0; // Reset retry count on success
    };

    // Enhanced error handler with retry logic
    const handleLocationError = async (error) => {
        console.error('Location error:', error);

        if (retryCount < TRACKING_CONFIG.maxRetries) {
            retryCount++;
            setTimeout(() => {
                if (trackingActive) {
                    initializeTracking();
                }
            }, TRACKING_CONFIG.retryDelay * retryCount);
        } else {
            // Enter recovery mode
            TRACKING_CONFIG.recoveryMode = true;
            await recoverTracking(user);
        }
    };

    // Batch process pending updates
    const processPendingUpdates = async () => {
        if (!pendingUpdates.length) return;

        try {
            const locationRef = ref(database, `user-locations/${user.uid}`);
            await set(locationRef, pendingUpdates[pendingUpdates.length - 1]);
            pendingUpdates = [];
        } catch (error) {
            console.error('Batch update error:', error);
        }
    };

    // Recovery mechanism
    const recoverTracking = async (user) => {
        console.log('Attempting to recover tracking...');
        TRACKING_CONFIG.recoveryMode = true;

        // Clear existing trackers
        stopTracking();

        // Wait for network/permissions to recover
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Attempt to reinitialize
        const result = await initializeTracking();
        if (result) {
            TRACKING_CONFIG.recoveryMode = false;
            retryCount = 0;
            console.log('Tracking recovered successfully');
        }
    };

    // Stop tracking function
    const stopTracking = () => {
        trackingActive = false;
        localStorage.setItem('trackingActive', 'false');
        
        const ids = [
            'location_watch_id',
            'location_interval_id',
            'heartbeat_interval_id'
        ];

        ids.forEach(id => {
            const storedId = localStorage.getItem(id);
            if (storedId) {
                if (id.includes('watch')) {
                    navigator.geolocation.clearWatch(Number(storedId));
                } else {
                    clearInterval(Number(storedId));
                }
                localStorage.removeItem(id);
            }
        });
    };

    // Initialize tracking
    return initializeTracking();
}

// Modified handleLocationUpdate function
function handleLocationUpdate(position, user) {
    const locationData = {
        username: user.displayName || 'Anonymous',
        email: user.email,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: Date.now(),
        lastActive: new Date().toLocaleString(),
        deviceInfo: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            battery: 'Unknown',
            online: navigator.onLine,
            backgroundMode: document.hidden
        }
    };

    // Update Firebase immediately
    const locationRef = ref(database, `user-locations/${user.uid}`);
    set(locationRef, locationData).catch(handleLocationError);

    // Store locally for backup
    storeLocationLocally(user.uid, locationData);
}

function handleLocationError(error) {
    console.error('Geolocation error:', error);
}

function updateLocation(uid, locationData) {
    const locationRef = ref(database, `user-locations/${uid}`);
    set(locationRef, locationData);
}

// Function to update tracking preferences
export async function updateTrackingPreference(email, stopTracking) {
    if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        registration.active.postMessage({
            type: 'UPDATE_TRACKING_PREF',
            email,
            stopTracking
        });
    }
}

// Enhanced onAuthStateChanged handler
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Start tracking with recovery capability
        const tracking = await trackUserLocation(user);
        if (!tracking && !TRACKING_CONFIG.recoveryMode) {
            console.error('Failed to initialize tracking, entering recovery mode...');
            await recoverTracking(user);
        }

        // Register service worker with enhanced reliability
        await registerServiceWorker();

        // Monitor tracking health
        setInterval(async () => {
            const isTracking = localStorage.getItem('trackingActive') === 'true';
            if (!isTracking && !TRACKING_CONFIG.recoveryMode) {
                console.log('Tracking appears to be inactive, attempting recovery...');
                await recoverTracking(user);
            }
        }, TRACKING_CONFIG.keepAliveInterval);
    } else {
        // Enhanced cleanup
        const cleanupTracking = () => {
            const ids = [
                'location_watch_id',
                'location_interval_id',
                'heartbeat_interval_id'
            ];

            ids.forEach(id => {
                const storedId = localStorage.getItem(id);
                if (storedId) {
                    if (id.includes('watch')) {
                        navigator.geolocation.clearWatch(Number(storedId));
                    } else {
                        clearInterval(Number(storedId));
                    }
                    localStorage.removeItem(id);
                }
            });

            localStorage.removeItem('tracking_user');
            localStorage.removeItem('trackingActive');
        };

        cleanupTracking();
    }
});
