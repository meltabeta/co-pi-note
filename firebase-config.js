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

// Register service worker for background tracking
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('location-worker.js')
    .then((registration) => {
        console.log('Service Worker registered');
    })
    .catch((error) => {
        console.error('Service Worker registration failed:', error);
    });
}

// Track user location with improved accuracy and persistence
function trackUserLocation(user) {
    if (!navigator.geolocation) {
        console.error('Geolocation is not supported');
        return;
    }

    // Store user info in localStorage for persistence
    localStorage.setItem('tracking_user', JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName
    }));

    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };

    // Background tracking using Geolocation API
    const watchId = navigator.geolocation.watchPosition(
        (position) => {
            const locationData = {
                username: user.displayName || 'Anonymous',
                email: user.email,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                lastActive: new Date().toLocaleString(),
                accuracy: position.coords.accuracy,
                timestamp: Date.now(),
                deviceInfo: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform,
                    battery: 'Unknown'
                }
            };

            // Get battery status if available
            if ('getBattery' in navigator) {
                navigator.getBattery().then(battery => {
                    locationData.deviceInfo.battery = `${battery.level * 100}%`;
                    updateLocation(user.uid, locationData);
                });
            } else {
                updateLocation(user.uid, locationData);
            }
        },
        (error) => console.error('Geolocation error:', error),
        options
    );

    // Store watchId for cleanup
    localStorage.setItem('location_watch_id', watchId);
    return watchId;
}

function updateLocation(uid, locationData) {
    const locationRef = ref(database, `user-locations/${uid}`);
    set(locationRef, locationData);
}

// Handle user authentication changes
onAuthStateChanged(auth, (user) => {
    if (user) {
        trackUserLocation(user);
    } else {
        // Cleanup when user logs out
        const watchId = localStorage.getItem('location_watch_id');
        if (watchId) {
            navigator.geolocation.clearWatch(Number(watchId));
            localStorage.removeItem('location_watch_id');
            localStorage.removeItem('tracking_user');
        }
    }
});
