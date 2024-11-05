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

// Track user location with improved accuracy and continuous tracking
function trackUserLocation(user) {
    if (!navigator.geolocation) {
        console.error('Geolocation is not supported by this browser');
        return;
    }

    // Options for better accuracy
    const options = {
        enableHighAccuracy: true,  // Use GPS if available
        timeout: 10000,           // 10 second timeout
        maximumAge: 0             // Always get fresh location
    };

    // Watch position instead of getting once
    const watchId = navigator.geolocation.watchPosition(
        (position) => {
            const locationRef = ref(database, `user-locations/${user.uid}`);
            set(locationRef, {
                username: user.displayName || 'Anonymous',
                email: user.email,
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                lastActive: new Date().toLocaleString(),
                accuracy: position.coords.accuracy,
                timestamp: Date.now(),
                deviceInfo: {
                    userAgent: navigator.userAgent,
                    platform: navigator.platform
                }
            });
        },
        (error) => {
            console.error('Geolocation error:', error.message);
            // Handle specific errors
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    console.error("User denied the request for Geolocation.");
                    break;
                case error.POSITION_UNAVAILABLE:
                    console.error("Location information is unavailable.");
                    break;
                case error.TIMEOUT:
                    console.error("The request to get user location timed out.");
                    break;
            }
        },
        options
    );

    // Store watchId for cleanup
    return watchId;
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        trackUserLocation(user);
    }
});
