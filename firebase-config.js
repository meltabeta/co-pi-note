import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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

// Improved location tracking with battery optimization
function trackUserLocation(user) {
    if (!navigator.geolocation) return;

    // Store user info securely
    const userData = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        lastUpdate: Date.now()
    };
    localStorage.setItem('tracking_user', JSON.stringify(userData));

    // Battery-aware tracking intervals
    let updateInterval = 30000; // 30 seconds default

    if ('getBattery' in navigator) {
        navigator.getBattery().then(battery => {
            // Adjust interval based on battery level
            updateInterval = battery.level > 0.5 ? 30000 : 60000;
            
            // Listen for battery changes
            battery.addEventListener('levelchange', () => {
                updateInterval = battery.level > 0.5 ? 30000 : 60000;
            });
        });
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: updateInterval / 2
    };

    // Use both watchPosition and setInterval for redundancy
    const watchId = navigator.geolocation.watchPosition(
        handleLocationUpdate,
        handleLocationError,
        options
    );

    const intervalId = setInterval(() => {
        navigator.geolocation.getCurrentPosition(
            handleLocationUpdate,
            handleLocationError,
            options
        );
    }, updateInterval);

    // Store IDs for cleanup
    localStorage.setItem('location_watch_id', watchId);
    localStorage.setItem('location_interval_id', intervalId);

    return { watchId, intervalId };
}

// Improved location update handler
function handleLocationUpdate(position) {
    const user = auth.currentUser;
    if (!user) return;

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
            online: navigator.onLine
        }
    };

    // Store locally first
    storeLocationLocally(user.uid, locationData);

    // Update Firebase if online
    if (navigator.onLine) {
        updateLocation(user.uid, locationData);
    }
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
