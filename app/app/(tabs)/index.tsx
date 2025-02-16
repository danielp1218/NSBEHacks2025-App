// REPEATEDLY POLL FOR ALL OTHER INCIDENTS TO COMPARE DISTANCES TO SEE WHETHER NEED OT ALERT
// EVERY 5S

import { Platform, StyleSheet, View, } from 'react-native';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { useEffect, useState, useRef } from 'react';
import { Subscription } from 'expo-sensors/build/Pedometer';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, TextInput, Modal } from 'react-native';
import * as Contacts from 'expo-contacts';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  withSpring,
  useSharedValue,
  withRepeat
} from 'react-native-reanimated';
import * as Notifications from 'expo-notifications';
import { getDistance } from 'geolib';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ScrollView, TouchableOpacity } from 'react-native';
import { analyzeAudioInBackground } from '@/utils/openai';

export default function TabTwoScreen() {
  const [{ x, y, z }, setData] = useState({ x: 0, y: 0, z: 0 });
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const DEFAULT_PASSWORD = 'Guardian';
  const BASE_URL = 'https://nsbe-hacks-2025-dashboard.vercel.app/api';
  // ?lastPollTime=timestampms...
  // TODO
  const GET_INCIDENTS_ENDPOINT = `${BASE_URL}/get-new-incidents`;
  const GET_UNRESOLVED_INCIDENTS_ENDPOINT = `${BASE_URL}/get-unresolved-incidents`;
  // incidentName, victimName, incidentTime, gpsCoordinates, status, emergencyContacts:[{fullName:...,phoneNumber:...,email:...}] --------victimPhoneNumber??
  const CREATE_INCIDENT_ENDPOINT = `${BASE_URL}/create-incident`;
  // id, incidentEndTime
  const RESOLVE_INCIDENT_ENDPOINT = `${BASE_URL}/resolve-incident`;
  // id, status
  const UPDATE_INCIDENT_STATUS_ENDPOINT = `${BASE_URL}/update-incident-status`;
  // incidentId, gpsCoordinates, locationTime
  const ADD_INCIDENT_LOCATION_ENDPOINT = `${BASE_URL}/add-incident-location`;
  // incidentId, audioUri, audioDuration
  const ADD_INCIDENT_AUDIO_ENDPOINT = `${BASE_URL}/add-incident-audio`;
  // incidentId, sentiment, threatLevel, situationSummary, actionRecommendations, detectedSounds
  const SET_ANALYSIS_ENDPOINT = `${BASE_URL}/set-analysis`;

  // id, latitude, longitude


  const [recording, setRecording] = useState<Audio.Recording>(new Audio.Recording());
  const RECORDING_DURATION = 12000; // 12 seconds in milliseconds
  const [hasCreatedIncident, setHasCreatedIncident] = useState<boolean>(false);
  const [fullName, setFullName] = useState('');
  const [emergencyContacts, setEmergencyContacts] = useState<Contacts.Contact[]>([]);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [contactsList, setContactsList] = useState<Contacts.Contact[]>([]);

  // const _slow = () => Accelerometer.setUpdateInterval(1000);
  // const _fast = () => Accelerometer.setUpdateInterval(16);

  // Add near other state variables
  const [locationInterval, setLocationInterval] = useState<NodeJS.Timeout | null>(null);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const LOCATION_UPDATE_INTERVAL = 2000; // 2 seconds

  const pulseAnimation = useSharedValue(1);

  useEffect(() => {
    if (emergencyMode) {
      pulseAnimation.value = withRepeat(
        withSpring(1.2, { damping: 2, stiffness: 80 }),
        -1,
        true
      );
    } else {
      pulseAnimation.value = withSpring(1);
    }
  }, [emergencyMode]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnimation.value }]
  }));

  // Initialize audio recording permissions
  useEffect(() => {
    (async () => {
      // Set audio mode first
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });

      // Then request permissions
      Accelerometer.setUpdateInterval(350);
      await Audio.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();

      try {
        // Get initial location
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        if (!location || !location.coords || !location.coords.latitude || !location.coords.longitude) {
          throw new Error('Location data is missing');
        }
        setLocation(location);
      } catch (error) {
        const location = await Location.getLastKnownPositionAsync({
          requiredAccuracy: Location.Accuracy.Highest
        });
        if (!location || !location.coords || !location.coords.latitude || !location.coords.longitude) {
          try {
            const location = await Location.getLastKnownPositionAsync({
              requiredAccuracy: Location.Accuracy.High
            });
            setLocation(location);
          } catch (error) {
            console.error('Failed to get location:', error);
          }
        }
        setLocation(location);
      }
    })();
  }, []);

  // Update the recordAndSend function
  const recordAndSend = async (incidentId: string) => {
    try {
      // Make sure any existing recording is cleaned up
      if (recording) {
        try {
          await recording.stopAndUnloadAsync();
        } catch (error) {
          // Ignore errors, just ensure cleanup
          await recording._cleanupForUnloadedRecorder();
        }
      }

      // Create and set new recording
      const newRecording = new Audio.Recording();
      setRecording(newRecording);

      // Start new recording
      await newRecording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await newRecording.startAsync();
      setIsRecording(true);

      // Wait for full duration
      await new Promise(resolve => setTimeout(resolve, RECORDING_DURATION));

      try {
        try {
          await recording.stopAndUnloadAsync();
        } catch (error) {
          // Ignore errors, just ensure cleanup
          await recording._cleanupForUnloadedRecorder();
        }
        const uri = newRecording.getURI();

        if (incidentId && uri) {
          try {
            await analyzeAudioInBackground(uri, incidentId);
          } catch (error) {
            console.error('Error analyzing audio:', error);
          }
        }

        // Continue cycle if still in emergency mode
        if (emergencyMode) {
          recordAndSend(incidentId);
        } else {
          setIsRecording(false);
        }
      } catch (error) {
        console.error('Error stopping recording:', error);
        if (emergencyMode) {
          recordAndSend(incidentId);
        } else {
          setIsRecording(false);
        }
      }
    } catch (err) {
      console.error('Error in record and send cycle:', err);
      setIsRecording(false);
    }
  };

  // Function to start interval recording
  const startIntervalRecording = async () => {
    if (isRecording) return;

    try {
      // Send initial incident creation
      const response = await fetch(CREATE_INCIDENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incidentName: 'Attack',
          victimName: fullName || 'Unknown',
          incidentTime: Date.now(),
          gpsCoordinates: `${location?.coords.latitude || 43.6594719} ${location?.coords.longitude || -79.3978135}`,
          status: 'pending',
          emergencyContacts: emergencyContacts.map(contact => ({
            fullName: contact.name,
            phoneNumber: contact.phoneNumbers?.[0]?.number ?? null,
            email: contact.emails?.[0]?.email ?? null,
          })),
        }),
      });

      console.log(response.status)
      const data = await response.json();
      setIncidentId(data.id); // Store the incident ID
      console.log(data.id)

      // Start location tracking
      const locationTracker = setInterval(async () => {
        try {
          const currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High
          });

          // Send location update
          await fetch(ADD_INCIDENT_LOCATION_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              incidentId: data.id,
              // TODO
              gpsCoordinates: `${currentLocation?.coords.latitude || 43.6594719} ${currentLocation?.coords.longitude || -79.3978135}`,
              locationTimestamp: Date.now(),
            }),
          });

          setLocation(currentLocation);
        } catch (err) {
          console.error('Failed to update location:', err);
        }
      }, LOCATION_UPDATE_INTERVAL);

      setLocationInterval(locationTracker);

      // Start the recording cycle
      recordAndSend(data.id);
    } catch (err) {
      console.error('Failed to start incident:', err);
      throw err;
    }
  };

  // Function to start emergency recording
  const startEmergencyRecording = async () => {
    if (isRecording) return;

    try {
      // Send initial incident creation
      const response = await fetch(CREATE_INCIDENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incidentName: 'Attack',
          victimName: fullName || 'Unknown',
          incidentTime: Date.now(),
          gpsCoordinates: `${location?.coords.latitude || 43.6594719} ${location?.coords.longitude || -79.3978135}`,
          status: 'pending',
          emergencyContacts: emergencyContacts.map(contact => ({
            fullName: contact.name,
            phoneNumber: contact.phoneNumbers?.[0]?.number ?? null,
            email: contact.emails?.[0]?.email ?? null,
          })),
        }),
      });

      console.log(response.status)
      const data = await response.json();
      setIncidentId(data.id); // Store the incident ID
      console.log(data.id)

      // Start location tracking
      const locationTracker = setInterval(async () => {
        try {
          const currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High
          });

          // Send location update
          await fetch(ADD_INCIDENT_LOCATION_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              incidentId: data.id,
              // TODO
              gpsCoordinates: `${currentLocation?.coords.latitude || 43.6594719} ${currentLocation?.coords.longitude || -79.3978135}`,
              locationTimestamp: Date.now(),
            }),
          });

          setLocation(currentLocation);
        } catch (err) {
          console.error('Failed to update location:', err);
        }
      }, LOCATION_UPDATE_INTERVAL);

      setLocationInterval(locationTracker);

      // Start the recording cycle
      recordAndSend(data.id);
    } catch (err) {
      console.error('Failed to start incident:', err);
      throw err;
    }
  };

  // Function to stop recording and send emergency data
  const stopEmergencyRecording = async () => {
    if (!isRecording) return;

    try {
      // Stop location tracking
      if (locationInterval) {
        clearInterval(locationInterval);
        setLocationInterval(null);
      }

      // Stop recording
      await recording.stopAndUnloadAsync();
      await recording._cleanupForUnloadedRecorder();
      // @ts-ignore
      setRecording(undefined);
      const newRecording = new Audio.Recording();
      setRecording(newRecording);
      setIsRecording(false);

      // Mark incident as resolved if we have an ID
      if (incidentId) {
        await fetch(RESOLVE_INCIDENT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: incidentId,
            incidentEndTime: Date.now(),
          }),
        });
        setIncidentId(null);
      }
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
  };

  // Modify the existing accelerometer subscription to include emergency detection
  const _subscribe = () => {
    let localEmergencyMode = false; // Local tracking of emergency mode

    setSubscription(Accelerometer.addListener(({ x, y, z }) => {
      setData({ x, y, z });

      const acceleration = Math.sqrt(x * x + y * y + z * z);
      const isCurrentlyShaking = acceleration > 1.9;
      if (isCurrentlyShaking) {
        console.log('Shaking detected');
      }
      setIsShaking(isCurrentlyShaking);

      // If shaking is detected, enter emergency mode
      if (isCurrentlyShaking && !localEmergencyMode && !emergencyMode) {
        console.log('Entering emergency mode');
        localEmergencyMode = true;
        setEmergencyMode(true);
        startEmergencyRecording();
      } else if (!isCurrentlyShaking && localEmergencyMode) {
        // console.log('Exiting emergency mode');
        // localEmergencyMode = false;
        // setEmergencyMode(false);
        // stopEmergencyRecording();
      }
    }));
  };

  // Update the unsubscribe function
  const _unsubscribe = async () => {
    try {
      await recording.stopAndUnloadAsync();
      await recording._cleanupForUnloadedRecorder();
    } catch (err) {
      console.error('Failed to stop recording cleanup', err);
    }
    subscription?.remove();
    setSubscription(null);
    setEmergencyMode(false);
    setIsRecording(false);
  };

  useEffect(() => {
    _subscribe();
    return () => {
      if (isRecording) {
        recording.stopAndUnloadAsync().finally(() => {
          recording._cleanupForUnloadedRecorder();
        });
      }
      if (locationInterval) {
        clearInterval(locationInterval);
      }
      subscription?.remove();
      setSubscription(null);
      setEmergencyMode(false);
      setIsRecording(false);
      setLocationInterval(null);
    };
  }, []);

  useEffect(() => {
    checkPassword();
  }, []);

  useEffect(() => {
    loadUserName();
  }, []);

  useEffect(() => {
    loadEmergencyContacts();
  }, []);

  const checkPassword = async () => {
    const storedPassword = await AsyncStorage.getItem('emergencyPassword');
    if (!storedPassword) {
      // Set default password if none exists
      await AsyncStorage.setItem('emergencyPassword', DEFAULT_PASSWORD);
      setHasPassword(true);
    } else {
      setHasPassword(true);
    }
  };

  const handleSetPassword = async () => {
    try {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to set emergency password'
      });

      if (auth.success) {
        await AsyncStorage.setItem('emergencyPassword', password);
        setHasPassword(true);
        setShowPasswordModal(false);
        setPassword('');
      }
    } catch (err) {
      console.error('Failed to set password:', err);
    }
  };

  const handleImOk = async (attemptedPassword: string) => {
    const storedPassword = await AsyncStorage.getItem('emergencyPassword');
    if (attemptedPassword === storedPassword) {
      stopEmergencyRecording();
      setEmergencyMode(false);
      setShowPasswordModal(false);
      setPassword('');
    } else {
      Alert.alert('Incorrect Password', 'Please try again');
    }
  };

  const loadUserName = async () => {
    try {
      const storedName = await AsyncStorage.getItem('userName');
      if (storedName) {
        setFullName(storedName);
      }
    } catch (err) {
      console.error('Failed to load user name:', err);
    }
  };

  const handleSaveName = async (newName: string) => {
    try {
      await AsyncStorage.setItem('userName', newName);
      setFullName(newName);
    } catch (err) {
      console.error('Failed to save user name:', err);
    }
  };

  const loadEmergencyContacts = async () => {
    try {
      const storedContacts = await AsyncStorage.getItem('emergencyContacts');
      if (storedContacts) {
        setEmergencyContacts(JSON.parse(storedContacts));
      }
    } catch (err) {
      console.error('Failed to load emergency contacts:', err);
    }
  };

  const handlePickContact = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name, Contacts.Fields.Emails],
        });
        setContactsList(data);
        setShowContactsModal(true);
      } else {
        Alert.alert('Permission required', 'Please allow access to your contacts to add emergency contacts.');
      }
    } catch (err) {
      console.error('Error accessing contacts:', err);
    }
  };

  const saveEmergencyContacts = async (contacts: Contacts.Contact[]) => {
    try {
      await AsyncStorage.setItem('emergencyContacts', JSON.stringify(contacts));
      setEmergencyContacts(contacts);
    } catch (err) {
      console.error('Failed to save emergency contacts:', err);
    }
  };

  // Add new state for alarm
  const [alarmSound, setAlarmSound] = useState<Audio.Sound | null>(null);

  // Load alarm sound on mount
  useEffect(() => {
    // loadAlarmSound();
    // return () => {
    //   // Cleanup sound
    //   if (alarmSound) {
    //     alarmSound.unloadAsync();
    //   }
    // };
  }, []);

  // const loadAlarmSound = async () => {
  //   try {
  //     const { sound } = await Audio.Sound.createAsync(
  //       require('@/assets/sounds/alarm.mp3'),
  //       { 
  //         shouldPlay: false,
  //         isLooping: true,
  //         volume: 1.0 
  //       }
  //     );
  //     setAlarmSound(sound);
  //   } catch (error) {
  //     console.error('Failed to load alarm sound:', error);
  //   }
  // };

  // const playAlarm = async () => {
  //   try {
  //     if (alarmSound) {
  //       await alarmSound.setPositionAsync(0);
  //       await alarmSound.playAsync();
  //     }
  //   } catch (error) {
  //     console.error('Failed to play alarm:', error);
  //   }
  // };

  // const stopAlarm = async () => {
  //   try {
  //     if (alarmSound) {
  //       await alarmSound.stopAsync();
  //     }
  //   } catch (error) {
  //     console.error('Failed to stop alarm:', error);
  //   }
  // };

  // Update emergency activation to include alarm
  const activateEmergency = async () => {
    setEmergencyMode(true);
    startEmergencyRecording();
    // playAlarm();
  };

  // Update emergency deactivation
  const deactivateEmergency = async () => {
    setEmergencyMode(false);
    stopEmergencyRecording();
    // stopAlarm();
    // Clear polling interval
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = undefined;
    }
    // Reset notification tracking
    setLastNotificationTime({});
  };

  // Add new state for polling
  const [lastPollTime, setLastPollTime] = useState<number>(Date.now());
  const POLL_INTERVAL = 5000; // 5 seconds
  const ALERT_DISTANCE = 1000; // 1000 meters = 1km

  // Add at the top with other state
  const [notifiedIncidents, setNotifiedIncidents] = useState<Set<string>>(new Set());
  const INCIDENT_RECENCY_THRESHOLD = 10 * 60 * 1000; // 10 minutes in milliseconds

  // Add at the top with other state
  const [lastNotificationTime, setLastNotificationTime] = useState<{ [key: string]: number }>({});
  const NOTIFICATION_COOLDOWN = 5 * 60 * 1000; // 5 minutes in milliseconds

  // Set up notifications on mount
  useEffect(() => {
    setupNotifications();
    startIncidentPolling();

    return () => {
      // Cleanup polling interval
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, []);

  const pollingInterval = useRef<NodeJS.Timeout>();

  const setupNotifications = async () => {
    await Notifications.requestPermissionsAsync();

    await Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  };

  const sendProximityAlert = async (incident: any) => {
    // Check if we've recently sent a notification for this incident
    const lastTime = lastNotificationTime[incident.id];
    const now = Date.now();

    if (lastTime && (now - lastTime < NOTIFICATION_COOLDOWN)) {
      return; // Skip if notification was sent recently
    }

    const timeAgo = Math.round((now - new Date(incident.incidentTime).getTime()) / 60000);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ Nearby Incident Alert",
        body: `An incident was reported ${incident.distance}m away ${timeAgo} minutes ago. Stay alert and avoid the area if possible.`,
        sound: require('@/assets/sounds/warning.wav'),
        priority: Notifications.AndroidNotificationPriority.HIGH,
        data: { incidentId: incident.id },
      },
      trigger: null,
    });

    // Update last notification time for this incident
    setLastNotificationTime(prev => ({
      ...prev,
      [incident.id]: now
    }));
  };

  const startIncidentPolling = () => {
    const notifiedIncidents = new Set<string>();
    pollingInterval.current = setInterval(async () => {
      if (!location) return;

      try {
        const response = await fetch(
          `${GET_INCIDENTS_ENDPOINT}?lastPollTime=${lastPollTime}`
        );
        const incidents = await response.json();

        // Check each incident's distance and recency
        for (const incident of incidents) {
          // console.log(notifiedIncidents);
          // Skip if we've already notified about this incident
          if (notifiedIncidents.has(incident.id)) continue;

          // console.log(incident);
          // Check if incident is recent enough
          const incidentTime = new Date(incident.incidentTime).getTime();
          const isRecent = Date.now() - incidentTime < INCIDENT_RECENCY_THRESHOLD;

          if (!isRecent) continue;
          // console.log('incident is recent');

          const [lat, lon] = incident.gpsCoordinates.split(' ').map(Number);

          const distance = getDistance(
            { latitude: location.coords.latitude, longitude: location.coords.longitude },
            { latitude: lat, longitude: lon }
          );

          // Alert if incident is within range
          if (distance <= ALERT_DISTANCE) {
            await sendProximityAlert({
              ...incident,
              distance,
            });

            // Mark this incident as notified
            // setNotifiedIncidents(prev => new Set([...prev, incident.id]));
            notifiedIncidents.add(incident.id);
          }
        }

        setLastPollTime(Date.now());
      } catch (error) {
        console.error('Failed to poll for incidents:', error);
      }
    }, POLL_INTERVAL);
  };

  // Add new state for search
  const [searchQuery, setSearchQuery] = useState('');

  // Add search filter function
  const filteredContacts = contactsList?.filter(contact =>
    contact.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.phoneNumbers?.[0]?.number?.includes(searchQuery) ||
    contact.emails?.[0]?.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ScrollView style={styles.container}>
      <LinearGradient
        colors={['#1a1a1a', '#2a2a2a']}
        style={styles.background}
      />

      {/* Status Card */}
      <BlurView intensity={20} style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <IconSymbol name="checkmark.shield" size={24} color="#4CAF50" />
          <ThemedText style={styles.statusTitle}>
            Guardian Status
          </ThemedText>
        </View>

        <View style={styles.statusInfo}>
          <ThemedText style={styles.statusText}>
            {emergencyMode ? 'Emergency Mode Active' : 'Monitoring Active'}
          </ThemedText>
          <ThemedText style={styles.statusSubtext}>
            {location ? 'Location tracking enabled' : 'Acquiring location...'}
          </ThemedText>
        </View>
      </BlurView>

      {/* Emergency Button */}
      <Animated.View style={[styles.emergencyButtonContainer, animatedStyle]}>
        <TouchableOpacity
          style={[
            styles.emergencyButton,
            emergencyMode && styles.emergencyButtonActive
          ]}
          onPress={() => {
            if (emergencyMode) {
              setShowPasswordModal(true);
            } else {
              activateEmergency();
            }
          }}
        >
          <ThemedText style={styles.emergencyButtonText}>
            {emergencyMode ? 'EMERGENCY ACTIVE - CLICK IF YOU\'RE OKAY' : 'CLICK TO ACTIVATE EMERGENCY'}
          </ThemedText>
        </TouchableOpacity>
      </Animated.View>

      {/* User Info Section */}
      <BlurView intensity={15} style={styles.userInfoCard}>
        <View style={styles.userInfoHeader}>
          <IconSymbol name="person" size={20} color="#2196F3" />
          <ThemedText style={styles.sectionTitle}>Personal Info</ThemedText>
        </View>

        <TextInput
          style={styles.nameInput}
          placeholder="Enter your full name"
          placeholderTextColor="#666"
          value={fullName}
          onChangeText={setFullName}
        />

        <ThemedText style={styles.infoSubtext}>
          This information will be shared with authorities in case of emergency
        </ThemedText>

        {/* Add Change Password Button */}
        <TouchableOpacity
          style={styles.changePasswordButton}
          onPress={() => setShowPasswordModal(true)}>
          <ThemedText style={styles.changePasswordText}>Change Emergency Password</ThemedText>
        </TouchableOpacity>
      </BlurView>

      {/* Emergency Contacts Section */}
      <BlurView intensity={15} style={styles.contactsCard}>
        <View style={styles.contactsHeader}>
          <IconSymbol name="phone" size={20} color="#2196F3" />
          <ThemedText style={styles.sectionTitle}>Emergency Contacts</ThemedText>
        </View>

        <ThemedText style={styles.infoSubtext}>
          These contacts will be notified immediately if an incident is detected
        </ThemedText>

        <ScrollView style={[styles.contactsList, { marginTop: 12 }]}>
          {emergencyContacts.map((contact, index) => (
            <View key={index} style={styles.contactItem}>
              <View style={styles.contactInfo}>
                <ThemedText style={styles.contactName}>{contact.name}</ThemedText>
                <ThemedText style={styles.contactPhone}>
                  {contact.phoneNumbers?.[0]?.number}
                </ThemedText>
              </View>
              <TouchableOpacity
                style={styles.removeContactButton}
                onPress={() => {
                  setEmergencyContacts(contacts =>
                    contacts.filter((_, i) => i !== index)
                  );
                  saveEmergencyContacts(emergencyContacts.filter((_, i) => i !== index));
                }}
              >
                <IconSymbol name="xmark" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={styles.addContactButton}
          // onPress={() => setShowContactsModal(true)}
          onPress={handlePickContact}
        >
          <ThemedText style={styles.addContactText}>Add Contact</ThemedText>
        </TouchableOpacity>
      </BlurView>

      {/* Password Modal */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="slide">
        <ThemedView style={styles.modalContainer}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="subtitle" style={{ color: '#000' }}>
              {emergencyMode ? 'Enter Password to Confirm' : 'Change Emergency Password'}
            </ThemedText>

            {!emergencyMode && (
              <ThemedText style={styles.passwordHint}>
                Current password: {DEFAULT_PASSWORD}
              </ThemedText>
            )}

            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder={emergencyMode ? "Enter password" : "Enter new password"}
              secureTextEntry
            />

            <TouchableOpacity
              style={styles.passwordButton}
              onPress={emergencyMode ? () => handleImOk(password) : handleSetPassword}>
              <ThemedText style={styles.buttonText}>
                {emergencyMode ? 'Confirm' : 'Update Password'}
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setShowPasswordModal(false);
                setPassword('');
              }}>
              <ThemedText style={{ color: '#000' }}>Cancel</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </ThemedView>
      </Modal>

      {/* Contacts Modal */}
      <Modal
        visible={showContactsModal}
        transparent
        animationType="slide">
        <ThemedView style={styles.modalContainer}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="subtitle" style={{ color: '#000' }}>Select Emergency Contacts</ThemedText>

            {/* Add search input */}
            <TextInput
              style={styles.searchInput}
              placeholder="Search contacts..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            <ScrollView style={styles.contactsList}>
              {filteredContacts?.map((contact, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.contactSelectItem}
                  onPress={() => {
                    if (emergencyContacts.length < 3) {
                      const newContacts = [...emergencyContacts, contact];
                      saveEmergencyContacts(newContacts);
                      setShowContactsModal(false);
                    } else {
                      Alert.alert('Limit Reached', 'You can only add up to 3 emergency contacts.');
                    }
                  }}>
                  <ThemedText style={styles.contactSelectText}>{contact.name}</ThemedText>
                  {contact.phoneNumbers?.[0]?.number && <ThemedText style={styles.contactSelectSubtext}>{contact.phoneNumbers?.[0]?.number}</ThemedText>}
                  {contact.emails?.[0]?.email && <ThemedText style={styles.contactSelectSubtext}>{contact.emails?.[0]?.email}</ThemedText>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowContactsModal(false)}>
              <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </ThemedView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 4,
    paddingTop: 50,
    marginBottom: 100,
    // paddingBottom: 100
  },
  background: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  statusCard: {
    marginTop: 36,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusTitle: {
    fontSize: 25,
    fontWeight: '600',
    marginLeft: 8,
    color: '#fff',
  },
  statusInfo: {
    marginTop: 8,
  },
  statusText: {
    fontSize: 18.5,
    color: '#fff',
    marginBottom: 4,
  },
  statusSubtext: {
    fontSize: 16,
    color: '#aaa',
  },
  emergencyButtonContainer: {
    marginVertical: 24,
    alignItems: 'center',
  },
  emergencyButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#ff4444',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  emergencyButtonActive: {
    backgroundColor: '#ff0000',
  },
  emergencyButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  userInfoCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
    marginBottom: 16,
  },
  contactsCard: {
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginLeft: 8,
  },
  nameInput: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    marginTop: 12,
  },
  infoSubtext: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    color: '#fff',
  },
  contactPhone: {
    fontSize: 14,
    color: '#aaa',
    marginTop: 4,
  },
  removeContactButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,0,0,0.3)',
  },
  addContactButton: {
    backgroundColor: '#2196F3',
    padding: 16,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
  },
  addContactText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 8,
    width: '80%',
    alignItems: 'center',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 10,
    width: '100%',
    marginVertical: 10,
    color: '#000',
  },
  passwordButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 4,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
  cancelButton: {
    padding: 10,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#000',
  },
  passwordHint: {
    color: '#666',
    marginBottom: 10,
    fontSize: 14,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  userInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  contactsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  contactsList: {
    maxHeight: 200,
    width: '100%',
  },
  contactSelectItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  contactSelectText: {
    color: '#000',
    fontSize: 16,
    marginBottom: 4,
  },
  contactSelectSubtext: {
    color: '#666',
    fontSize: 14,
  },
  searchInput: {
    width: '100%',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
    color: '#000',
    fontSize: 16,
  },
  changePasswordButton: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    marginTop: 16,
    alignItems: 'center',
  },
  changePasswordText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
